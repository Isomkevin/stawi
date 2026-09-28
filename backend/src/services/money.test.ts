import { describe, it, expect } from "vitest";
import { splitByShares, toKesCents, feeCents } from "./money";

describe("splitByShares", () => {
  it("sums exactly to the net amount", () => {
    const lines = splitByShares(1_000_001, [
      { account_id: "a", share: 33.33 }, { account_id: "b", share: 33.33 }, { account_id: "c", share: 33.34 },
    ]);
    expect(lines.reduce((s, l) => s + l.net_kes_cents, 0)).toBe(1_000_001);
  });
  it("rejects shares not summing to 100", () => {
    expect(() => splitByShares(100, [{ account_id: "a", share: 60 }, { account_id: "b", share: 30 }])).toThrow();
  });
  it("converts and fees in integer cents", () => {
    const gross = toKesCents(12400, 129);
    expect(gross).toBe(159_960_000);
    expect(feeCents(gross, 0.008)).toBe(1_279_680);
  });
});
