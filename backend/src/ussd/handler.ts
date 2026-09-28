/**
 * USSD adapter (Africa's Talking). Thin: identifies the caller by phone, then calls the SAME services the web API uses.
 * Response protocol: "CON ..." keeps the session open, "END ..." closes it. See docs/skills/africas-talking/SKILL.md.
 */
import { Router } from "express";
import { config } from "../config.js";
import { accountByPhone, db } from "../store.js";
import { verifyPin } from "../services/pin.js";
import { withdraw } from "../services/pipeline.js";

export const ussd = Router();
const kes = (c: number) => `KES ${(c / 100).toLocaleString("en-KE", { minimumFractionDigits: 2 })}`;

export function handleUssd(phone: string, text: string, sessionId: string): string {
  const acc = accountByPhone(phone);
  if (!acc) return "END You are not registered on Stawi. Ask your co-op treasurer for an invite.";
  if (acc.channel_capability !== "webapp+ussd") return "END Phone access is off. Turn it on in the Stawi app under Profile.";

  const p = text === "" ? [] : text.split("*");
  if (p.length === 0) return "CON Welcome to Stawi\n1. My balance\n2. Transaction status\n3. Withdraw";

  if (p[0] === "1") return `END Your Stawi balance: ${kes(acc.balance_kes_cents)}\nIncoming: ${kes(acc.incoming_kes_cents)}`;

  if (p[0] === "2") {
    const recent = db.payouts.filter((x) => x.account_id === acc.id).slice(-3).reverse();
    if (!recent.length) return "END No transactions yet.";
    return "END Recent:\n" + recent.map((r) => `${r.kind === "credit" ? "Received" : "Withdrawn"} ${kes(r.amount_kes_cents)} - ${r.status}`).join("\n");
  }

  if (p[0] === "3") {
    const dests = acc.payout_destinations.filter((d) => d.is_verified);
    if (!dests.length) return "END No approved payout account. Add one in the Stawi app.";
    if (p.length === 1) return "CON Withdraw to:\n" + dests.map((d, i) => `${i + 1}. ${d.type === "mpesa" ? "M-Pesa" : "Bank"} ${mask(d.details)}`).join("\n");
    const dest = dests[Number(p[1]) - 1];
    if (!dest) return "END Invalid choice.";
    if (p.length === 2) return `CON Balance ${kes(acc.balance_kes_cents)}\nEnter amount (KES):`;
    const amount = Math.round(Number(p[2]) * 100);
    if (!Number.isFinite(amount) || amount <= 0) return "END Invalid amount.";
    if (p.length === 3) return "CON Enter your Stawi PIN:";
    const r = verifyPin(acc, p[3]);
    if (!r.ok) return r.reason === "locked" ? "END Too many attempts. Try again in 15 minutes." : `END Wrong PIN. ${r.attemptsLeft ?? 0} attempts left.`;
    // Idempotent per session so gateway retries can't double-pay
    void withdraw(acc.id, dest.id, amount, `ussd_${sessionId}`).catch((e) => console.warn("[ussd:withdraw]", e.message));
    return `END Withdrawal of ${kes(amount)} to ${dest.type === "mpesa" ? "M-Pesa" : "bank"} initiated. You will get an SMS.`;
  }
  return "END Invalid choice.";
}

const mask = (s: string) => s.length > 4 ? `***${s.slice(-4)}` : s;

ussd.post("/callback", (req, res) => {
  // Reject anything not from Africa's Talking (shared secret in the registered callback URL; also allowlist AT IPs in production)
  if (config.at.callbackSecret && req.query.s !== config.at.callbackSecret) return res.status(401).end();
  const { sessionId = "", phoneNumber = "", text = "" } = req.body ?? {};
  let out: string;
  try { out = handleUssd(phoneNumber, text, sessionId); }
  catch (e) { console.error("[ussd]", e); out = "END Something went wrong. Please try again."; }
  res.set("Content-Type", "text/plain").status(200).send(out); // always 200
});
