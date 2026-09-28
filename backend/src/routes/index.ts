import { Router } from "express";
import { z } from "zod";
import { config } from "../config.js";
import { db, uid, now } from "../store.js";
import { createCheckoutSession, verifyWebhook } from "../services/payaza.js";
import { onPaymentConfirmed, approveSplit, previewSplit, withdraw } from "../services/pipeline.js";
import { verifyPin, hashPin } from "../services/pin.js";
import { splitByShares } from "../services/money.js";

export const api = Router();
// async wrapper so BOTH sync throws and rejected promises become clean JSON errors (no stack traces leaked)
const wrap = (fn: any) => async (req: any, res: any) => {
  try { await fn(req, res); }
  catch (e: any) { if (!res.headersSent) res.status(e?.message === "not found" ? 404 : 400).json({ error: e?.issues ? "invalid request" : e.message }); }
};

// TODO(auth): replace with OTP sessions. Dev-only: caller identity via x-account-id header.

// ---- Accounts ----
api.post("/accounts", wrap(async (req: any, res: any) => {
  const b = z.object({ full_name: z.string(), phone_number: z.string(), id_number: z.string(), pin: z.string().regex(/^\d{4}$/),
    destination: z.object({ type: z.enum(["mpesa", "bank"]), details: z.string(), account_name: z.string() }), ussd: z.boolean().default(false), coop_id: z.string().nullable().default(null) }).parse(req.body);
  const id = uid("acc");
  db.accounts.set(id, { id, full_name: b.full_name, phone_number: b.phone_number, id_number: b.id_number,
    payout_destinations: [{ id: uid("dst"), ...b.destination, is_verified: false /* TODO: Payaza name enquiry */ }],
    coop_id: b.coop_id, channel_capability: b.ussd ? "webapp+ussd" : "webapp", pin_hash: hashPin(b.pin),
    pin_failed_attempts: 0, pin_locked_until: null, balance_kes_cents: 0, incoming_kes_cents: 0 });
  res.status(201).json(strip(db.accounts.get(id)!));
}));
api.get("/accounts/:id", wrap((req: any, res: any) => res.json(strip(need(db.accounts.get(req.params.id))))));
api.get("/accounts/:id/balance", wrap((req: any, res: any) => { const a = need(db.accounts.get(req.params.id)); res.json({ balance_kes_cents: a.balance_kes_cents, incoming_kes_cents: a.incoming_kes_cents }); }));
api.get("/accounts/:id/transactions", wrap((req: any, res: any) => {
  const limit = Number(req.query.limit ?? 50);
  res.json(db.payouts.filter((p) => p.account_id === req.params.id).slice(-limit).reverse());
}));
api.post("/accounts/:id/withdraw", wrap(async (req: any, res: any) => {
  const b = z.object({ destination_id: z.string(), amount_kes_cents: z.number().int().positive(), pin: z.string(), idempotency_key: z.string() }).parse(req.body);
  const a = need(db.accounts.get(req.params.id));
  const r = verifyPin(a, b.pin);
  if (!r.ok) return res.status(403).json({ error: r.reason, attemptsLeft: (r as any).attemptsLeft });
  res.json(await withdraw(a.id, b.destination_id, b.amount_kes_cents, b.idempotency_key));
}));

// ---- Co-ops ----
api.post("/coops", wrap((req: any, res: any) => { const b = z.object({ name: z.string(), treasurer_account_id: z.string() }).parse(req.body); const id = uid("coop"); db.coops.set(id, { id, ...b }); res.status(201).json(db.coops.get(id)); }));
api.post("/coops/:id/members", wrap((req: any, res: any) => { const b = z.object({ account_id: z.string(), contribution_share: z.number().positive().max(100), kilos: z.number().optional() }).parse(req.body); db.members.push({ coop_id: req.params.id, ...b }); res.status(201).json(b); }));
api.get("/coops/:id/members", wrap((req: any, res: any) => res.json(db.members.filter((m) => m.coop_id === req.params.id).map((m) => ({ ...m, full_name: db.accounts.get(m.account_id)?.full_name })))));
api.get("/coops/:id/metrics", wrap((req: any, res: any) => {
  const inv = [...db.invoices.values()].filter((i) => i.coop_id === req.params.id);
  const done = inv.filter((i) => i.status === "completed");
  res.json({ invoices: inv.length, total_collected_kes_cents: sum(done.map((i) => (i.kes_total_cents ?? 0) + (i.fee_kes_cents ?? 0))),
    fee_taken_kes_cents: sum(done.map((i) => i.fee_kes_cents ?? 0)), total_split_kes_cents: sum(done.map((i) => i.kes_total_cents ?? 0)) });
}));

// ---- Invoices ----
api.get("/invoices", wrap((req: any, res: any) => res.json([...db.invoices.values()].filter((i) => (!req.query.coop_id || i.coop_id === req.query.coop_id) && (!req.query.account_id || i.account_id === req.query.account_id)))));
api.post("/invoices", wrap((req: any, res: any) => {
  const b = z.object({ type: z.enum(["direct", "coop"]), account_id: z.string().nullable().default(null), coop_id: z.string().nullable().default(null),
    buyer_name: z.string(), buyer_email: z.string().email(), amount: z.number().positive(), currency: z.string().length(3), description: z.string(), reference: z.string().default("") }).parse(req.body);
  const id = uid("inv");
  db.invoices.set(id, { id, ...b, status: "pending", split_approved: false, fx_rate: null, fee_kes_cents: null, kes_total_cents: null, payaza_checkout_reference: null, created_at: now(), due_at: null });
  res.status(201).json(db.invoices.get(id));
}));
api.get("/invoices/:id", wrap((req: any, res: any) => { const inv = need(db.invoices.get(req.params.id)); res.json({ invoice: inv, transactions: db.transactions.filter((t) => t.invoice_id === inv.id), split_preview: inv.type === "coop" && inv.fx_rate ? previewSplit(inv) : null }); }));
api.post("/invoices/:id/checkout-session", wrap(async (req: any, res: any) => { const inv = need(db.invoices.get(req.params.id)); const s = await createCheckoutSession(inv.id, inv.amount, inv.currency); inv.payaza_checkout_reference = s.reference; res.json({ ...s, public_key: config.payaza.publicKey, transaction_reference: inv.id }); }));
api.post("/invoices/:id/approve-split", wrap((req: any, res: any) => {
  const b = z.object({ treasurer_id: z.string(), pin: z.string() }).parse(req.body);
  const t = need(db.accounts.get(b.treasurer_id)); const r = verifyPin(t, b.pin);
  if (!r.ok) return res.status(403).json({ error: r.reason });
  res.json(approveSplit(req.params.id));
}));

// ---- Payaza webhook (mock mode accepts { invoice_id, reference }) ----
api.post("/webhooks/payaza", wrap(async (req: any, res: any) => {
  if (!verifyWebhook(req.headers, JSON.stringify(req.body))) return res.status(401).end();
  res.status(200).json({ received: true });            // ack fast
  const { invoice_id, reference } = req.body;          // TODO(payaza): map the real webhook payload
  void onPaymentConfirmed(invoice_id, reference).catch((e) => console.error("[webhook]", e));
}));

// ---- Dev helper: simulate the buyer paying (mock mode only) ----
if (config.payaza.mode === "mock") {
  api.post("/dev/simulate-payment/:invoiceId", wrap(async (req: any, res: any) => res.json(await onPaymentConfirmed(req.params.invoiceId, `mock_pay_${Date.now()}`))));
}

const need = <T>(v: T | undefined): T => { if (!v) throw new Error("not found"); return v; };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const strip = (a: any) => { const { pin_hash, ...rest } = a; return rest; };
void splitByShares;
