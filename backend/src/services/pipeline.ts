/**
 * The money pipeline. Direct and Co-op share every step except the split:
 *   collection -> conversion -> (Direct: credit exporter | Co-op: await treasurer approval -> credit each farmer)
 * Credits land in the account's Stawi balance; the user withdraws to an approved destination (see withdraw()).
 */
import type { Invoice, Payout, SplitLine } from "../types.js";
import { config } from "../config.js";
import { db, uid, now } from "../store.js";
import { convertToKes, disburse } from "./payaza.js";
import { feeCents, splitByShares, toKesCents } from "./money.js";
import { sendSms } from "./notify.js";

const fmt = (cents: number) => `KES ${(cents / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

export async function onPaymentConfirmed(invoiceId: string, payazaRef: string) {
  const inv = db.invoices.get(invoiceId);
  if (!inv) throw new Error("invoice not found");
  // Idempotent: a paid invoice is never processed twice, whatever reference a retry carries
  if (inv.status !== "pending") return inv;
  if (db.transactions.some((t) => t.type === "collection" && t.payaza_reference === payazaRef)) return inv;

  db.transactions.push({ id: uid("tx"), invoice_id: inv.id, type: "collection", status: "completed",
    amount: inv.amount, currency: inv.currency, payaza_reference: payazaRef, fx_rate: null, fee_kes_cents: null, created_at: now() });
  inv.status = "converting";

  const conv = await convertToKes(inv.amount, inv.currency);
  const gross = toKesCents(inv.amount, conv.fxRate);
  const fee = feeCents(gross, config.feeRate);
  inv.fx_rate = conv.fxRate; inv.fee_kes_cents = fee; inv.kes_total_cents = gross - fee;
  db.transactions.push({ id: uid("tx"), invoice_id: inv.id, type: "conversion", status: "completed",
    amount: inv.amount, currency: inv.currency, payaza_reference: conv.reference, fx_rate: conv.fxRate, fee_kes_cents: fee, created_at: now() });

  if (inv.type === "direct") { await creditDirect(inv); }
  else { inv.status = "settling"; /* waits for treasurer approve-split */ notifyIncoming(inv); }
  return inv;
}

async function creditDirect(inv: Invoice) {
  const acc = db.accounts.get(inv.account_id!)!;
  credit(inv, acc.id, inv.kes_total_cents!);
  inv.status = "completed";
}

export function previewSplit(inv: Invoice): SplitLine[] {
  const members = db.members.filter((m) => m.coop_id === inv.coop_id).map((m) => ({ account_id: m.account_id, share: m.contribution_share }));
  const gross = inv.fx_rate ? toKesCents(inv.amount, inv.fx_rate) : 0;
  return splitByShares(inv.kes_total_cents ?? 0, members, gross, inv.fee_kes_cents ?? 0);
}

export function approveSplit(invoiceId: string) {
  const inv = db.invoices.get(invoiceId);
  if (!inv || inv.type !== "coop") throw new Error("not a co-op invoice");
  if (inv.status !== "settling" || inv.split_approved) throw new Error("invoice not awaiting split approval");
  for (const line of previewSplit(inv)) credit(inv, line.account_id, line.net_kes_cents);
  inv.split_approved = true; inv.status = "completed";
  return inv;
}

function credit(inv: Invoice, accountId: string, cents: number) {
  const acc = db.accounts.get(accountId)!;
  acc.balance_kes_cents += cents;
  const tx = { id: uid("tx"), invoice_id: inv.id, type: "payout" as const, status: "completed" as const,
    amount: cents / 100, currency: "KES", payaza_reference: null, fx_rate: inv.fx_rate, fee_kes_cents: null, created_at: now() };
  db.transactions.push(tx);
  db.payouts.push({ id: uid("po"), invoice_id: inv.id, transaction_id: tx.id, account_id: accountId, kind: "credit",
    amount_kes_cents: cents, destination_id: null, status: "confirmed", created_at: now() });
  void sendSms(acc.phone_number, `Stawi: ${fmt(cents)} has landed in your Stawi account. Dial or open the app to withdraw.`);
}

function notifyIncoming(_inv: Invoice) { /* TODO: notify treasurer that a split awaits approval */ }

/** Withdraw from Stawi balance to an approved (verified) destination. Idempotent on idempotencyKey. */
export async function withdraw(accountId: string, destinationId: string, amountCents: number, idempotencyKey: string) {
  const existing = db.payouts.find((p) => p.idempotency_key === idempotencyKey);
  if (existing) return existing;
  const acc = db.accounts.get(accountId);
  if (!acc) throw new Error("account not found");
  const dest = acc.payout_destinations.find((d) => d.id === destinationId && d.is_verified);
  if (!dest) throw new Error("destination not approved");
  if (amountCents <= 0 || amountCents > acc.balance_kes_cents) throw new Error("insufficient balance");

  acc.balance_kes_cents -= amountCents; // reserve first; refund on failure
  const po: Payout = { id: uid("po"), invoice_id: "", transaction_id: "", account_id: accountId, kind: "withdrawal",
    amount_kes_cents: amountCents, destination_id: destinationId, status: "pending", idempotency_key: idempotencyKey, created_at: now() };
  db.payouts.push(po);
  try {
    await disburse({ amountKesCents: amountCents, destinationType: dest.type, destination: dest.details, reference: idempotencyKey });
    po.status = "sent";
    void sendSms(acc.phone_number, `Stawi: ${fmt(amountCents)} sent to your ${dest.type === "mpesa" ? "M-Pesa" : "bank account"}.`);
  } catch (e) {
    acc.balance_kes_cents += amountCents; po.status = "failed"; throw e;
  }
  return po;
}
