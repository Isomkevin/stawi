import bcrypt from "bcryptjs";
import { store } from "../store";
import { Account, Coop, Invoice, Payout, Transaction } from "../types";
import { feeCents, splitByShares, toKesCents } from "../services/money";

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
  coop_id: "coop_kiambu",
  treasurer_id: "acc_treasurer",
  exporter_id: "acc_exporter",
  farmer_ids: [],
  invoice_ids: {
    paid_coop: "inv_coop_hamburg_101",
    awaiting_split_coop: "inv_coop_berlin_102",
    pending_coop: "inv_coop_rotterdam_103",
    paid_direct: "inv_direct_ny_201",
    pending_direct: "inv_2413",
  },
};

export async function seedDatabase(): Promise<SeedIds> {
  const pinHash = await bcrypt.hash("1234", 10);

  // 1. Co-op
  const coop: Coop = {
    id: "coop_kiambu",
    name: "Kiambu Highlands Coffee Co-op",
    treasurer_account_id: "acc_treasurer",
  };
  await store.saveCoop(coop);

  // 2. Treasurer Account
  const treasurer: Account = {
    id: "acc_treasurer",
    full_name: "David Kamau",
    phone_number: "+254711000000",
    id_number: "ID1000000",
    payout_destinations: [
      {
        id: "dest_treasurer_mpesa",
        type: "mpesa",
        details: "+254711000000",
        account_name: "David Kamau",
        is_verified: true,
      },
    ],
    coop_id: coop.id,
    channel_capability: "webapp+ussd",
    balance_kes_cents: 2500000, // KES 25,000.00
    incoming_kes_cents: 0,
    pin_hash: pinHash,
    pin_failed_attempts: 0,
    pin_locked_until: null,
  };
  await store.saveAccount(treasurer);

  // 3. 10 Farmers
  const farmersData = [
    { name: "Wanjiku Mwangi", phone: "+254712000001", share: 15, kilos: 1500, balance: 1845000 },
    { name: "Juma Omondi", phone: "+254712000002", share: 12, kilos: 1200, balance: 920000 },
    { name: "Fatuma Ali", phone: "+254712000003", share: 10, kilos: 1000, balance: 750000 },
    { name: "Kipchoge Cheruiyot", phone: "+254712000004", share: 10, kilos: 1000, balance: 680000 },
    { name: "Achieng Otieno", phone: "+254712000005", share: 10, kilos: 1000, balance: 840000 },
    { name: "Maina Njoroge", phone: "+254712000006", share: 9, kilos: 900, balance: 560000 },
    { name: "Halima Hassan", phone: "+254712000007", share: 9, kilos: 900, balance: 610000 },
    { name: "Mutua Musyoka", phone: "+254712000008", share: 9, kilos: 900, balance: 490000 },
    { name: "Nyaboke Kerubo", phone: "+254712000009", share: 8, kilos: 800, balance: 420000 },
    { name: "Kibet Rotich", phone: "+254712000010", share: 8, kilos: 800, balance: 380000 },
  ];

  const farmerIds: string[] = [];

  for (let i = 0; i < farmersData.length; i++) {
    const f = farmersData[i];
    const farmerId = `acc_farmer_${i + 1}`;
    farmerIds.push(farmerId);

    const farmerAcc: Account = {
      id: farmerId,
      full_name: f.name,
      phone_number: f.phone,
      id_number: `ID20000${(i + 1).toString().padStart(2, "0")}`,
      payout_destinations: [
        {
          id: `dest_mpesa_${farmerId}`,
          type: "mpesa",
          details: f.phone,
          account_name: f.name,
          is_verified: true,
        },
        {
          id: `dest_bank_${farmerId}`,
          type: "bank",
          details: `01109${(i + 1).toString().padStart(6, "0")}`,
          account_name: f.name,
          is_verified: true,
        },
      ],
      coop_id: coop.id,
      channel_capability: "webapp+ussd",
      balance_kes_cents: f.balance,
      incoming_kes_cents: 0,
      pin_hash: pinHash,
      pin_failed_attempts: 0,
      pin_locked_until: null,
    };
    await store.saveAccount(farmerAcc);

    await store.addCoopMember({
      coop_id: coop.id,
      account_id: farmerId,
      full_name: f.name,
      contribution_share: f.share,
      kilos: f.kilos,
    });
  }

  SEED_IDS.farmer_ids = farmerIds;

  // 4. Solo Exporter
  const exporter: Account = {
    id: "acc_exporter",
    full_name: "Grace Wanjiru (Wanjiru Crafts)",
    phone_number: "+254722000001",
    id_number: "ID3000001",
    payout_destinations: [
      {
        id: "dest_exporter_mpesa",
        type: "mpesa",
        details: "+254722000001",
        account_name: "Grace Wanjiru",
        is_verified: true,
      },
      {
        id: "dest_exporter_bank",
        type: "bank",
        details: "02209123456",
        account_name: "Wanjiru Crafts Ltd",
        is_verified: true,
      },
    ],
    coop_id: null,
    channel_capability: "webapp+ussd",
    balance_kes_cents: 41280000, // KES 412,800.00
    incoming_kes_cents: 0,
    pin_hash: pinHash,
    pin_failed_attempts: 0,
    pin_locked_until: null,
  };
  await store.saveAccount(exporter);

  // 5. Invoices & Transactions
  // 5a. Completed and split Co-op invoice: USD 12,400 (Hamburg buyer)
  const fxRate = 129.0;
  const inv1GrossCents = toKesCents(12400, "USD", fxRate); // 159,960,000 cents = KES 1,599,600.00
  const inv1FeeCents = feeCents(inv1GrossCents, 0.8); // 1,279,680 cents = KES 12,796.80
  const inv1NetCents = inv1GrossCents - inv1FeeCents; // 158,680,320 cents = KES 1,586,803.20

  const inv1: Invoice = {
    id: SEED_IDS.invoice_ids.paid_coop,
    type: "coop",
    account_id: null,
    coop_id: coop.id,
    buyer_name: "Hanseatic Coffee Roasters GmbH",
    buyer_email: "payments@hanseatic-coffee.de",
    buyer_phone: "+494012345678",
    amount: 12400,
    currency: "USD",
    description: "Container Lot AA Premium Arabica - Hamburg",
    reference: "INV-COOP-HAMBURG-101",
    status: "completed",
    split_approved: true,
    fx_rate: fxRate,
    fee_kes_cents: inv1FeeCents,
    kes_total_cents: inv1NetCents,
    payaza_checkout_reference: "PZ-CHK-HAMBURG-001",
    created_at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    due_at: new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString(),
  };
  await store.saveInvoice(inv1);

  await store.addTransaction({
    id: "tx_col_inv1",
    invoice_id: inv1.id,
    type: "collection",
    status: "completed",
    amount: 12400,
    currency: "USD",
    payaza_reference: "PZ-COL-101",
    fx_rate: null,
    fee_kes_cents: null,
    created_at: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
  });

  await store.addTransaction({
    id: "tx_conv_inv1",
    invoice_id: inv1.id,
    type: "conversion",
    status: "completed",
    amount: inv1GrossCents / 100,
    currency: "KES",
    payaza_reference: "PZ-CONV-101",
    fx_rate: fxRate,
    fee_kes_cents: inv1FeeCents,
    created_at: new Date(Date.now() - 7 * 24 * 3600 * 1000 + 300000).toISOString(),
  });

  await store.addTransaction({
    id: "tx_settle_inv1",
    invoice_id: inv1.id,
    type: "settlement",
    status: "completed",
    amount: inv1NetCents / 100,
    currency: "KES",
    payaza_reference: "PZ-SETTLE-101",
    fx_rate: null,
    fee_kes_cents: inv1FeeCents,
    created_at: new Date(Date.now() - 7 * 24 * 3600 * 1000 + 600000).toISOString(),
  });

  // Split payouts for inv1
  const members = await store.getCoopMembers(coop.id);
  const splitLines = splitByShares(inv1GrossCents, inv1FeeCents, members);
  for (const line of splitLines) {
    const payout: Payout = {
      id: `payout_inv1_${line.account_id}`,
      invoice_id: inv1.id,
      transaction_id: "tx_settle_inv1",
      account_id: line.account_id,
      kind: "credit",
      amount_kes_cents: line.net_kes_cents,
      destination_id: null,
      status: "confirmed",
      created_at: new Date(Date.now() - 7 * 24 * 3600 * 1000 + 700000).toISOString(),
    };
    await store.addPayout(payout);
  }

  // 5b. Co-op invoice awaiting split approval: USD 8,500 (Berlin buyer)
  const inv2GrossCents = toKesCents(8500, "USD", fxRate);
  const inv2FeeCents = feeCents(inv2GrossCents, 0.8);
  const inv2NetCents = inv2GrossCents - inv2FeeCents;

  const inv2: Invoice = {
    id: SEED_IDS.invoice_ids.awaiting_split_coop,
    type: "coop",
    account_id: null,
    coop_id: coop.id,
    buyer_name: "The Barn Berlin",
    buyer_email: "orders@thebarn.de",
    buyer_phone: "+493012345678",
    amount: 8500,
    currency: "USD",
    description: "Specialty Peaberry Micro-Lot - Berlin",
    reference: "INV-COOP-BERLIN-102",
    status: "settling",
    split_approved: false,
    fx_rate: fxRate,
    fee_kes_cents: inv2FeeCents,
    kes_total_cents: inv2NetCents,
    payaza_checkout_reference: "PZ-CHK-BERLIN-002",
    created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
    due_at: new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString(),
  };
  await store.saveInvoice(inv2);

  await store.addTransaction({
    id: "tx_col_inv2",
    invoice_id: inv2.id,
    type: "collection",
    status: "completed",
    amount: 8500,
    currency: "USD",
    payaza_reference: "PZ-COL-102",
    fx_rate: null,
    fee_kes_cents: null,
    created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  });

  await store.addTransaction({
    id: "tx_conv_inv2",
    invoice_id: inv2.id,
    type: "conversion",
    status: "completed",
    amount: inv2GrossCents / 100,
    currency: "KES",
    payaza_reference: "PZ-CONV-102",
    fx_rate: fxRate,
    fee_kes_cents: inv2FeeCents,
    created_at: new Date(Date.now() - 2 * 24 * 3600 * 1000 + 300000).toISOString(),
  });

  // Populate incoming_kes_cents on farmers for inv2
  const inv2SplitLines = splitByShares(inv2GrossCents, inv2FeeCents, members);
  for (const line of inv2SplitLines) {
    const acc = await store.getAccount(line.account_id);
    if (acc) {
      acc.incoming_kes_cents += line.net_kes_cents;
      await store.saveAccount(acc);
    }
  }

  // 5c. Pending Co-op invoice: USD 15,000 (Rotterdam buyer)
  const inv3: Invoice = {
    id: SEED_IDS.invoice_ids.pending_coop,
    type: "coop",
    account_id: null,
    coop_id: coop.id,
    buyer_name: "Rotterdam Commodity Traders B.V.",
    buyer_email: "procurement@rctraders.nl",
    buyer_phone: "+31101234567",
    amount: 15000,
    currency: "USD",
    description: "Fairtrade Grade 1 Green Coffee - Rotterdam",
    reference: "INV-COOP-ROTTERDAM-103",
    status: "pending",
    split_approved: false,
    fx_rate: null,
    fee_kes_cents: null,
    kes_total_cents: null,
    payaza_checkout_reference: null,
    created_at: new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString(),
    due_at: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
  };
  await store.saveInvoice(inv3);

  // 5d. Completed Direct invoice: USD 3,200 (New York buyer)
  const inv4Gross = toKesCents(3200, "USD", fxRate);
  const inv4Fee = feeCents(inv4Gross, 0.8);
  const inv4Net = inv4Gross - inv4Fee;

  const inv4: Invoice = {
    id: SEED_IDS.invoice_ids.paid_direct,
    type: "direct",
    account_id: exporter.id,
    coop_id: null,
    buyer_name: "Brooklyn Artisan Goods",
    buyer_email: "orders@brooklynartisan.com",
    buyer_phone: "+12125550192",
    amount: 3200,
    currency: "USD",
    description: "Handwoven Sisal & Banana Bark Baskets - New York",
    reference: "INV-EXP-NY-201",
    status: "completed",
    split_approved: false,
    fx_rate: fxRate,
    fee_kes_cents: inv4Fee,
    kes_total_cents: inv4Net,
    payaza_checkout_reference: "PZ-CHK-NY-004",
    created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000).toISOString(),
    due_at: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
  };
  await store.saveInvoice(inv4);

  await store.addPayout({
    id: "payout_direct_inv4",
    invoice_id: inv4.id,
    account_id: exporter.id,
    kind: "credit",
    amount_kes_cents: inv4Net,
    destination_id: null,
    status: "confirmed",
    created_at: new Date(Date.now() - 4 * 24 * 3600 * 1000 + 400000).toISOString(),
  });

  // 5e. Pending Direct invoice: EUR 1,800 (London buyer)
  const inv5: Invoice = {
    id: SEED_IDS.invoice_ids.pending_direct,
    type: "direct",
    account_id: exporter.id,
    coop_id: null,
    buyer_name: "Covent Garden Fair Trade Ltd",
    buyer_email: "finance@coventfairtrade.co.uk",
    buyer_phone: "+442079460912",
    amount: 1800,
    currency: "EUR",
    description: "Beaded Maasai Leather Accessories - London",
    reference: "INV-EXP-LONDON-202",
    status: "pending",
    split_approved: false,
    fx_rate: null,
    fee_kes_cents: null,
    kes_total_cents: null,
    payaza_checkout_reference: null,
    created_at: new Date().toISOString(),
    due_at: new Date(Date.now() + 14 * 24 * 3600 * 1000).toISOString(),
  };
  await store.saveInvoice(inv5);

  return SEED_IDS;
}
