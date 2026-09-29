import { store } from "../store";
import { Invoice, Payout, SplitLine, Transaction } from "../types";
import {
  allocateWithdrawal,
  applyWithdrawal,
  creditBalance,
  creditIncoming,
  releaseIncoming,
  restoreWithdrawal,
  withdrawalFlags,
} from "./demoData";
import { feeCents, splitByKilos, toKesCents } from "./money";
import { notify } from "./notify";
import { ensureTransactionReference, payaza } from "./payaza";
import { verifyAccountPin } from "./pin";

type PayoutAlert = {
  phone: string;
  name: string;
  amountKesCents: number;
  where: string;
  reference?: string;
};

/** Best-effort. A failed text never undoes the payout. */
async function sendPayoutAlerts(alerts: PayoutAlert[]): Promise<void> {
  for (const alert of alerts) {
    try {
      await notify.notifyPayoutLanded(alert.phone, alert.amountKesCents, alert.where, {
        name: alert.name,
        reference: alert.reference,
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
    switch (currency.toUpperCase()) {
      case "USD":
        return 129.0;
      case "EUR":
        return 142.0;
      case "GBP":
        return 168.0;
      case "KES":
        return 1.0;
      default:
        return 129.0;
    }
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
        payaza_reference: `PZ-SETTLE-${Date.now()}`,
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
  ): Promise<{ success: boolean; invoice?: Invoice; payouts?: Payout[]; error?: string; attemptsLeft?: number; lockedUntil?: string }> {
    const result = await store.withTransaction(() => this.applyCoopSplit(invoiceId, treasurerId, pin));
    await sendPayoutAlerts(result.alerts ?? []);
    const { alerts: _alerts, ...rest } = result;
    return rest;
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
      payaza_reference: `PZ-SETTLE-${Date.now()}`,
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
      if (!payout) return { matched: false };

      if (decision.kind === "payout_success") {
        if (payout.status !== "confirmed") {
          payout.status = "confirmed";
          await store.updatePayout(payout);
          const account = await store.getAccount(payout.account_id);
          const destination = account?.payout_destinations.find((d) => d.id === payout.destination_id);
          if (account) {
            const where = destination?.type === "bank" ? "your bank" : "M-Pesa";
            await sendPayoutAlerts([
              {
                phone: account.phone_number,
                name: account.full_name,
                amountKesCents: payout.amount_kes_cents,
                where,
                reference: "Withdrawal",
              },
            ]);
          }
        }
        return { matched: true };
      }

      if (payout.status !== "failed" && payout.kind === "withdrawal") {
        const account = await store.getAccount(payout.account_id);
        if (account) {
          restoreWithdrawal(account, payout);
          await store.saveAccount(account);
        }
      }
      payout.status = "failed";
      await store.updatePayout(payout);
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
    const result = await store.withTransaction(() =>
      this.applyWithdraw(accountId, destinationId, amountKesCents, pin, idempotencyKey)
    );
    await sendPayoutAlerts(result.alerts ?? []);
    const { alerts: _alerts, ...rest } = result;
    return rest;
  }

  private async applyWithdraw(
    accountId: string,
    destinationId: string,
    amountKesCents: number,
    pin: string,
    idempotencyKey?: string
  ): Promise<{ success: boolean; payout?: Payout; alerts?: PayoutAlert[]; error?: string; attemptsLeft?: number; lockedUntil?: string }> {
    // 1. Idempotency Check
    if (idempotencyKey) {
      const existing = await store.getPayoutByIdempotency(idempotencyKey);
      if (existing) {
        return { success: true, payout: existing };
      }
    }

    const account = await store.getAccount(accountId);
    if (!account) {
      return { success: false, error: "Account not found" };
    }

    // 2. Validate Amount
    if (!Number.isInteger(amountKesCents) || amountKesCents <= 0) {
      return { success: false, error: "Invalid withdrawal amount: must be positive integer cents" };
    }

    // 3. Verify PIN
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

    // 4. Validate Destination
    const destination = account.payout_destinations.find((d) => d.id === destinationId);
    if (!destination) {
      return { success: false, error: "Destination not found on account" };
    }
    if (!destination.is_verified) {
      return { success: false, error: "Cannot withdraw to unverified destination" };
    }

    // 5. Check Balance (Prevent overdraw). Sample funds are spendable only in mock mode.
    const allocation = allocateWithdrawal(account, amountKesCents, payaza.getMode());
    if (!allocation.ok) {
      return { success: false, error: allocation.error };
    }

    const bankCode =
      destination.bank_code ||
      (destination.type === "mpesa" ? process.env.PAYAZA_MPESA_BANK_CODE || "SAFKEN" : process.env.PAYAZA_BANK_CODE || "");

    if (destination.type === "bank" && !bankCode && payaza.getMode() !== "mock") {
      return { success: false, error: "Bank code is required before a bank withdrawal" };
    }

    // 6. Deduct balance. Live cents first, then sample cents when mock mode allowed them.
    applyWithdrawal(account, allocation.fromLive, allocation.fromDemo);
    const sampleFlags = withdrawalFlags(allocation.fromLive, allocation.fromDemo);
    await store.saveAccount(account);

    // 7. Execute Payaza payout. Amounts are major KES; payout_amount equals credit_amount.
    const payoutTxRef = ensureTransactionReference(`WTH-${accountId.slice(-6)}-${Date.now()}`);
    const majorKes = amountKesCents / 100;
    const payazaResult = await payaza.initiatePayout({
      payout_amount: majorKes,
      currency: "KES",
      transaction_type: destination.type === "mpesa" ? "mobile_money" : "kepss",
      beneficiaries: [
        {
          credit_amount: majorKes,
          account_number: destination.details,
          account_name: destination.account_name,
          bank_code: bankCode,
          narration: "Stawi withdrawal",
          transaction_reference: payoutTxRef,
        },
      ],
    });

    if (!payazaResult.success) {
      const failed: Payout = {
        id: `payout_wth_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        invoice_id: "withdrawal",
        account_id: account.id,
        kind: "withdrawal",
        amount_kes_cents: amountKesCents,
        destination_id: destination.id,
        status: "failed",
        created_at: new Date().toISOString(),
        payaza_reference: payoutTxRef,
        ...sampleFlags,
      };
      restoreWithdrawal(account, failed);
      await store.saveAccount(account);
      await store.addPayout(failed);
      return { success: false, error: payazaResult.error || "Payaza payout failed", payout: failed };
    }

    // Mock settles immediately. Sandbox/live stays "sent" until the payout webhook.
    const settled = payaza.getMode() === "mock";
    const payout: Payout = {
      id: `payout_wth_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      invoice_id: "withdrawal",
      account_id: account.id,
      kind: "withdrawal",
      amount_kes_cents: amountKesCents,
      destination_id: destination.id,
      status: settled ? "confirmed" : "sent",
      created_at: new Date().toISOString(),
      idempotency_key: idempotencyKey,
      payaza_reference: payoutTxRef,
      ...sampleFlags,
    };
    await store.addPayout(payout);

    const alerts: PayoutAlert[] = settled
      ? [
          {
            phone: account.phone_number,
            name: account.full_name,
            amountKesCents,
            where: destination.type === "bank" ? "your bank" : "M-Pesa",
            reference: "Withdrawal",
          },
        ]
      : [];

    return {
      success: true,
      payout,
      alerts,
    };
  }
}

export const pipeline = new PipelineService();
