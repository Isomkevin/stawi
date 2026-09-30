import { PAY_CURRENCIES, kesPerUnit, setKesRateSource } from "./money";

/**
 * Daily mid rates from Frankfurter v2. No API key.
 * Quotes are units of each currency per 1 USD. Stawi stores KES per 1 unit.
 * v1 is the ECB list and does not include KES, so this client calls v2.
 */
const DEFAULT_FEED_URL =
  "https://api.frankfurter.dev/v2/rates?base=USD&quotes=KES,EUR,GBP,NGN,GHS,UGX,TZS,ZAR,XOF,ZMW,LRD,CDF,XAF";

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

export type FxSource = "frankfurter" | "fallback";

export type FxQuote = {
  source: FxSource;
  as_of: string | null;
  rates: Record<string, number>;
};

type Cache = {
  as_of: string | null;
  rates: Record<string, number>;
};

type FxResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
};

export type FxFetcher = (url: string, init?: { signal?: AbortSignal }) => Promise<FxResponse>;

let cache: Cache | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

export function fxFeedEnabled(): boolean {
  return (process.env.FX_FEED || "frankfurter").trim().toLowerCase() !== "off";
}

function ttlMs(): number {
  const raw = Number(process.env.FX_CACHE_TTL_MS);
  if (Number.isFinite(raw) && raw >= 1000) return raw;
  return DEFAULT_TTL_MS;
}

function feedUrl(): string {
  const configured = process.env.FX_FEED_URL?.trim();
  return configured || DEFAULT_FEED_URL;
}

/** Live KES per 1 unit when the cache has that code. Otherwise the illustrative table. */
export function quotedKesPerUnit(currency: string): number {
  if (!fxFeedEnabled()) return kesPerUnit(currency);
  const live = cache?.rates[currency.toUpperCase()];
  if (live != null && Number.isFinite(live) && live > 0) return live;
  return kesPerUnit(currency);
}

/** Every Payaza checkout currency, filled from the cache or the illustrative table. */
export function fxQuote(): FxQuote {
  const rates: Record<string, number> = {};
  for (const code of PAY_CURRENCIES) {
    rates[code] = quotedKesPerUnit(code);
  }
  return {
    source: fxFeedEnabled() && cache ? "frankfurter" : "fallback",
    as_of: fxFeedEnabled() && cache ? cache.as_of : null,
    rates,
  };
}

type QuoteRow = { date?: unknown; quote?: unknown; rate?: unknown };

function parseFrankfurter(body: unknown): Cache | null {
  if (!Array.isArray(body)) return null;
  const perUsd: Record<string, number> = {};
  let as_of: string | null = null;
  for (const row of body as QuoteRow[]) {
    if (!row || typeof row !== "object") continue;
    const quote = typeof row.quote === "string" ? row.quote.toUpperCase() : "";
    const rate = row.rate;
    if (!quote || typeof rate !== "number" || !Number.isFinite(rate) || rate <= 0) continue;
    perUsd[quote] = rate;
    if (typeof row.date === "string" && (!as_of || row.date > as_of)) as_of = row.date;
  }
  const kes = perUsd.KES;
  if (kes == null) return null;
  const rates: Record<string, number> = { USD: kes, KES: 1 };
  for (const code of PAY_CURRENCIES) {
    if (code === "USD" || code === "KES") continue;
    const unitsPerUsd = perUsd[code];
    if (unitsPerUsd == null) continue;
    const kesPer = kes / unitsPerUsd;
    if (Number.isFinite(kesPer) && kesPer > 0) rates[code] = kesPer;
  }
  return { as_of, rates };
}

/**
 * Fetches Frankfurter and replaces the cache.
 * A failed response keeps the previous cache. With no cache, callers use the illustrative table.
 * Does not run on the checkout path.
 */
export async function refreshFx(fetcher: FxFetcher = fetch): Promise<void> {
  if (!fxFeedEnabled()) return;
  try {
    const response = await fetcher(feedUrl(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`FX feed HTTP ${response.status ?? "error"}`);
    const next = parseFrankfurter(await response.json());
    if (!next) throw new Error("FX feed did not include a KES quote");
    cache = next;
    console.log(`[FX] Frankfurter rates as of ${next.as_of ?? "unknown"}`);
  } catch (err) {
    const reason = err instanceof Error ? err.message : "request failed";
    console.warn(`[FX] Frankfurter refresh failed (${reason}); using ${cache ? "cached" : "illustrative"} rates`);
  }
}

/** Starts a refresh now and again each TTL. Does not block process startup. */
export function startFxRefresh(): void {
  void refreshFx();
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    void refreshFx();
  }, ttlMs());
  timer.unref?.();
}

export function resetFxCache(): void {
  cache = null;
}

setKesRateSource(quotedKesPerUnit);
