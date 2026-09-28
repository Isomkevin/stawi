/**
 * Payaza integration boundary. ONLY this file talks to Payaza.
 * See docs/skills/payaza/SKILL.md. Modes:
 *  - mock:    deterministic fake responses so the whole product runs end to end today
 *  - sandbox: TODO — implement against Payaza's sandbox docs/Postman collection
 *  - live:    same code path as sandbox with live keys
 * DO NOT invent endpoints. Replace each TODO with the real call once confirmed with Payaza engineers.
 */
import { randomUUID } from "node:crypto";
import { config } from "../config.js";

export interface CheckoutSession { reference: string; checkoutUrl: string | null }
export interface Conversion { fxRate: number; reference: string }
export interface Disbursement { reference: string; status: "sent" | "pending" }

const notImplemented = (what: string) =>
  new Error(`[payaza:${config.payaza.mode}] ${what} not implemented — see TODO in services/payaza.ts and docs/skills/payaza/SKILL.md`);

export async function createCheckoutSession(invoiceId: string, _amount: number, _currency: string): Promise<CheckoutSession> {
  if (config.payaza.mode === "mock") return { reference: `mock_chk_${invoiceId}`, checkoutUrl: null }; // widget is opened client-side with the public key
  // TODO(payaza): checkout is client-side via the web SDK using the PUBLIC key + transaction_reference = invoiceId.
  // Server only needs to return the reference/config. Confirm KES/USD currency_code support in sandbox.
  return { reference: invoiceId, checkoutUrl: null };
}

export async function convertToKes(_amount: number, currency: string): Promise<Conversion> {
  if (config.payaza.mode === "mock") {
    const rates: Record<string, number> = { USD: 129, EUR: 140, GBP: 163, KES: 1 };
    return { fxRate: rates[currency] ?? 129, reference: `mock_fx_${randomUUID().slice(0, 8)}` };
  }
  // TODO(payaza): confirm whether conversion is automatic at settlement or an explicit call; log rate applied.
  throw notImplemented("multi-currency conversion");
}

/** Send KES to a payout destination (M-Pesa or bank). Requires secret key + PIN in live/sandbox. */
export async function disburse(_p: { amountKesCents: number; destinationType: "mpesa" | "bank"; destination: string; reference: string }): Promise<Disbursement> {
  if (config.payaza.mode === "mock") return { reference: `mock_pay_${randomUUID().slice(0, 8)}`, status: "sent" };
  // TODO(payaza): implement transfer/payout call. Idempotency: use _p.reference.
  throw notImplemented("disbursement / settlement");
}

/** Optional native split via sub-accounts. If Payaza's split schema is thin, callers fall back to per-farmer disburse(). */
export async function splitSettle(_lines: { subAccountId: string; amountKesCents: number }[]): Promise<Disbursement[]> {
  // TODO(payaza): verify sub-account create + split schema FIRST on Build Day.
  throw notImplemented("sub-account split");
}

/** Verify webhook authenticity. TODO(payaza): confirm signature scheme. */
export function verifyWebhook(_headers: Record<string, unknown>, _rawBody: string): boolean {
  if (config.payaza.mode === "mock") return true;
  // TODO(payaza): implement signature/secret verification before trusting any webhook in sandbox/live.
  return false;
}
