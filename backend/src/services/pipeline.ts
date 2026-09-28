import { store } from "../store";
import { Invoice, Payout, SplitLine, Transaction } from "../types";
import { feeCents, splitByShares, toKesCents } from "./money";
import { notify } from "./notify";
import { ensureTransactionReference, payaza } from "./payaza";
import { verifyAccountPin } from "./pin";

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
    return await store.withTransaction(() => this.applyCollection(invoiceId, payazaRef, paidAmount, paidCurrency));
  }

  private async applyCollection(
    invoiceId: string,
    payazaRef?: string,
    paidAmount?: number,
    paidCurrency?: string
  ): Promise<{ invoice: Invoice; transactions: Transaction[]; payouts: Payout[] }> {
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
      };
    }

    const effectiveAmount = paidAmount || invoice.amount;
    const effectiveCurrency = paidCurrency || invoice.currency;
    const effectivePayazaRef = payazaRef || `PZ-COL-${Date.now()}`;

    // 1. Collection Transaction
    const colTx: Transaction = {
      id: `tx_col_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      invoice_id: invoice.id,
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

    if (invoice.type === "direct") {
      // Stawi Direct Flow: Immediate settlement & credit to exporter
      invoice.status = "completed";
      await store.saveInvoice(invoice);

      const settleTx: Transaction = {
        id: `tx_settle_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        invoice_id: invoice.id,
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
          exporter.balance_kes_cents += netKesCents;
          await store.saveAccount(exporter);

          const payout: Payout = {
            id: `payout_direct_${Date.now()}`,
            invoice_id: invoice.id,
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

          // Best-effort SMS alert
          notify.notifyPayoutLanded(exporter.phone_number, netKesCents, "Stawi").catch(() => {});
        }
      }
    } else {
      // Stawi Co-op Flow: Awaiting treasurer split approval
      invoice.status = "settling";
      invoice.split_approved = false;
      await store.saveInvoice(invoice);

      // Pre-calculate preview and mark incoming_kes_cents on members
      if (invoice.coop_id) {
        const members = await store.getCoopMembers(invoice.coop_id);
        const splitLines = splitByShares(grossKesCents, platformFeeCents, members);
        for (const line of splitLines) {
          const acc = await store.getAccount(line.account_id);
          if (acc) {
            acc.incoming_kes_cents += line.net_kes_cents;
            await store.saveAccount(acc);
          }
        }
      }
    }

    return {
      invoice,
      transactions: await store.getTransactions(invoiceId),
      payouts: generatedPayouts,
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

    const members = await store.getCoopMembers(invoice.coop_id);
    if (members.length === 0) return [];

    const fxRate = invoice.fx_rate || this.getFxRate(invoice.currency);
    const grossKesCents = toKesCents(invoice.amount, invoice.currency, fxRate);
    const platformFeeCents = invoice.fee_kes_cents !== null ? invoice.fee_kes_cents : feeCents(grossKesCents, 0.8);

    return splitByShares(grossKesCents, platformFeeCents, members);
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
    return await store.withTransaction(() => this.applyCoopSplit(invoiceId, treasurerId, pin));
  }

  private async applyCoopSplit(
    invoiceId: string,
    treasurerId: string,
    pin: string
  ): Promise<{ success: boolean; invoice?: Invoice; payouts?: Payout[]; error?: string; attemptsLeft?: number; lockedUntil?: string }> {
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

    const members = await store.getCoopMembers(coop.id);
    if (members.length === 0) {
      return { success: false, error: "Co-op has no members to receive payout" };
    }

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

    // Exact allocation by shares
    const splitLines = splitByShares(grossKesCents, platformFeeCents, members);
    const createdPayouts: Payout[] = [];

    for (const line of splitLines) {
      const farmer = await store.getAccount(line.account_id);
      if (farmer) {
        farmer.incoming_kes_cents = Math.max(0, farmer.incoming_kes_cents - line.net_kes_cents);
        farmer.balance_kes_cents += line.net_kes_cents;
        await store.saveAccount(farmer);

        const payout: Payout = {
          id: `payout_split_${invoice.id}_${farmer.id}`,
          invoice_id: invoice.id,
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

        notify.notifyPayoutLanded(farmer.phone_number, line.net_kes_cents, "Stawi").catch(() => {});
      }
    }

    return {
      success: true,
      invoice,
      payouts: createdPayouts,
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
            notify
              .notifyPayoutLanded(account.phone_number, payout.amount_kes_cents, destination?.details || "M-Pesa")
              .catch(() => {});
          }
        }
        return { matched: true };
      }

      if (payout.status !== "failed" && payout.kind === "withdrawal") {
        const account = await store.getAccount(payout.account_id);
        if (account) {
          account.balance_kes_cents += payout.amount_kes_cents;
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
    return await store.withTransaction(() => this.applyWithdraw(accountId, destinationId, amountKesCents, pin, idempotencyKey));
  }

  private async applyWithdraw(
    accountId: string,
    destinationId: string,
    amountKesCents: number,
    pin: string,
    idempotencyKey?: string
  ): Promise<{ success: boolean; payout?: Payout; error?: string; attemptsLeft?: number; lockedUntil?: string }> {
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

    // 5. Check Balance (Prevent overdraw)
    if (account.balance_kes_cents < amountKesCents) {
      return {
        success: false,
        error: `Insufficient balance. Available: KES ${(account.balance_kes_cents / 100).toFixed(2)}`,
      };
    }

    const bankCode =
      destination.bank_code ||
      (destination.type === "mpesa" ? process.env.PAYAZA_MPESA_BANK_CODE || "SAFKEN" : process.env.PAYAZA_BANK_CODE || "");

    if (destination.type === "bank" && !bankCode && payaza.getMode() !== "mock") {
      return { success: false, error: "Bank code is required before a bank withdrawal" };
    }

    // 6. Deduct balance
    account.balance_kes_cents -= amountKesCents;
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
      account.balance_kes_cents += amountKesCents;
      await store.saveAccount(account);
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
      };
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
    };
    await store.addPayout(payout);

    if (settled) {
      notify.notifyPayoutLanded(account.phone_number, amountKesCents, destination.details).catch(() => {});
    }

    return {
      success: true,
      payout,
    };
  }
}

export const pipeline = new PipelineService();
