import crypto from "crypto";
import { maskPhone } from "../services/phone";
import { store } from "../store";
import { UssdSession } from "../types";
import { ussdScreen, UssdScreen } from "./menu";

const RATE_WINDOW_MS = 5 * 60 * 1000;

/** One dial is handled at a time so a gateway retry cannot start a second withdrawal. */
const sessionTail = new Map<string, Promise<void>>();

function lockSession<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
  const previous = sessionTail.get(sessionId) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  sessionTail.set(sessionId, tail);
  void tail.then(() => {
    if (sessionTail.get(sessionId) === tail) sessionTail.delete(sessionId);
  });
  return run;
}

export type UssdTurn = {
  sessionId: string;
  phone: string;
  serviceCode: string;
  text: string;
};

export function ussdSessionTtlMs(): number {
  const raw = Number(process.env.AT_USSD_SESSION_TTL_MS);
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 180_000;
}

export function ussdRateLimit(): number {
  const raw = Number(process.env.AT_USSD_RATE_LIMIT);
  if (Number.isInteger(raw) && raw > 0) return raw;
  return 30;
}

function expectedServiceCode(): string {
  return (process.env.AT_USSD_SERVICE_CODE || "").trim();
}

function hashStep(serviceCode: string, text: string): string {
  return crypto.createHash("sha256").update(`${serviceCode}\n${text}`).digest("hex");
}

/** Drop the PIN segment before the path is written down. */
function redactText(text: string): string {
  const parts = text.split("*");
  if (parts[0] === "3" && parts.length >= 4) {
    parts[3] = "****";
    return parts.join("*");
  }
  return text;
}

function logUssd(fields: { sessionId?: string; phone?: string; state?: string; action?: string; outcome: string }): void {
  console.log(
    JSON.stringify({
      channel: "ussd",
      at: new Date().toISOString(),
      sessionId: fields.sessionId,
      phone: fields.phone ? maskPhone(fields.phone) : undefined,
      state: fields.state,
      action: fields.action,
      outcome: fields.outcome,
    })
  );
}

async function persist(existing: UssdSession | undefined, turn: UssdTurn, result: UssdScreen): Promise<void> {
  const now = new Date();
  const session: UssdSession = {
    session_id: turn.sessionId,
    phone_number: turn.phone,
    account_id: result.accountId,
    service_code: turn.serviceCode || null,
    last_text: redactText(turn.text),
    text_hash: hashStep(turn.serviceCode, turn.text),
    last_response: result.body,
    state: result.state,
    created_at: existing?.created_at ?? now.toISOString(),
    updated_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ussdSessionTtlMs()).toISOString(),
  };
  await store.saveUssdSession(session);
}

/**
 * Binds the gateway session to one phone, expires it, and replays a duplicate step
 * without calling withdraw again.
 */
export async function dispatchUssd(turn: UssdTurn): Promise<string> {
  const rate = await store.consumeUssdRate(turn.phone, ussdRateLimit(), RATE_WINDOW_MS);
  if (rate.limited) {
    logUssd({ sessionId: turn.sessionId, phone: turn.phone, action: "rate_limit", outcome: "end" });
    return "END Too many requests. Please dial again shortly.";
  }

  return lockSession(turn.sessionId, () => dispatchLocked(turn));
}

async function dispatchLocked(turn: UssdTurn): Promise<string> {
  const existing = await store.getUssdSession(turn.sessionId);
  if (existing && existing.phone_number !== turn.phone) {
    logUssd({ sessionId: turn.sessionId, phone: turn.phone, state: existing.state, action: "phone_mismatch", outcome: "end" });
    return "END This session does not match your number.";
  }
  if (existing && new Date(existing.expires_at).getTime() <= Date.now()) {
    logUssd({ sessionId: turn.sessionId, phone: turn.phone, state: "expired", action: "expired", outcome: "end" });
    return "END Session expired. Please dial again.";
  }

  const requiredCode = expectedServiceCode();
  if (requiredCode && turn.serviceCode !== requiredCode) {
    const rejected = { state: "service_code", body: "END This service is not available.", accountId: existing?.account_id ?? null };
    await persist(existing, turn, rejected);
    logUssd({ sessionId: turn.sessionId, phone: turn.phone, state: "service_code", action: "service_code", outcome: "end" });
    return rejected.body;
  }

  const stepHash = hashStep(turn.serviceCode, turn.text);
  if (existing && existing.text_hash === stepHash && existing.last_response) {
    await persist(existing, turn, {
      state: existing.state,
      body: existing.last_response,
      accountId: existing.account_id,
    });
    logUssd({ sessionId: turn.sessionId, phone: turn.phone, state: existing.state, action: "replay", outcome: "replay" });
    return existing.last_response;
  }

  const result = await ussdScreen({ sessionId: turn.sessionId, phone: turn.phone, text: turn.text });
  await persist(existing, turn, result);
  logUssd({
    sessionId: turn.sessionId,
    phone: turn.phone,
    state: result.state,
    action: result.state,
    outcome: result.body.startsWith("CON") ? "con" : "end",
  });
  return result.body;
}
