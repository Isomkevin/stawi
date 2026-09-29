/**
 * Kenyan numbers are stored and compared as +254 followed by 9 digits.
 * 0758750620, 254758750620, and +254758750620 are the same number.
 */
export function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("0")) {
    return `+254${cleaned.substring(1)}`;
  }
  if (cleaned.startsWith("254")) {
    return `+${cleaned}`;
  }
  if (!cleaned.startsWith("+")) {
    return `+${cleaned}`;
  }
  return cleaned;
}

export function isKenyanPhone(phone: string): boolean {
  return /^\+254\d{9}$/.test(normalizePhone(phone));
}

export class PhoneError extends Error {
  status = 400;
  constructor(message: string) {
    super(message);
    this.name = "PhoneError";
  }
}

export function requireKenyanPhone(phone: string): string {
  const normalized = normalizePhone(phone);
  if (!/^\+254\d{9}$/.test(normalized)) {
    throw new PhoneError("Enter a Kenyan phone number, for example +2547XXXXXXXX");
  }
  return normalized;
}
