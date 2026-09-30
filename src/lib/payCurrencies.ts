/**
 * Same allowlist and illustrative KES rates as backend/src/services/money.ts.
 * Payaza publishes no FX endpoint. Keep the two tables identical.
 */
export const PAY_CURRENCIES = [
  "USD",
  "EUR",
  "GBP",
  "NGN",
  "GHS",
  "KES",
  "UGX",
  "TZS",
  "ZAR",
  "XOF",
  "ZMW",
  "LRD",
  "CDF",
  "XAF",
] as const;

export type PayCurrency = (typeof PAY_CURRENCIES)[number];

const WHOLE_UNIT = new Set(["KES", "UGX", "TZS", "XOF", "XAF", "CDF", "LRD"]);

const KES_PER_UNIT: Record<string, number> = {
  USD: 129,
  EUR: 142,
  GBP: 168,
  KES: 1,
  NGN: 0.083,
  GHS: 8.3,
  UGX: 0.035,
  TZS: 0.049,
  ZAR: 7.2,
  XOF: 0.215,
  XAF: 0.215,
  ZMW: 4.8,
  LRD: 0.68,
  CDF: 0.045,
};

export function isPayCurrency(code: string): code is PayCurrency {
  return (PAY_CURRENCIES as readonly string[]).includes(code.toUpperCase());
}

export function defaultPayCurrency(invoiceCurrency: string): PayCurrency {
  const code = invoiceCurrency.toUpperCase();
  return isPayCurrency(code) ? code : "USD";
}

export function kesPerUnit(currency: string, rates?: Record<string, number>): number {
  const code = currency.toUpperCase();
  const quoted = rates?.[code];
  if (quoted != null && Number.isFinite(quoted) && quoted > 0) return quoted;
  return KES_PER_UNIT[code] ?? 129;
}

export function checkoutAmount(
  invoiceAmount: number,
  fromCurrency: string,
  toCurrency: string,
  rates?: Record<string, number>,
): number {
  const to = toCurrency.toUpperCase();
  const raw = (invoiceAmount * kesPerUnit(fromCurrency, rates)) / kesPerUnit(to, rates);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (WHOLE_UNIT.has(to)) return Math.round(raw);
  return Math.round(raw * 100) / 100;
}

export function formatPayAmount(amount: number, currency: string): string {
  const whole = WHOLE_UNIT.has(currency.toUpperCase());
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString("en-US", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 })}`;
  }
}

export function formatKesRate(currency: string, rates?: Record<string, number>): string {
  const rate = kesPerUnit(currency, rates);
  const text = rate >= 1 ? rate.toFixed(2) : rate.toFixed(4).replace(/0+$/, "");
  return `1 ${currency.toUpperCase()} = KES ${text}`;
}
