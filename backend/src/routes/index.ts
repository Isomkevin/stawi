import { Router, Request, Response } from "express";
import { SEED_IDS } from "../data/seed";
import { feeCents, toKesCents } from "../services/money";
import { payaza } from "../services/payaza";
import { hashPin } from "../services/pin";
import { pipeline } from "../services/pipeline";
import { store } from "../store";
import { Account, CoopMember, Invoice, PublicAccount } from "../types";
import { handleUssdCallback } from "../ussd/handler";

export const apiRouter = Router();

function getParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || "";
  return param || "";
}

function toPublicAccount(account: Account): PublicAccount {
  const { pin_hash, pin_failed_attempts, pin_locked_until, ...rest } = account;
  return rest;
}

// -------------------------------------------------------------
// Health
// -------------------------------------------------------------
apiRouter.get("/health", (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

// -------------------------------------------------------------
// Accounts
// -------------------------------------------------------------
apiRouter.post("/accounts", async (req: Request, res: Response) => {
  try {
    const {
      full_name,
      phone_number,
      id_number,
      pin,
      destination,
      ussd,
      coop_id,
    } = req.body;

    if (!full_name || !phone_number || !id_number || !pin) {
      res.status(400).json({ error: "Missing required fields (full_name, phone_number, id_number, pin)" });
      return;
    }

    if (!/^\d{4}$/.test(String(pin))) {
      res.status(400).json({ error: "PIN must be exactly 4 digits" });
      return;
    }

    const pin_hash = await hashPin(String(pin));
    const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const destinations = destination
      ? [
          {
            id: `dest_${Date.now()}`,
            type: destination.type || "mpesa",
            details: destination.details || phone_number,
            account_name: destination.account_name || full_name,
            is_verified: true,
          },
        ]
      : [];

    const newAccount: Account = {
      id: accountId,
      full_name,
      phone_number,
      id_number,
      payout_destinations: destinations,
      coop_id: coop_id || null,
      channel_capability: ussd ? "webapp+ussd" : "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 0,
      pin_hash,
      pin_failed_attempts: 0,
      pin_locked_until: null,
    };

    store.saveAccount(newAccount);
    res.status(201).json(toPublicAccount(newAccount));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

apiRouter.get("/accounts/:id", (req: Request, res: Response) => {
  const account = store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.status(200).json(toPublicAccount(account));
});

apiRouter.get("/accounts/:id/balance", (req: Request, res: Response) => {
  const account = store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.status(200).json({
    balance_kes_cents: account.balance_kes_cents,
    incoming_kes_cents: account.incoming_kes_cents,
  });
});

apiRouter.get("/accounts/:id/transactions", (req: Request, res: Response) => {
  const account = store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const payouts = store.getPayoutsByAccount(account.id, limit);
  res.status(200).json(payouts);
});

apiRouter.post("/accounts/:id/destinations", (req: Request, res: Response) => {
  const account = store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const { type, details, account_name } = req.body ?? {};
  if ((type !== "mpesa" && type !== "bank") || !details || !account_name) {
    res.status(400).json({ error: "Missing type, details or account_name" });
    return;
  }
  const clean = String(details).replace(/\s/g, "");
  const valid = type === "mpesa" ? /^\+?\d{9,13}$/.test(clean) : /^\d{6,20}$/.test(clean);
  if (!valid) {
    res.status(400).json({ error: type === "mpesa" ? "Invalid M-Pesa number" : "Invalid bank account number" });
    return;
  }
  const normalized = type === "mpesa" ? store.normalizePhone(clean) : clean;
  if (account.payout_destinations.some((d) => d.type === type && d.details === normalized)) {
    res.status(409).json({ error: "Destination already added" });
    return;
  }
  const destination = {
    id: `dest_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
    type,
    details: normalized,
    account_name: String(account_name).slice(0, 255),
    // TODO(payaza): set via Payaza name enquiry; treated as verified once the name resolved.
    is_verified: true,
  } as const;
  account.payout_destinations.push({ ...destination });
  store.saveAccount(account);
  res.status(201).json(destination);
});

apiRouter.delete("/accounts/:id/destinations/:destId", (req: Request, res: Response) => {
  const account = store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const destId = getParam(req.params.destId);
  if (!account.payout_destinations.some((d) => d.id === destId)) {
    res.status(404).json({ error: "Destination not found" });
    return;
  }
  if (account.payout_destinations.length <= 1) {
    res.status(400).json({ error: "Keep at least one payout destination" });
    return;
  }
  account.payout_destinations = account.payout_destinations.filter((d) => d.id !== destId);
  store.saveAccount(account);
  res.status(204).end();
});

apiRouter.post("/accounts/:id/withdraw", async (req: Request, res: Response) => {
  try {
    const { destination_id, amount_kes_cents, pin, idempotency_key } = req.body;
    if (!destination_id || amount_kes_cents === undefined || !pin) {
      res.status(400).json({ error: "Missing required fields (destination_id, amount_kes_cents, pin)" });
      return;
    }

    const result = await pipeline.withdraw(
      getParam(req.params.id),
      destination_id,
      parseInt(amount_kes_cents, 10),
      String(pin),
      idempotency_key
    );

    if (!result.success) {
      if (result.error === "wrong" || result.error === "locked") {
        res.status(403).json({
          error: result.error,
          attemptsLeft: result.attemptsLeft,
          lockedUntil: result.lockedUntil,
        });
        return;
      }
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(200).json(result.payout);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------
// Co-ops
// -------------------------------------------------------------
apiRouter.post("/coops", (req: Request, res: Response) => {
  const { name, treasurer_account_id } = req.body;
  if (!name || !treasurer_account_id) {
    res.status(400).json({ error: "Missing name or treasurer_account_id" });
    return;
  }

  const treasurer = store.getAccount(treasurer_account_id);
  if (!treasurer) {
    res.status(400).json({ error: "Treasurer account does not exist" });
    return;
  }

  const coopId = `coop_${Date.now()}`;
  const coop = store.saveCoop({
    id: coopId,
    name,
    treasurer_account_id,
  });

  treasurer.coop_id = coopId;
  store.saveAccount(treasurer);

  res.status(201).json(coop);
});

apiRouter.get("/coops/:id", (req: Request, res: Response) => {
  const coop = store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }
  res.status(200).json(coop);
});

apiRouter.get("/coops/:id/members", (req: Request, res: Response) => {
  const coop = store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }
  const members = store.getCoopMembers(getParam(req.params.id));
  res.status(200).json(members);
});

apiRouter.post("/coops/:id/members", (req: Request, res: Response) => {
  const coop = store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }

  const { account_id, contribution_share, kilos } = req.body;
  if (!account_id || contribution_share === undefined) {
    res.status(400).json({ error: "Missing account_id or contribution_share" });
    return;
  }

  const account = store.getAccount(account_id);
  if (!account) {
    res.status(400).json({ error: "Account does not exist" });
    return;
  }

  account.coop_id = coop.id;
  store.saveAccount(account);

  const member: CoopMember = {
    coop_id: coop.id,
    account_id,
    full_name: account.full_name,
    contribution_share: Number(contribution_share),
    kilos: kilos !== undefined ? Number(kilos) : undefined,
  };

  store.addCoopMember(member);
  res.status(201).json(member);
});

apiRouter.patch("/coops/:id/members/:accountId", (req: Request, res: Response) => {
  const coopId = getParam(req.params.id);
  const accountId = getParam(req.params.accountId);
  const existing = store.getCoopMembers(coopId).find((m) => m.account_id === accountId);
  if (!existing) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  const share = Number(req.body?.contribution_share);
  if (!Number.isFinite(share) || share < 0 || share > 100) {
    res.status(400).json({ error: "contribution_share must be between 0 and 100" });
    return;
  }
  const updated: CoopMember = { ...existing, contribution_share: share };
  store.addCoopMember(updated);
  res.status(200).json(updated);
});

apiRouter.get("/coops/:id/payouts", (req: Request, res: Response) => {
  const coop = store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }
  const invoiceIds = new Set(store.getInvoices({ coop_id: coop.id }).map((i) => i.id));
  const payouts = store
    .getCoopMembers(coop.id)
    .flatMap((m) => store.getPayoutsByAccount(m.account_id))
    .filter((p) => invoiceIds.has(p.invoice_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.status(200).json(payouts);
});

// TODO(payaza): replace with Payaza name-enquiry once the endpoint is confirmed in sandbox docs.
apiRouter.post("/name-enquiry", (req: Request, res: Response) => {
  const { type, details } = req.body ?? {};
  if ((type !== "mpesa" && type !== "bank") || !details) {
    res.status(400).json({ error: "Missing type or details" });
    return;
  }
  const match =
    type === "mpesa"
      ? store.getAccountByPhone(String(details))
      : store.getAllAccounts().find((a) => a.payout_destinations.some((d) => d.details === details));
  if (!match) {
    res.status(404).json({ error: "Account name not found" });
    return;
  }
  res.status(200).json({ account_name: match.full_name });
});

apiRouter.get("/coops/:id/metrics", (req: Request, res: Response) => {
  const coop = store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }

  const invoices = store.getInvoices({ coop_id: coop.id });
  let total_collected_kes_cents = 0;
  let fee_taken_kes_cents = 0;
  let total_split_kes_cents = 0;

  for (const inv of invoices) {
    if (inv.status === "completed" || inv.status === "settling") {
      const gross = (inv.kes_total_cents || 0) + (inv.fee_kes_cents || 0);
      total_collected_kes_cents += gross;
      fee_taken_kes_cents += inv.fee_kes_cents || 0;
      if (inv.split_approved) {
        total_split_kes_cents += inv.kes_total_cents || 0;
      }
    }
  }

  res.status(200).json({
    invoices: invoices.length,
    total_collected_kes_cents,
    fee_taken_kes_cents,
    total_split_kes_cents,
    avg_payout_time: "Same day (< 2 hrs)",
  });
});

// -------------------------------------------------------------
// Invoices
// -------------------------------------------------------------
apiRouter.get("/invoices", (req: Request, res: Response) => {
  const coop_id = req.query.coop_id as string | undefined;
  const account_id = req.query.account_id as string | undefined;
  const invoices = store.getInvoices({ coop_id, account_id });
  res.status(200).json(invoices);
});

apiRouter.post("/invoices", (req: Request, res: Response) => {
  const {
    type,
    account_id,
    coop_id,
    buyer_name,
    buyer_email,
    buyer_phone,
    amount,
    currency,
    description,
    reference,
    due_at,
  } = req.body;

  if (!type || !buyer_name || !buyer_email || amount === undefined || !currency) {
    res.status(400).json({ error: "Missing required invoice fields" });
    return;
  }

  if (type === "direct" && !account_id) {
    res.status(400).json({ error: "Direct invoices require account_id" });
    return;
  }

  if (type === "coop" && !coop_id) {
    res.status(400).json({ error: "Co-op invoices require coop_id" });
    return;
  }

  const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const invRef = reference || `INV-${type.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  const invoice: Invoice = {
    id: invoiceId,
    type,
    account_id: type === "direct" ? account_id : null,
    coop_id: type === "coop" ? coop_id : null,
    buyer_name,
    buyer_email,
    buyer_phone,
    amount: Number(amount),
    currency: currency.toUpperCase(),
    description: description || `Stawi Invoice ${invRef}`,
    reference: invRef,
    status: "pending",
    split_approved: false,
    fx_rate: null,
    fee_kes_cents: null,
    kes_total_cents: null,
    payaza_checkout_reference: null,
    created_at: new Date().toISOString(),
    due_at: due_at || null,
  };

  store.saveInvoice(invoice);
  res.status(201).json(invoice);
});

apiRouter.get("/invoices/:id", (req: Request, res: Response) => {
  const invoice = store.getInvoice(getParam(req.params.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const transactions = store.getTransactions(invoice.id);
  const split_preview = invoice.type === "coop" ? pipeline.getSplitPreview(invoice.id) : null;

  res.status(200).json({
    invoice,
    transactions,
    split_preview,
  });
});

apiRouter.post("/invoices/:id/checkout-session", async (req: Request, res: Response) => {
  try {
    const invoice = store.getInvoice(getParam(req.params.id));
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const session = await payaza.createCheckoutSession(invoice);
    invoice.payaza_checkout_reference = session.transaction_reference;
    store.saveInvoice(invoice);

    res.status(200).json(session);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

apiRouter.post("/invoices/:id/approve-split", async (req: Request, res: Response) => {
  try {
    const { treasurer_id, pin } = req.body;
    if (!treasurer_id || !pin) {
      res.status(400).json({ error: "Missing treasurer_id or pin" });
      return;
    }

    const result = await pipeline.approveCoopSplit(getParam(req.params.id), treasurer_id, String(pin));

    if (!result.success) {
      if (result.error === "wrong" || result.error === "locked") {
        res.status(403).json({
          error: result.error,
          attemptsLeft: result.attemptsLeft,
          lockedUntil: result.lockedUntil,
        });
        return;
      }
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(200).json({
      success: true,
      invoice: result.invoice,
      payouts: result.payouts,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------
// Payaza Webhooks
// -------------------------------------------------------------
apiRouter.post("/webhooks/payaza", async (req: Request, res: Response) => {
  try {
    const sigHeader = (req.headers["x-payaza-signature"] || "") as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    const isValid = payaza.verifyWebhookSignature(rawBody, sigHeader);
    if (!isValid) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const payload = req.body || {};
    const transactionRef = payload.merchant_reference || payload.transaction_reference;

    if (!transactionRef) {
      res.status(400).json({ error: "Missing transaction reference" });
      return;
    }

    // Deduplication / Idempotency
    if (store.isWebhookProcessed(transactionRef)) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }
    store.markWebhookProcessed(transactionRef);

    // Correlate with Invoice
    const allInvoices = store.getInvoices();
    const matchedInvoice = allInvoices.find(
      (inv) =>
        inv.id === payload.additional_details?.invoice_id ||
        transactionRef.includes(inv.id) ||
        inv.payaza_checkout_reference === transactionRef
    );

    if (matchedInvoice) {
      await pipeline.processPayment(
        matchedInvoice.id,
        transactionRef,
        payload.amount_received || payload.request_amount,
        payload.currency_code
      );
    }

    res.status(200).json({ received: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------
// Africa's Talking USSD Gateway Callback
// -------------------------------------------------------------
apiRouter.post("/ussd/callback", handleUssdCallback);

// -------------------------------------------------------------
// Dev Routes (Active in mock mode)
// -------------------------------------------------------------
apiRouter.post("/dev/simulate-payment/:invoiceId", async (req: Request, res: Response) => {
  if (payaza.getMode() !== "mock") {
    res.status(403).json({ error: "Simulation only available when PAYAZA_MODE=mock" });
    return;
  }

  try {
    const invoice = store.getInvoice(getParam(req.params.invoiceId));
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const result = await pipeline.processPayment(invoice.id);
    res.status(200).json({
      success: true,
      invoice: result.invoice,
      transactions: result.transactions,
      payouts: result.payouts,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

apiRouter.get("/dev/seed-ids", (req: Request, res: Response) => {
  if (payaza.getMode() !== "mock") {
    res.status(403).json({ error: "Seed IDs only available when PAYAZA_MODE=mock" });
    return;
  }
  res.status(200).json(SEED_IDS);
});
