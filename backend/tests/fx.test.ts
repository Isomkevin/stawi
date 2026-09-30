import request from "supertest";
import { createApp } from "../src/app";
import { fxQuote, refreshFx, resetFxCache, type FxFetcher } from "../src/services/fx";
import { PAY_CURRENCIES, checkoutAmount } from "../src/services/money";
import { pipeline } from "../src/services/pipeline";

const KES_PER_USD = 129.54;
const EUR_PER_USD = 0.8795;

function feed(body: unknown, ok = true): FxFetcher {
  return async () => ({
    ok,
    status: ok ? 200 : 502,
    json: async () => body,
  });
}

const liveRows = [
  { date: "2026-09-29", base: "USD", quote: "KES", rate: KES_PER_USD },
  { date: "2026-09-30", base: "USD", quote: "EUR", rate: EUR_PER_USD },
];

describe("Frankfurter FX cache", () => {
  const app = createApp();

  beforeEach(() => {
    resetFxCache();
    delete process.env.FX_FEED;
  });

  afterAll(() => {
    resetFxCache();
    delete process.env.FX_FEED;
  });

  it("turns USD quotes into KES per unit and leaves an omitted currency on the illustrative table", async () => {
    await refreshFx(feed(liveRows));

    expect(pipeline.getFxRate("USD")).toBeCloseTo(KES_PER_USD);
    expect(pipeline.getFxRate("EUR")).toBeCloseTo(KES_PER_USD / EUR_PER_USD);
    expect(pipeline.getFxRate("KES")).toBe(1);
    expect(pipeline.getFxRate("NGN")).toBe(0.083);
    expect(checkoutAmount(1000, "USD", "EUR")).toBe(879.5);
    expect(checkoutAmount(1000, "USD", "KES")).toBe(129540);

    const quote = fxQuote();
    expect(quote.source).toBe("frankfurter");
    expect(quote.as_of).toBe("2026-09-30");
    expect(quote.rates.NGN).toBe(0.083);
  });

  it("keeps the last good cache when a later fetch throws", async () => {
    await refreshFx(feed(liveRows));
    await refreshFx(async () => {
      throw new Error("network down");
    });

    expect(pipeline.getFxRate("USD")).toBeCloseTo(KES_PER_USD);
    expect(pipeline.getFxRate("EUR")).toBeCloseTo(KES_PER_USD / EUR_PER_USD);
  });

  it("uses the illustrative table when the first fetch fails", async () => {
    await refreshFx(async () => {
      throw new Error("network down");
    });

    expect(pipeline.getFxRate("USD")).toBe(129);
    expect(pipeline.getFxRate("EUR")).toBe(142);
    expect(pipeline.getFxRate("GBP")).toBe(168);
    expect(pipeline.getFxRate("KES")).toBe(1);
    expect(fxQuote().source).toBe("fallback");
  });

  it("GET /fx returns every pay currency from the illustrative table when the cache is empty", async () => {
    const res = await request(app).get("/fx");
    expect(res.status).toBe(200);
    expect(res.body.source).toBe("fallback");
    expect(res.body.as_of).toBeNull();
    expect(Object.keys(res.body.rates).sort()).toEqual([...PAY_CURRENCIES].sort());
    expect(res.body.rates.USD).toBe(129);
    expect(res.body.rates.EUR).toBe(142);
    expect(res.body.rates.GBP).toBe(168);
    expect(res.body.rates.KES).toBe(1);
  });

  it("stays on the illustrative table when FX_FEED=off", async () => {
    await refreshFx(feed(liveRows));
    process.env.FX_FEED = "off";

    expect(pipeline.getFxRate("USD")).toBe(129);
    expect(pipeline.getFxRate("EUR")).toBe(142);
    expect(fxQuote().source).toBe("fallback");
    expect(fxQuote().as_of).toBeNull();
  });
});
