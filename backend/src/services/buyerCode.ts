import { randomBytes } from "crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Eight-character code for `/buyer?code=`. Avoids ambiguous characters. */
export function randomBuyerCode(): string {
  const bytes = randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) code += ALPHABET[bytes[i]! % ALPHABET.length];
  return code;
}

export function normalizeBuyerCode(code: unknown): string {
  if (typeof code !== "string") return "";
  return code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}
