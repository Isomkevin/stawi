import bcrypt from "bcryptjs";
import {
  assertCatalogShape,
  BANKS,
  CANONICAL,
  CANONICAL_INVOICES,
  EXTRA_COOPS,
  EXTRA_EXPORTERS,
  fxFor,
  integerShares,
  InvoiceBlueprint,
  KIAMBU_EXTRA_INVOICES,
  KIAMBU_FARMERS,
  MPESA_BANK_CODE,
  WANJIRU_EXTRA_INVOICES,
} from "./catalog";
import { feeCents, splitByShares, toKesCents } from "../services/money";
import { store } from "../store";
import { Account, CoopMember, Invoice, InvoiceStatus, PayoutDestination, PayoutStatus, Shipment, ShipmentFarmer, ShipmentStatus } from "../types";

export interface SeedIds {
  coop_id: string;
  treasurer_id: string;
  exporter_id: string;
  farmer_ids: string[];
  invoice_ids: {
    paid_coop: string;
    awaiting_split_coop: string;
    pending_coop: string;
    paid_direct: string;
    pending_direct: string;
  };
}

export let SEED_IDS: SeedIds = {
  coop_id: CANONICAL.coopId,
  treasurer_id: CANONICAL.treasurerId,
  exporter_id: CANONICAL.exporterId,
  farmer_ids: [],
  invoice_ids: { ...CANONICAL.invoices },
};

const DEMO_PIN = "1234";

function shiftDays(days: number): string {
  return new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
}

function plusMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}

function assertShort(id: string, label: string): void {
  if (id.length > 64) throw new Error(`${label} is longer than 64 characters: ${id}`);
}

function hashCode(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) hash = (hash + value.charCodeAt(i) * (i + 1)) % 997;
  return hash;
}

function bankAccountNumber(seedKey: string): string {
  let hash = 0;
  for (const char of seedKey) hash = (hash * 33 + char.charCodeAt(0)) % 1_000_000_000;
  return String(1_000_000_000 + hash).padStart(11, "0");
}

function makeDestinations(
  accountId: string,
  personName: string,
  phone: string,
  bankIndex: number,
  bankAccountName: string,
  flags?: { mpesaVerified?: boolean; bankVerified?: boolean; mpesaId?: string; bankId?: string }
): PayoutDestination[] {
  const bank = BANKS[bankIndex % BANKS.length];
  const mpesaId = flags?.mpesaId ?? `dest_mpesa_${accountId}`;
  const bankId = flags?.bankId ?? `dest_bank_${accountId}`;
  assertShort(mpesaId, "destination");
  assertShort(bankId, "destination");
  return [
    {
      id: mpesaId,
      type: "mpesa",
      details: phone,
      account_name: personName,
      is_verified: flags?.mpesaVerified !== false,
      bank_code: MPESA_BANK_CODE,
    },
    {
      id: bankId,
      type: "bank",
      details: bankAccountNumber(`${accountId}:${bank.code}`),
      account_name: bankAccountName,
      is_verified: flags?.bankVerified !== false,
      bank_code: bank.code,
    },
  ];
}

function makeAccount(
  pinHash: string,
  fields: Omit<Account, "balance_kes_cents" | "incoming_kes_cents" | "pin_hash" | "pin_failed_attempts" | "pin_locked_until">
): Account {
  assertShort(fields.id, "account");
  return {
    ...fields,
    balance_kes_cents: 0,
    incoming_kes_cents: 0,
    pin_hash: pinHash,
    pin_failed_attempts: 0,
    pin_locked_until: null,
  };
}

function materialize(
  bp: InvoiceBlueprint,
  owner: { type: "direct" | "coop"; account_id: string | null; coop_id: string | null }
): Invoice {
  const quoted = bp.status === "settling" || bp.status === "completed" || bp.status === "converting";
  const settled = bp.status === "settling" || bp.status === "completed";
  const rate = quoted ? fxFor(bp.currency) : null;
  let fee: number | null = null;
  let net: number | null = null;
  if (settled && rate != null) {
    const gross = toKesCents(bp.amount, bp.currency, rate);
    fee = feeCents(gross, 0.8);
    net = gross - fee;
  }
  assertShort(bp.id, "invoice");
  return {
    id: bp.id,
    type: owner.type,
    account_id: owner.account_id,
    coop_id: owner.coop_id,
    buyer_name: bp.buyer_name,
    buyer_email: bp.buyer_email,
    buyer_phone: bp.buyer_phone,
    amount: bp.amount,
    currency: bp.currency,
    description: bp.description,
    reference: bp.reference,
    status: bp.status,
    split_approved: owner.type === "coop" && bp.status === "completed",
    fx_rate: rate,
    fee_kes_cents: fee,
    kes_total_cents: net,
    payaza_checkout_reference: bp.checkoutRef,
    payaza_link_id: bp.status === "pending" || bp.status === "paid" ? `link_${bp.reference}` : null,
    created_at: shiftDays(-bp.createdDaysAgo),
    due_at: shiftDays(bp.dueDaysFromNow),
  };
}

async function seedRail(invoice: Invoice, members: CoopMember[]): Promise<void> {
  await store.saveInvoice(invoice);
  const at = (minutes: number) => plusMinutes(invoice.created_at, minutes);

  if (invoice.status === "pending") return;

  if (invoice.status === "failed") {
    await store.addTransaction({
      id: `tx_col_${invoice.id}`,
      invoice_id: invoice.id,
      type: "collection",
      status: "failed",
      amount: invoice.amount,
      currency: invoice.currency,
      payaza_reference: `PZ-COL-${invoice.reference}`,
      fx_rate: null,
      fee_kes_cents: null,
      created_at: at(0),
    });
    return;
  }

  await store.addTransaction({
    id: `tx_col_${invoice.id}`,
    invoice_id: invoice.id,
    type: "collection",
    status: "completed",
    amount: invoice.amount,
    currency: invoice.currency,
    payaza_reference: invoice.payaza_checkout_reference ?? `PZ-COL-${invoice.reference}`,
    fx_rate: null,
    fee_kes_cents: null,
    created_at: at(0),
  });

  if (invoice.status === "paid") return;

  if (invoice.fx_rate == null) throw new Error(`Invoice ${invoice.id} is missing an FX rate`);
  const gross = toKesCents(invoice.amount, invoice.currency, invoice.fx_rate);
  const fee = invoice.fee_kes_cents ?? feeCents(gross, 0.8);

  if (invoice.status === "converting") {
    await store.addTransaction({
      id: `tx_conv_${invoice.id}`,
      invoice_id: invoice.id,
      type: "conversion",
      status: "pending",
      amount: gross / 100,
      currency: "KES",
      payaza_reference: `PZ-CONV-${invoice.reference}`,
      fx_rate: invoice.fx_rate,
      fee_kes_cents: fee,
      created_at: at(5),
    });
    return;
  }

  await store.addTransaction({
    id: `tx_conv_${invoice.id}`,
    invoice_id: invoice.id,
    type: "conversion",
    status: "completed",
    amount: gross / 100,
    currency: "KES",
    payaza_reference: `PZ-CONV-${invoice.reference}`,
    fx_rate: invoice.fx_rate,
    fee_kes_cents: fee,
    created_at: at(5),
  });

  if (invoice.status === "settling") return;

  const net = invoice.kes_total_cents ?? gross - fee;
  const settleId = `tx_settle_${invoice.id}`;
  await store.addTransaction({
    id: settleId,
    invoice_id: invoice.id,
    type: "settlement",
    status: "completed",
    amount: net / 100,
    currency: "KES",
    payaza_reference: `PZ-SETTLE-${invoice.reference}`,
    fx_rate: null,
    fee_kes_cents: fee,
    created_at: at(10),
  });

  if (invoice.type === "direct") {
    if (!invoice.account_id) throw new Error(`Direct invoice ${invoice.id} has no exporter`);
    await store.addPayout({
      id: `payout_${invoice.id}_${invoice.account_id}`,
      invoice_id: invoice.id,
      transaction_id: settleId,
      account_id: invoice.account_id,
      kind: "credit",
      amount_kes_cents: net,
      destination_id: null,
      status: "confirmed",
      created_at: at(12),
    });
    return;
  }

  if (members.length === 0) throw new Error(`Co-op invoice ${invoice.id} has no members to split`);
  const lines = splitByShares(gross, fee, members);
  for (const line of lines) {
    const payoutId = `payout_${invoice.id}_${line.account_id}`;
    assertShort(payoutId, "payout");
    await store.addPayout({
      id: payoutId,
      invoice_id: invoice.id,
      transaction_id: settleId,
      account_id: line.account_id,
      kind: "credit",
      amount_kes_cents: line.net_kes_cents,
      destination_id: null,
      status: "confirmed",
      created_at: at(12),
    });
  }
}

async function persistInvoice(
  bp: InvoiceBlueprint,
  owner: { type: "direct" | "coop"; account_id: string | null; coop_id: string | null }
): Promise<void> {
  const invoice = materialize(bp, owner);
  const members = owner.coop_id ? await store.getCoopMembers(owner.coop_id) : [];
  await seedRail(invoice, members);
}

function withdrawalAmount(credits: number, ratioPct: number, reduces: boolean): number | null {
  let amount = Math.floor((credits * ratioPct) / 100);
  if (reduces) {
    const room = credits - 100_000;
    if (room < 10_000) return null;
    amount = Math.min(amount, room);
  }
  if (amount < 10_000) return null;
  return amount;
}

type PlannedWithdrawal = {
  account: Account;
  destinationId: string;
  amount: number;
  status: PayoutStatus;
  suffix: string;
  daysAgo: number;
};

function planWithdrawal(
  account: Account,
  destinationId: string,
  amount: number,
  status: PayoutStatus,
  suffix: string,
  daysAgo: number
): PlannedWithdrawal {
  return { account, destinationId, amount, status, suffix, daysAgo };
}

/**
 * Balances are derived from credits and withdrawals, then accounts are saved
 * before withdrawal rows are inserted. Saving an account rewrites its
 * destinations, which would clear destination links already stored on payouts.
 */
async function applyLedger(): Promise<void> {
  const accounts = (await store.getAllAccounts()).sort((a, b) => a.id.localeCompare(b.id));
  const invoices = await store.getInvoices();
  const incoming = new Map<string, number>();

  for (const invoice of invoices) {
    if (invoice.type !== "coop" || invoice.status !== "settling" || !invoice.coop_id) continue;
    if (invoice.fx_rate == null || invoice.fee_kes_cents == null) {
      throw new Error(`Settling invoice ${invoice.id} is missing FX or fee`);
    }
    const members = await store.getCoopMembers(invoice.coop_id);
    const gross = toKesCents(invoice.amount, invoice.currency, invoice.fx_rate);
    const lines = splitByShares(gross, invoice.fee_kes_cents, members);
    for (const line of lines) {
      incoming.set(line.account_id, (incoming.get(line.account_id) ?? 0) + line.net_kes_cents);
    }
  }

  const planned: PlannedWithdrawal[] = [];

  for (const account of accounts) {
    const payouts = await store.getPayoutsByAccount(account.id);
    const credits = payouts
      .filter((payout) => payout.kind === "credit" && payout.status === "confirmed")
      .reduce((sum, payout) => sum + payout.amount_kes_cents, 0);

    let withdrawn = 0;
    if (!account.id.startsWith("acc_treasurer") && credits >= 200_000) {
      const unverifiedMpesa = account.payout_destinations.find((dest) => dest.type === "mpesa" && !dest.is_verified);
      if (unverifiedMpesa) {
        planned.push(planWithdrawal(account, unverifiedMpesa.id, 25_000, "failed", "failed", 3));
      } else {
        const isExporter = account.coop_id === null;
        const take = isExporter || hashCode(account.id) % 3 === 0;
        const destination = take
          ? account.payout_destinations.find((dest) => dest.type === "mpesa" && dest.is_verified) ??
            account.payout_destinations.find((dest) => dest.is_verified)
          : undefined;
        if (destination) {
          const statuses: PayoutStatus[] = ["confirmed", "sent", "pending"];
          const status = statuses[hashCode(`${account.id}:status`) % statuses.length];
          const reduces = status === "confirmed" || status === "sent";
          const first = withdrawalAmount(credits, 18, reduces);
          if (first != null) {
            planned.push(planWithdrawal(account, destination.id, first, status, "a", 18));
            if (reduces) withdrawn += first;

            if (hashCode(`${account.id}:extra`) % 5 === 0) {
              const room = credits - withdrawn - 100_000;
              let second = Math.floor((credits * 8) / 100);
              if (room >= 10_000) {
                second = Math.min(second, room);
                if (second >= 10_000) {
                  const bank =
                    account.payout_destinations.find((dest) => dest.type === "bank" && dest.is_verified) ?? destination;
                  planned.push(planWithdrawal(account, bank.id, second, "confirmed", "b", 46));
                  withdrawn += second;
                }
              }
            }
          }
        }
      }
    }

    const balance = credits - withdrawn;
    if (!Number.isInteger(balance) || balance < 0) {
      throw new Error(`Ledger balance for ${account.id} is ${balance}`);
    }
    account.balance_kes_cents = balance;
    account.incoming_kes_cents = incoming.get(account.id) ?? 0;
    await store.saveAccount(account);
  }

  for (const withdrawal of planned) {
    const payoutId = `payout_wth_${withdrawal.account.id}_${withdrawal.suffix}`;
    assertShort(payoutId, "payout");
    await store.addPayout({
      id: payoutId,
      invoice_id: "withdrawal",
      account_id: withdrawal.account.id,
      kind: "withdrawal",
      amount_kes_cents: withdrawal.amount,
      destination_id: withdrawal.destinationId,
      status: withdrawal.status,
      created_at: shiftDays(-withdrawal.daysAgo),
      idempotency_key: `seed-wth-${withdrawal.account.id}-${withdrawal.suffix}`,
      payaza_reference: `PZ-WTH-${withdrawal.account.id}-${withdrawal.suffix.toUpperCase()}`,
    });
  }
}

export async function seedDatabase(): Promise<SeedIds> {
  assertCatalogShape();
  const pinHash = await bcrypt.hash(DEMO_PIN, 10);
  const phones = new Set<string>();

  const remember = (phone: string) => {
    if (phones.has(phone)) throw new Error(`Duplicate phone ${phone}`);
    phones.add(phone);
  };

  await store.saveCoop({
    id: CANONICAL.coopId,
    name: CANONICAL.coopName,
    treasurer_account_id: CANONICAL.treasurerId,
  });

  remember("+254711000000");
  await store.saveAccount(
    makeAccount(pinHash, {
      id: CANONICAL.treasurerId,
      full_name: "David Kamau",
      phone_number: "+254711000000",
      id_number: "ID1000000",
      coop_id: CANONICAL.coopId,
      channel_capability: "webapp+ussd",
      payout_destinations: makeDestinations(
        CANONICAL.treasurerId,
        "David Kamau",
        "+254711000000",
        0,
        CANONICAL.coopName,
        { mpesaId: "dest_treasurer_mpesa", bankId: "dest_treasurer_bank" }
      ),
    })
  );

  const farmerIds: string[] = [];
  for (let i = 0; i < KIAMBU_FARMERS.length; i++) {
    const farmer = KIAMBU_FARMERS[i];
    if (!farmer.phone || !farmer.id_number || farmer.share == null) {
      throw new Error(`Canonical farmer ${farmer.name} is missing phone, id, or share`);
    }
    const id = `acc_farmer_${i + 1}`;
    farmerIds.push(id);
    remember(farmer.phone);
    await store.saveAccount(
      makeAccount(pinHash, {
        id,
        full_name: farmer.name,
        phone_number: farmer.phone,
        id_number: farmer.id_number,
        coop_id: CANONICAL.coopId,
        channel_capability: "webapp+ussd",
        payout_destinations: makeDestinations(id, farmer.name, farmer.phone, i, farmer.name, {
          bankVerified: (i + 1) % 9 !== 0,
        }),
      })
    );
    await store.addCoopMember({
      coop_id: CANONICAL.coopId,
      account_id: id,
      full_name: farmer.name,
      contribution_share: farmer.share,
      kilos: farmer.kilos,
    });
  }
  SEED_IDS.farmer_ids = farmerIds;

  remember("+254722000001");
  await store.saveAccount(
    makeAccount(pinHash, {
      id: CANONICAL.exporterId,
      full_name: "Grace Wanjiru (Wanjiru Crafts)",
      phone_number: "+254722000001",
      id_number: "ID3000001",
      coop_id: null,
      channel_capability: "webapp+ussd",
      payout_destinations: makeDestinations(
        CANONICAL.exporterId,
        "Grace Wanjiru",
        "+254722000001",
        1,
        "Wanjiru Crafts Ltd",
        { mpesaId: "dest_exporter_mpesa", bankId: "dest_exporter_bank" }
      ),
    })
  );

  for (const coop of EXTRA_COOPS) {
    await store.saveCoop({
      id: coop.id,
      name: coop.name,
      treasurer_account_id: coop.treasurer.id,
    });
    remember(coop.treasurer.phone);
    await store.saveAccount(
      makeAccount(pinHash, {
        id: coop.treasurer.id,
        full_name: coop.treasurer.full_name,
        phone_number: coop.treasurer.phone,
        id_number: coop.treasurer.id_number,
        coop_id: coop.id,
        channel_capability: "webapp+ussd",
        payout_destinations: makeDestinations(
          coop.treasurer.id,
          coop.treasurer.full_name,
          coop.treasurer.phone,
          0,
          coop.name
        ),
      })
    );

    const shares = integerShares(coop.farmers.map((farmer) => farmer.kilos));
    for (let i = 0; i < coop.farmers.length; i++) {
      const farmer = coop.farmers[i];
      const id = `acc_${coop.slug}_${i + 1}`;
      const phone = `+254${coop.phoneStem}${String(i + 1).padStart(6, "0")}`;
      remember(phone);
      await store.saveAccount(
        makeAccount(pinHash, {
          id,
          full_name: farmer.name,
          phone_number: phone,
          id_number: String(coop.idStem + i + 1),
          coop_id: coop.id,
          channel_capability: i % 5 === 4 ? "webapp" : "webapp+ussd",
          payout_destinations: makeDestinations(id, farmer.name, phone, i, farmer.name, {
            mpesaVerified: !farmer.unverifiedMpesa,
            bankVerified: (i + 1) % 9 !== 0,
          }),
        })
      );
      await store.addCoopMember({
        coop_id: coop.id,
        account_id: id,
        full_name: farmer.name,
        contribution_share: shares[i],
        kilos: farmer.kilos,
      });
    }
  }

  for (const exporter of EXTRA_EXPORTERS) {
    remember(exporter.phone);
    await store.saveAccount(
      makeAccount(pinHash, {
        id: exporter.id,
        full_name: exporter.full_name,
        phone_number: exporter.phone,
        id_number: exporter.id_number,
        coop_id: null,
        channel_capability: "webapp+ussd",
        payout_destinations: makeDestinations(exporter.id, exporter.full_name, exporter.phone, 2, exporter.business),
      })
    );
  }

  for (const invoice of CANONICAL_INVOICES) {
    await persistInvoice(
      invoice,
      invoice.type === "coop"
        ? { type: "coop", coop_id: CANONICAL.coopId, account_id: null }
        : { type: "direct", coop_id: null, account_id: CANONICAL.exporterId }
    );
  }

  for (const invoice of KIAMBU_EXTRA_INVOICES) {
    await persistInvoice(invoice, { type: "coop", coop_id: CANONICAL.coopId, account_id: null });
  }

  for (const invoice of WANJIRU_EXTRA_INVOICES) {
    await persistInvoice(invoice, { type: "direct", coop_id: null, account_id: CANONICAL.exporterId });
  }

  for (const coop of EXTRA_COOPS) {
    for (const invoice of coop.invoices) {
      await persistInvoice(invoice, { type: "coop", coop_id: coop.id, account_id: null });
    }
  }

  for (const exporter of EXTRA_EXPORTERS) {
    for (const invoice of exporter.invoices) {
      await persistInvoice(invoice, { type: "direct", coop_id: null, account_id: exporter.id });
    }
  }

  await applyLedger();
  await seedShipments();
  return SEED_IDS;
}

const COOP_PRODUCT: Record<string, string> = {
  coop_kiambu: "Washed AA green coffee",
  coop_kericho: "Black CTC tea",
  coop_meru: "Macadamia kernels",
  coop_naivasha: "Premium roses",
};

function kilosFromDescription(description: string, amount: number): number {
  const match = description.match(/(\d+)\s*kg/i);
  if (match) return Number(match[1]);
  return Math.max(80, Math.round(amount / 5.4));
}

function destinationFrom(description: string): string {
  const parts = description.split("·").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  const dashed = description.split(" - ");
  if (dashed.length >= 2) return dashed[dashed.length - 1].trim();
  return "Mombasa, KE";
}

function productFrom(description: string, coopId: string): string {
  const match = description.match(/kg\s+(.+?)\s+·/);
  if (match) return match[1].trim();
  const short = description.split(" - ")[0]?.replace(/^Ref [^:]+:\s*/, "").trim();
  if (short && short.length > 0 && short.length < 80) return short;
  return COOP_PRODUCT[coopId] ?? "Export lot";
}

function stageForInvoice(status: InvoiceStatus): ShipmentStatus {
  if (status === "completed") return "completed";
  if (status === "settling" || status === "failed") return "delivered";
  if (status === "paid" || status === "converting") return "in_transit";
  if (status === "pending") return "ready";
  return "preparing";
}

function splitKilos(total: number, weights: number[]): number[] {
  const sum = weights.reduce((totalWeight, weight) => totalWeight + weight, 0);
  if (sum <= 0 || total <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const shares = exact.map((value) => Math.floor(value));
  let left = total - shares.reduce((totalShare, share) => totalShare + share, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const row of order) {
    if (left <= 0) break;
    shares[row.index] += 1;
    left -= 1;
  }
  return shares;
}

function assignFarmers(members: CoopMember[], key: string, totalKg: number): ShipmentFarmer[] {
  if (members.length === 0 || totalKg <= 0) return [];
  const count = Math.min(members.length, 3 + (hashCode(`${key}:count`) % 6));
  const start = hashCode(`${key}:start`) % members.length;
  const picked: CoopMember[] = [];
  for (let i = 0; i < count; i++) picked.push(members[(start + i) % members.length]);
  const weights = picked.map((member) => (member.kilos && member.kilos > 0 ? member.kilos : 1));
  const kilos = splitKilos(totalKg, weights);
  return picked
    .map((member, index) => ({ account_id: member.account_id, kilos: kilos[index] }))
    .filter((farmer) => farmer.kilos > 0);
}

function timingFor(status: ShipmentStatus, anchor: string): { ship_date: string; shipped_at: string | null } {
  if (status === "completed" || status === "delivered" || status === "in_transit") {
    return { ship_date: anchor, shipped_at: anchor };
  }
  if (status === "ready") return { ship_date: shiftDays(8), shipped_at: null };
  return { ship_date: shiftDays(14), shipped_at: null };
}

/** One shipment per co-op invoice, plus a draft and a preparing lot with no invoice yet. */
export async function seedShipments(): Promise<void> {
  const coops = await store.getAllCoops();
  for (const coop of coops) {
    const members = await store.getCoopMembers(coop.id);
    const invoices = (await store.getInvoices({ coop_id: coop.id })).filter((invoice) => invoice.type === "coop");
    for (const invoice of invoices) {
      const status = stageForInvoice(invoice.status);
      const quantity = kilosFromDescription(invoice.description, invoice.amount);
      const timing = timingFor(status, invoice.created_at);
      const id = `shp_${invoice.id}`;
      assertShort(id, "shipment");
      const farmers = assignFarmers(members, id, quantity);
      const farmerKg = farmers.reduce((total, farmer) => total + farmer.kilos, 0);
      if (farmerKg !== quantity) throw new Error(`Shipment ${id} kilos ${farmerKg} do not match ${quantity}`);
      const shipment: Shipment = {
        id,
        reference: invoice.reference,
        coop_id: coop.id,
        buyer_name: invoice.buyer_name,
        product: productFrom(invoice.description, coop.id),
        quantity_kg: quantity,
        destination: destinationFrom(invoice.description),
        value: invoice.amount,
        currency: invoice.currency,
        ship_date: timing.ship_date,
        shipped_at: timing.shipped_at,
        status,
        invoice_id: invoice.id,
        farmers,
        updated_at: invoice.created_at,
      };
      await store.saveShipment(shipment);
    }

    const product = COOP_PRODUCT[coop.id] ?? "Export lot";
    const draftId = `shp_${coop.id}_draft`;
    const preparingId = `shp_${coop.id}_prep`;
    assertShort(draftId, "shipment");
    assertShort(preparingId, "shipment");
    const now = new Date().toISOString();
    await store.saveShipment({
      id: draftId,
      reference: `${coop.id.toUpperCase()}-DRAFT`,
      coop_id: coop.id,
      buyer_name: "Buyer not assigned",
      product,
      quantity_kg: 800,
      destination: "TBD",
      value: 4200,
      currency: "USD",
      ship_date: shiftDays(21),
      shipped_at: null,
      status: "draft",
      invoice_id: null,
      farmers: [],
      updated_at: now,
    });
    const preparingKg = 1500;
    await store.saveShipment({
      id: preparingId,
      reference: `${coop.id.toUpperCase()}-PREP`,
      coop_id: coop.id,
      buyer_name: "Buyer not invoiced",
      product,
      quantity_kg: preparingKg,
      destination: "Mombasa, KE",
      value: 6100,
      currency: "USD",
      ship_date: shiftDays(-3),
      shipped_at: null,
      status: "preparing",
      invoice_id: null,
      farmers: assignFarmers(members, preparingId, preparingKg),
      updated_at: now,
    });
  }
}
