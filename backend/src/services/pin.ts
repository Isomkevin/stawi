import bcrypt from "bcryptjs";
import { Account } from "../types";

const SALT_ROUNDS = 10;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, SALT_ROUNDS);
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pin, hash);
}

export type PinVerificationResult = {
  valid: boolean;
  error?: "wrong" | "locked";
  attemptsLeft?: number;
  lockedUntil?: string;
};

/**
 * Verifies an account PIN with lockout protection:
 * - 5 failed attempts -> 15 min lockout
 * - Resets failed count upon successful authentication
 */
export async function verifyAccountPin(
  account: Account,
  pin: string
): Promise<PinVerificationResult> {
  const now = new Date();

  // Check if currently locked
  if (account.pin_locked_until) {
    const lockedUntilDate = new Date(account.pin_locked_until);
    if (lockedUntilDate > now) {
      return {
        valid: false,
        error: "locked",
        lockedUntil: account.pin_locked_until,
      };
    } else {
      // Lock has expired, reset
      account.pin_locked_until = null;
      account.pin_failed_attempts = 0;
    }
  }

  // If no pin_hash is set (e.g., initial state or demo default), check against default or fail
  if (!account.pin_hash) {
    return {
      valid: false,
      error: "wrong",
      attemptsLeft: MAX_ATTEMPTS - (account.pin_failed_attempts || 0),
    };
  }

  const isMatch = await verifyPin(pin, account.pin_hash);

  if (isMatch) {
    // Reset failed counter
    account.pin_failed_attempts = 0;
    account.pin_locked_until = null;
    return { valid: true };
  }

  // Record failed attempt
  account.pin_failed_attempts = (account.pin_failed_attempts || 0) + 1;

  if (account.pin_failed_attempts >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
    account.pin_locked_until = lockedUntil;
    return {
      valid: false,
      error: "locked",
      lockedUntil,
    };
  }

  return {
    valid: false,
    error: "wrong",
    attemptsLeft: MAX_ATTEMPTS - account.pin_failed_attempts,
  };
}
