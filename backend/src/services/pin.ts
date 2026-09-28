import bcrypt from "bcryptjs";
import type { Account } from "../types.js";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export const hashPin = (pin: string) => bcrypt.hashSync(pin, 10);

export type PinResult = { ok: true } | { ok: false; reason: "no_pin" | "locked" | "wrong"; attemptsLeft?: number };

/** Verifies a PIN, mutating attempt counters on the account. Persist the account after calling. */
export function verifyPin(account: Account, pin: string): PinResult {
  if (!account.pin_hash) return { ok: false, reason: "no_pin" };
  if (account.pin_locked_until && new Date(account.pin_locked_until) > new Date()) return { ok: false, reason: "locked" };
  if (bcrypt.compareSync(pin, account.pin_hash)) {
    account.pin_failed_attempts = 0; account.pin_locked_until = null; return { ok: true };
  }
  account.pin_failed_attempts += 1;
  if (account.pin_failed_attempts >= MAX_ATTEMPTS) {
    account.pin_locked_until = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
    account.pin_failed_attempts = 0;
    return { ok: false, reason: "locked" };
  }
  return { ok: false, reason: "wrong", attemptsLeft: MAX_ATTEMPTS - account.pin_failed_attempts };
}
