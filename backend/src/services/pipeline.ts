import { store } from "../store";
import { FarmerShareConfirmation, Invoice, Payout, SmsPurpose, SplitLine, Transaction, Shipment } from "../types";
import {
  allocateWithdrawal,
  applyWithdrawal,
  creditBalance,
  creditIncoming,
  releaseIncoming,
  restoreWithdrawal,
  withdrawalFlags,
} from "./demoData";
import { feeCents, kesPerUnit, splitByKilos, toKesCents } from "./money";
import { notify } from "./notify";
import { ensureTransactionReference, payaza } from "./payaza";
import { verifyAccountPin } from "./pin";

type PayoutAlert = {
  phone: string;
  name: string;
  amountKesCents: number;
  where: string;
  reference?: string;
  purpose: Extract<SmsPurpose, "share_landed" | "payout_sent" | "payout_failed" | "payment_received">;
  coopId: string | null;
};

/** Best-effort. A failed text never undoes the payout. */
async function sendPayoutAlerts(alerts: PayoutAlert[]): Promise<void> {
  for (const alert of alerts) {
    try {
      await notify.notifyPayoutLanded(alert.phone, alert.amountKesCents, alert.where, {
        name: alert.name,
        reference: alert.reference,
        purpose: alert.purpose,
        coopId: alert.coopId,
      });
    } catch (err) {
      console.warn("[SMS Warning] payout alert failed:", err);
    }
  }
}

export class PipelineService {
  /**
   * Resolves the FX rate for a given currency pair.
   */
  public getFxRate(currency: string): number {
    return kesPerUnit(currency);
  }

  /**
   * Processes collection from buyer:
   * 1. Records collection transaction
   * 2. Executes conversion (FX applied, transparent fee calculated)
   * 3. For Direct invoices: immediate settlement + credit to exporter
   * 4. For Co-op invoices: moves to settling state and populates incoming_kes_cents for farmers
   */
  public async processPayment(
    invoiceId: string,
    payazaRef?: string,
    paidAmount?: number,
    paidCurrency?: string
  ): Promise<{ invoice: Invoice; transactions: Transaction[]; payouts: Payout[] }> {
    const result = await store.withTransaction(() => this.applyCollection(invoiceId, payazaRef, paidAmount, paidCurrency));
    await sendPayoutAlerts(result.alerts);
    return { invoice: result.invoice, transactions: result.transactions, payouts: result.payouts };
  }

  private async applyCollection(
    invoiceId: string,
    payazaRef?: string,
    paidAmount?: number,
    paidCurrency?: string
  ): Promise<{ invoice: Invoice; transactions: Transaction[]; payouts: Payout[]; alerts: PayoutAlert[] }> {
    const invoice = await store.getInvoice(invoiceId);
    if (!invoice) {
      throw new Error(`Invoice ${invoiceId} not found`);
    }

    if (invoice.status === "completed") {
      const accounts = await store.getAllAccounts();
      const groups = await Promise.all(accounts.map((a) => store.getPayoutsByAccount(a.id)));
      return {
        invoice,
        transactions: await store.getTransactions(invoiceId),
        payouts: groups.flat().filter((p) => p.invoice_id === invoiceId),
        alerts: [],
      };
    }

    const effectiveAmount = paidAmount || invoice.amount;
    const effectiveCurrency = paidCurrency || invoice.currency;
    const effectivePayazaRef = payazaRef || `PZ-COL-${Date.now()}`;
    const demo = invoice.is_demo === true;

    // 1. Collection Transaction
    const colTx: Transaction = {
      id: `tx_col_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      invoice_id: invoice.id,
      is_demo: demo,
      type: "collection",
      status: "completed",
      amount: effectiveAmount,
      currency: effectiveCurrency,
      payaza_reference: effectivePayazaRef,
      fx_rate: null,
      fee_kes_cents: null,
      created_at: new Date().toISOString(),
    };
    await store.addTransaction(colTx);

    // 2. Conversion
    const fxRate = this.getFxRate(effectiveCurrency);
    const grossKesCents = toKesCents(effectiveAmount, effectiveCurrency, fxRate);
    const platformFeeCents = feeCents(grossKesCents, 0.8);
    const netKesCents = grossKesCents - platformFeeCents;

    invoice.fx_rate = fxRate;
    invoice.fee_kes_cents = platformFeeCents;
    invoice.kes_total_cents = netKesCents;
    invoice.payaza_checkout_reference = effectivePayazaRef;

    // Payaza publishes no FX endpoint (skill §7). Stawi records the converted KES
    // amount, the rate, and the fee on this transaction. The rate table is illustrative.
    const convTx: Transaction = {
      id: `tx_conv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      invoice_id: invoice.id,
      is_demo: demo,
      type: "conversion",
      status: "completed",
      amount: grossKesCents / 100,
      currency: "KES",
      payaza_reference: `PZ-CONV-${Date.now()}`,
      fx_rate: fxRate,
      fee_kes_cents: platformFeeCents,
      created_at: new Date().toISOString(),
    };
    await store.addTransaction(convTx);

    const generatedPayouts: Payout[] = [];
    const alerts: PayoutAlert[] = [];

    if (invoice.type === "direct") {
      // Stawi Direct Flow: Immediate settlement & credit to exporter
      invoice.status = "completed";
      await store.saveInvoice(invoice);

      const settleTx: Transaction = {
        id: `tx_settle_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        invoice_id: invoice.id,
        is_demo: demo,
        type: "settlement",
        status: "completed",
        amount: netKesCents / 100,
        currency: "KES",
        payaza_reference: null,
        fx_rate: null,
        fee_kes_cents: platformFeeCents,
        created_at: new Date().toISOString(),
      };
      await store.addTransaction(settleTx);

      if (invoice.account_id) {
        const exporter = await store.getAccount(invoice.account_id);
        if (exporter) {
          creditBalance(exporter, netKesCents, demo);
          await store.saveAccount(exporter);

          const payout: Payout = {
            id: `payout_direct_${Date.now()}`,
            invoice_id: invoice.id,
            is_demo: demo,
            transaction_id: settleTx.id,
            account_id: exporter.id,
            kind: "credit",
            amount_kes_cents: netKesCents,
            destination_id: null,
            status: "confirmed",
            created_at: new Date().toISOString(),
          };
          await store.addPayout(payout);
          generatedPayouts.push(payout);
          alerts.push({
            phone: exporter.phone_number,
            name: exporter.full_name,
            amountKesCents: netKesCents,
            where: "your Stawi balance",
            reference: invoice.reference,
            purpose: "payment_received",
            coopId: null,
          });
        }
      }
    } else {
      // Stawi Co-op Flow: Awaiting treasurer split approval
      invoice.status = "settling";
      invoice.split_approved = false;
      await store.saveInvoice(invoice);

      // Incoming is only the farmers on this invoice's shipment.
      if (invoice.coop_id) {
        const shipment = await store.getShipmentByInvoice(invoice.id);
        const farmers = shipment?.farmers.filter((farmer) => farmer.kilos > 0) ?? [];
        const splitLines = splitByKilos(grossKesCents, platformFeeCents, farmers);
        for (const line of splitLines) {
          const acc = await store.getAccount(line.account_id);
          if (acc) {
            creditIncoming(acc, line.net_kes_cents, demo);
            await store.saveAccount(acc);
          }
        }
      }
    }

    return {
      invoice,
      transactions: await store.getTransactions(invoiceId),
      payouts: generatedPayouts,
      alerts,
    };
  }

  /**
   * Computes split preview for a Co-op invoice.
   */
  public async getSplitPreview(invoiceId: string): Promise<SplitLine[] | null> {
    const invoice = await store.getInvoice(invoiceId);
    if (!invoice || invoice.type !== "coop" || !invoice.coop_id) {
      return null;
    }

    const shipment = await store.getShipmentByInvoice(invoice.id);
    const farmers = shipment?.farmers.filter((farmer) => farmer.kilos > 0) ?? [];
    if (farmers.length === 0) return [];

    const fxRate = invoice.fx_rate || this.getFxRate(invoice.currency);
    const grossKesCents = toKesCents(invoice.amount, invoice.currency, fxRate);
    const platformFeeCents = invoice.fee_kes_cents !== null ? invoice.fee_kes_cents : feeCents(grossKesCents, 0.8);

    return splitByKilos(grossKesCents, platformFeeCents, farmers);
  }

  /**
   * Confirms the share just saved on a shipment.
   * A live invoice with a verified M-Pesa number is paid by Payaza when the treasurer approves the split.
   * Sample invoices stay on the sample balance. Payaza is not called for them outside mock mode.
   */
  public async describeFarmerShare(shipment: Shipment, accountId: string): Promise<FarmerShareConfirmation> {
    const farmer = shipment.farmers.find((row) => row.account_id === accountId);
    const account = await store.getAccount(accountId);
    const destination = account?.payout_destinations.find(
      (dest) => dest.is_verified && (dest.type === "mpesa" || dest.type === "momo")
    );
    const invoice = shipment.invoice_id ? await store.getInvoice(shipment.invoice_id) : undefined;
    const lines = invoice?.type === "coop" ? await this.getSplitPreview(invoice.id) : null;
    const line = lines?.find((row) => row.account_id === accountId);
    const buyerPaid = invoice != null && invoice.status !== "pending" && invoice.status !== "failed";
    const sample = invoice?.is_demo === true && payaza.getMode() !== "mock";
    let payout: FarmerShareConfirmation["payout"] = "awaiting_payment";
    if (!destination) payout = "balance";
    else if (!buyerPaid) payout = "awaiting_payment";
    else if (sample) payout = "sample_balance";
    else payout = "mpesa_on_approval";

    return {
      account_id: accountId,
      kilos: farmer?.kilos ?? 0,
      share: line?.share ?? null,
      net_kes_cents: line?.net_kes_cents ?? null,
      mpesa: destination ? maskMobile(destination.details) : null,
      payout,
    };
  }

  /**
   * Rewrites incoming balances for a co-op from its settling invoices.
   * Used after the treasurer changes who is on a shipment that is already waiting on the split.
   */
  public async refreshCoopIncoming(coopId: string): Promise<void> {
    const members = await store.getCoopMembers(coopId);
    const totals = new Map<string, { live: number; demo: number }>();
    for (const member of members) totals.set(member.account_id, { live: 0, demo: 0 });

    const invoices = await store.getInvoices({ coop_id: coopId });
    for (const invoice of invoices) {
      if (invoice.status !== "settling") continue;
      const lines = await this.getSplitPreview(invoice.id);
      if (!lines) continue;
      for (const line of lines) {
        const row = totals.get(line.account_id) ?? { live: 0, demo: 0 };
        if (invoice.is_demo) row.demo += line.net_kes_cents;
        else row.live += line.net_kes_cents;
        totals.set(line.account_id, row);
      }
    }

    for (const member of members) {
      const account = await store.getAccount(member.account_id);
      if (!account) continue;
      const row = totals.get(member.account_id) ?? { live: 0, demo: 0 };
      account.incoming_kes_cents = row.live;
      account.demo_incoming_kes_cents = row.demo;
      await store.saveAccount(account);
    }
  }

  /**
   * Approves Co-op split with treasurer PIN and pays out to each farmer:
   * - Enforces treasurer identity and PIN authentication
   * - Rejects double-approval
   * - Allocates exact shares using largest-remainder method
   * - Credits farmer balances and creates credit Payout rows
   */
  public async approveCoopSplit(
    invoiceId: string,
    treasurerId: string,
    pin: string
  ): Promise<{ success: boolean; invoice?: Invoice; payouts?: Payout[]; transfers?: Payout[]; error?: string; attemptsLeft?: number; lockedUntil?: string }> {
    const result = await store.withTransaction(() => this.applyCoopSplit(invoiceId, treasurerId, pin));
    const { alerts: _alerts, ...rest } = result;
    if (!result.success || !result.invoice) {
      await sendPayoutAlerts(result.alerts ?? []);
      return rest;
    }
    // Send each farmer's share on to their M-Pesa / mobile money / bank through Payaza.
    // Farmers with no verified destination keep the money in their Stawi balance and get the balance text.
    const transfers: Payout[] = [];
    const balanceAlerts: PayoutAlert[] = [];
    for (const credit of result.payouts ?? []) {
      const sent = await this.pushToDestination(credit, result.invoice);
      if (sent) transfers.push(sent);
      else {
        const alert = (result.alerts ?? []).find((a) => a.amountKesCents === credit.amount_kes_cents);
        const account = await store.getAccount(credit.account_id);
        if (account) balanceAlerts.push({
          phone: account.phone_number,
          name: account.full_name,
          amountKesCents: credit.amount_kes_cents,
          where: alert?.where ?? "your Stawi balance",
          reference: result.invoice.reference,
          purpose: "share_landed",
          coopId: result.invoice.coop_id,
        });
      }
    }
    await sendPayoutAlerts(balanceAlerts);
    return { ...rest, transfers };
  }

  /**
   * Auto payout after split approval. No PIN: the treasurer's PIN approved the split.
   * Idempotent on the credit payout id. Returns null when the farmer has no verified destination
   * or the credit is sample money outside mock mode.
   * One Payaza transfer per farmer. The row is saved as "sent" before the call so a webhook can confirm it.
   */
  private async pushToDestination(credit: Payout, invoice: Invoice): Promise<Payout | null> {
    const idempotencyKey = `auto-${credit.id}`;
    const existing = await store.getPayoutByIdempotency(idempotencyKey);
    if (existing) return existing;
    if (credit.is_demo && payaza.getMode() !== "mock") return null;

    const account = await store.getAccount(credit.account_id);
    if (!account) return null;
    const destination =
      account.payout_destinations.find((d) => d.is_verified && (d.type === "mpesa" || d.type === "momo")) ||
      account.payout_destinations.find((d) => d.is_verified);
    if (!destination) return null;

    const amount = credit.amount_kes_cents;
    const allocation = allocateWithdrawal(account, amount, payaza.getMode());
    if (!allocation.ok) return null;
    const bankCode = bankCodeFor(destination);
    if (!bankCode && payaza.getMode() !== "mock") return null;

    const reference = ensureTransactionReference(`SPL-${account.id.slice(-6)}-${Date.now()}`);
    const sampleFlags = withdrawalFlags(allocation.fromLive, allocation.fromDemo);
    const payout: Payout = {
      id: `payout_auto_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      invoice_id: invoice.id,
      account_id: account.id,
      kind: "withdrawal",
      amount_kes_cents: amount,
      destination_id: destination.id,
      status: "sent",
      created_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
      payaza_reference: reference,
      ...sampleFlags,
    };

    await store.withTransaction(async () => {
      applyWithdrawal(account, allocation.fromLive, allocation.fromDemo);
      await store.saveAccount(account);
      await store.addPayout(payout);
    });

    const finished = await this.submitTransfer({
      payout,
      narration: `Stawi ${invoice.reference}`,
      alertReference: invoice.reference,
    });
    if (finished.payout.status === "failed") {
      console.warn(`[Payout] auto payout failed for ${account.id}`);
      await sendPayoutAlerts([
        {
          phone: account.phone_number,
          name: account.full_name,
          amountKesCents: amount,
          where: "your Stawi balance",
          reference: invoice.reference,
          purpose: "payout_failed",
          coopId: invoice.coop_id,
        },
      ]);
    } else {
      await sendPayoutAlerts(finished.alerts);
    }
    return finished.payout;
  }

  private async applyCoopSplit(
    invoiceId: string,
    treasurerId: string,
    pin: string
  ): Promise<{ success: boolean; invoice?: Invoice; payouts?: Payout[]; alerts?: PayoutAlert[]; error?: string; attemptsLeft?: number; lockedUntil?: string }> {
    const invoice = await store.getInvoice(invoiceId);
    if (!invoice) {
      return { success: false, error: "Invoice not found" };
    }

    if (invoice.type !== "coop" || !invoice.coop_id) {
      return { success: false, error: "Only co-op invoices can be split" };
    }

    if (invoice.split_approved || invoice.status === "completed") {
      return { success: false, error: "Split already approved for this invoice" };
    }

    const coop = await store.getCoop(invoice.coop_id);
    if (!coop) {
      return { success: false, error: "Co-op not found" };
    }

    if (coop.treasurer_account_id !== treasurerId) {
      return { success: false, error: "Only the designated co-op treasurer can approve splits" };
    }

    const treasurer = await store.getAccount(treasurerId);
    if (!treasurer) {
      return { success: false, error: "Treasurer account not found" };
    }

    // Verify PIN with lockout protection
    const pinCheck = await verifyAccountPin(treasurer, pin);
    await store.saveAccount(treasurer); // Save updated failed attempts / lockout state

    if (!pinCheck.valid) {
      return {
        success: false,
        error: pinCheck.error,
        attemptsLeft: pinCheck.attemptsLeft,
        lockedUntil: pinCheck.lockedUntil,
      };
    }

    const shipment = await store.getShipmentByInvoice(invoice.id);
    const farmers = shipment?.farmers.filter((farmer) => farmer.kilos > 0) ?? [];
    if (farmers.length === 0) {
      return { success: false, error: "Add farmers to the shipment before approving the split" };
    }

    const demo = invoice.is_demo === true;
    const fxRate = invoice.fx_rate || this.getFxRate(invoice.currency);
    const grossKesCents = toKesCents(invoice.amount, invoice.currency, fxRate);
    const platformFeeCents = invoice.fee_kes_cents !== null ? invoice.fee_kes_cents : feeCents(grossKesCents, 0.8);
    const netKesCents = grossKesCents - platformFeeCents;

    invoice.fx_rate = fxRate;
    invoice.fee_kes_cents = platformFeeCents;
    invoice.kes_total_cents = netKesCents;
    invoice.split_approved = true;
    invoice.status = "completed";
    await store.saveInvoice(invoice);

    const settleTx: Transaction = {
      id: `tx_settle_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      invoice_id: invoice.id,
      is_demo: demo,
      type: "settlement",
      status: "completed",
      amount: netKesCents / 100,
      currency: "KES",
      payaza_reference: null,
      fx_rate: null,
      fee_kes_cents: platformFeeCents,
      created_at: new Date().toISOString(),
    };
    await store.addTransaction(settleTx);

    // Exact allocation by the kilos on this shipment
    const splitLines = splitByKilos(grossKesCents, platformFeeCents, farmers);
    const createdPayouts: Payout[] = [];
    const alerts: PayoutAlert[] = [];

    for (const line of splitLines) {
      const farmer = await store.getAccount(line.account_id);
      if (farmer) {
        releaseIncoming(farmer, line.net_kes_cents, demo);
        creditBalance(farmer, line.net_kes_cents, demo);
        await store.saveAccount(farmer);

        const payout: Payout = {
          id: `payout_split_${invoice.id}_${farmer.id}`,
          invoice_id: invoice.id,
          is_demo: demo,
          transaction_id: settleTx.id,
          account_id: farmer.id,
          kind: "credit",
          amount_kes_cents: line.net_kes_cents,
          destination_id: null,
          status: "confirmed",
          created_at: new Date().toISOString(),
        };
        await store.addPayout(payout);
        createdPayouts.push(payout);
        alerts.push({
          phone: farmer.phone_number,
          name: farmer.full_name,
          amountKesCents: line.net_kes_cents,
          where: "your Stawi balance",
          reference: invoice.reference,
          purpose: "share_landed",
          coopId: invoice.coop_id,
        });
      }
    }

    return {
      success: true,
      invoice,
      payouts: createdPayouts,
      alerts,
    };
  }

  /**
   * Applies a classified Payaza webhook. Collection success runs the pipeline.
   * Payout success confirms a withdrawal and sends SMS. Payout failure restores the balance.
   */
  public async applyPayazaWebhook(decision: {
    kind: string;
    reference: string;
    merchantReference: string | null;
    invoiceId: string | null;
    amountReceived?: number;
    currency?: string;
  }): Promise<{ matched: boolean }> {
    if (decision.kind === "payout_success" || decision.kind === "payout_failed") {
      const payout =
        await store.getPayoutByPayazaReference(decision.reference) ||
        (decision.merchantReference ? await store.getPayoutByPayazaReference(decision.merchantReference) : undefined);
      if (!payout || payout.kind !== "withdrawal") return { matched: false };
      if (payout.status === "confirmed" || payout.status === "failed") return { matched: true };

      if (decision.kind === "payout_success") {
        payout.status = "confirmed";
        await store.updatePayout(payout);
        const account = await store.getAccount(payout.account_id);
        const destination = account?.payout_destinations.find((d) => d.id === payout.destination_id);
        if (account) {
          const where = destination?.type === "bank" ? "your bank" : destination?.type === "momo" ? "mobile money" : "M-Pesa";
          await sendPayoutAlerts([
            {
              phone: account.phone_number,
              name: account.full_name,
              amountKesCents: payout.amount_kes_cents,
              where,
              reference: "Withdrawal",
              purpose: "payout_sent",
              coopId: account.coop_id,
            },
          ]);
        }
        return { matched: true };
      }

      await store.withTransaction(async () => {
        const fresh = await store.getPayout(payout.id);
        const account = fresh ? await store.getAccount(fresh.account_id) : undefined;
        if (!fresh || !account) return;
        if (fresh.status !== "sent" && fresh.status !== "pending") return;
        restoreWithdrawal(account, fresh);
        await store.saveAccount(account);
        fresh.status = "failed";
        await store.updatePayout(fresh);
      });
      return { matched: true };
    }

    const invoice = await this.findInvoiceForWebhook(decision);
    if (!invoice) return { matched: false };

    if (decision.kind === "collection_failed" || decision.kind === "underpayment") {
      if (invoice.status === "pending" || invoice.status === "paid") {
        invoice.status = "failed";
        await store.saveInvoice(invoice);
        await store.addTransaction({
          id: `tx_col_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          invoice_id: invoice.id,
          type: "collection",
          status: "failed",
          amount: decision.amountReceived || invoice.amount,
          currency: decision.currency || invoice.currency,
          payaza_reference: decision.reference || decision.merchantReference,
          fx_rate: null,
          fee_kes_cents: null,
          is_demo: invoice.is_demo === true,
          created_at: new Date().toISOString(),
        });
      }
      return { matched: true };
    }

    if (decision.kind === "collection_success") {
      await this.processPayment(
        invoice.id,
        decision.merchantReference || decision.reference,
        decision.amountReceived,
        decision.currency
      );
      return { matched: true };
    }

    return { matched: false };
  }

  private async findInvoiceForWebhook(decision: {
    reference: string;
    merchantReference: string | null;
    invoiceId: string | null;
  }) {
    if (decision.invoiceId) {
      const byId = await store.getInvoice(decision.invoiceId);
      if (byId) return byId;
    }
    const refs = [decision.merchantReference, decision.reference].filter((r): r is string => Boolean(r));
    const invoices = await store.getInvoices();
    return (
      invoices.find(
        (inv) =>
          (inv.payaza_checkout_reference && refs.includes(inv.payaza_checkout_reference)) ||
          (inv.payaza_link_id && refs.includes(inv.payaza_link_id)) ||
          refs.some((r) => r.includes(inv.id))
      ) || null
    );
  }

  /**
   * Withdraws funds from an Account balance to a verified M-Pesa / Bank destination:
   * - Enforces PIN check & lockout
   * - Ensures idempotency
   * - Prevents overdraw
   * - Calls Payaza payout endpoint
   * - Emits SMS notification
   */
  public async withdraw(
    accountId: string,
    destinationId: string,
    amountKesCents: number,
    pin: string,
    idempotencyKey?: string
  ): Promise<{ success: boolean; payout?: Payout; error?: string; attemptsLeft?: number; lockedUntil?: string }> {
    const prepared = await store.withTransaction(() =>
      this.prepareWithdraw(accountId, destinationId, amountKesCents, pin, idempotencyKey)
    );
    if (!prepared.success || !prepared.payout || prepared.replay) {
      return { success: prepared.success, payout: prepared.payout, error: prepared.error, attemptsLeft: prepared.attemptsLeft, lockedUntil: prepared.lockedUntil };
    }

    const finished = await this.submitTransfer({
      payout: prepared.payout,
      narration: "Stawi withdrawal",
      alertReference: "Withdrawal",
    });
    await sendPayoutAlerts(finished.alerts);
    if (finished.payout.status === "failed") {
      return { success: false, error: finished.error || "Payaza payout failed", payout: finished.payout };
    }
    return { success: true, payout: finished.payout };
  }

  private async prepareWithdraw(
    accountId: string,
    destinationId: string,
    amountKesCents: number,
    pin: string,
    idempotencyKey?: string
  ): Promise<{ success: boolean; payout?: Payout; replay?: boolean; error?: string; attemptsLeft?: number; lockedUntil?: string }> {
    if (idempotencyKey) {
      const existing = await store.getPayoutByIdempotency(idempotencyKey);
      if (existing) {
        return { success: true, payout: existing, replay: true };
      }
    }

    const account = await store.getAccount(accountId);
    if (!account) {
      return { success: false, error: "Account not found" };
    }

    if (!Number.isInteger(amountKesCents) || amountKesCents <= 0) {
      return { success: false, error: "Invalid withdrawal amount: must be positive integer cents" };
    }

    const pinCheck = await verifyAccountPin(account, pin);
    await store.saveAccount(account);

    if (!pinCheck.valid) {
      return {
        success: false,
        error: pinCheck.error,
        attemptsLeft: pinCheck.attemptsLeft,
        lockedUntil: pinCheck.lockedUntil,
      };
    }

    const destination = account.payout_destinations.find((d) => d.id === destinationId);
    if (!destination) {
      return { success: false, error: "Destination not found on account" };
    }
    if (!destination.is_verified) {
      return { success: false, error: "Cannot withdraw to unverified destination" };
    }

    const allocation = allocateWithdrawal(account, amountKesCents, payaza.getMode());
    if (!allocation.ok) {
      return { success: false, error: allocation.error };
    }

    const bankCode = bankCodeFor(destination);
    if (destination.type !== "mpesa" && !bankCode && payaza.getMode() !== "mock") {
      return { success: false, error: "Bank code is required before a bank withdrawal" };
    }

    applyWithdrawal(account, allocation.fromLive, allocation.fromDemo);
    const sampleFlags = withdrawalFlags(allocation.fromLive, allocation.fromDemo);
    await store.saveAccount(account);

    const payout: Payout = {
      id: `payout_wth_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      invoice_id: "withdrawal",
      account_id: account.id,
      kind: "withdrawal",
      amount_kes_cents: amountKesCents,
      destination_id: destination.id,
      status: "sent",
      created_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
      payaza_reference: ensureTransactionReference(`WTH-${accountId.slice(-6)}-${Date.now()}`),
      ...sampleFlags,
    };
    await store.addPayout(payout);
    return { success: true, payout };
  }

  /**
   * One Payaza transfer, one person. The payout row already exists as "sent".
   * Mock mode confirms it. Sandbox and live stay "sent" until the payout webhook.
   * A rejected call puts the cents back. A webhook that already finished the row is left alone.
   */
  private async submitTransfer(input: {
    payout: Payout;
    narration: string;
    alertReference: string;
  }): Promise<{ payout: Payout; alerts: PayoutAlert[]; error?: string }> {
    const account = await store.getAccount(input.payout.account_id);
    const destination = account?.payout_destinations.find((d) => d.id === input.payout.destination_id);
    if (!account || !destination || !input.payout.payaza_reference) {
      return { payout: input.payout, alerts: [], error: "Payout destination is missing" };
    }

    const bankCode = bankCodeFor(destination);
    const major = input.payout.amount_kes_cents / 100;
    const result = await payaza.initiatePayout({
      payout_amount: major,
      currency: "KES",
      transaction_type: destination.type === "bank" ? "kepss" : "mobile_money",
      beneficiaries: [
        {
          credit_amount: major,
          account_number: destination.details,
          account_name: destination.account_name,
          bank_code: bankCode,
          narration: input.narration,
          transaction_reference: input.payout.payaza_reference,
        },
      ],
    });

    const current = (await store.getPayout(input.payout.id)) ?? input.payout;
    if (current.status === "confirmed" || current.status === "failed") {
      return { payout: current, alerts: [] };
    }

    if (!result.success) {
      await store.withTransaction(async () => {
        const fresh = (await store.getPayout(current.id)) ?? current;
        const holder = await store.getAccount(fresh.account_id);
        if (!holder || (fresh.status !== "sent" && fresh.status !== "pending")) return;
        restoreWithdrawal(holder, fresh);
        await store.saveAccount(holder);
        fresh.status = "failed";
        await store.updatePayout(fresh);
      });
      const failed = (await store.getPayout(current.id)) ?? current;
      return { payout: failed, alerts: [], error: result.error || "Payaza payout failed" };
    }

    if (payaza.getMode() !== "mock") {
      return { payout: current, alerts: [] };
    }

    current.status = "confirmed";
    await store.updatePayout(current);
    return {
      payout: current,
      alerts: [
        {
          phone: account.phone_number,
          name: account.full_name,
          amountKesCents: current.amount_kes_cents,
          where: destination.type === "bank" ? "your bank" : destination.type === "momo" ? "mobile money" : "M-Pesa",
          reference: input.alertReference,
          purpose: "payout_sent",
          coopId: account.coop_id,
        },
      ],
    };
  }
}

function maskMobile(details: string): string {
  const digits = details.replace(/\D/g, "");
  return `•••• ${digits.slice(-4)}`;
}

function bankCodeFor(destination: { type: string; bank_code?: string }): string {
  return (
    destination.bank_code ||
    (destination.type === "mpesa"
      ? process.env.PAYAZA_MPESA_BANK_CODE || "SAFKEN"
      : destination.type === "momo"
        ? process.env.PAYAZA_MOMO_BANK_CODE || ""
        : process.env.PAYAZA_BANK_CODE || "")
  );
}

export const pipeline = new PipelineService();
