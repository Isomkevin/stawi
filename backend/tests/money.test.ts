import { allocate, feeCents, percentsOfQuantity, splitByKilos, splitByShares, toKesCents } from "../src/services/money";

describe("Money Service", () => {
  describe("toKesCents", () => {
    it("converts KES directly to cents", () => {
      expect(toKesCents(100, "KES", 1.0)).toBe(10000);
      expect(toKesCents(12.5, "KES", 1.0)).toBe(1250);
    });

    it("converts USD to integer KES cents using FX rate", () => {
      // 100 USD * 129.0 = 12,900 KES = 1,290,000 cents
      expect(toKesCents(100, "USD", 129.0)).toBe(1290000);
      expect(toKesCents(12400, "USD", 129.0)).toBe(159960000);
    });

    it("never returns floating point cents", () => {
      const cents = toKesCents(33.333, "USD", 129.456);
      expect(Number.isInteger(cents)).toBe(true);
    });
  });

  describe("feeCents", () => {
    it("calculates 0.8% fee by default in integer cents", () => {
      // 1,000,000 cents * 0.8% = 8,000 cents
      expect(feeCents(1000000)).toBe(8000);
      expect(feeCents(159960000, 0.8)).toBe(1279680);
    });
  });

  describe("allocate (Largest-Remainder Method)", () => {
    it("distributes remainder so sum is EXACTLY equal to totalMinor", () => {
      const totalCents = 10000; // 100.00 KES
      const items = [
        { id: "A", share: 33.33 },
        { id: "B", share: 33.33 },
        { id: "C", share: 33.34 },
      ];

      const allocated = allocate(totalCents, items);
      const sum = allocated.reduce((acc, curr) => acc + curr.amt, 0);

      expect(sum).toBe(totalCents);
      expect(allocated.every((a) => Number.isInteger(a.amt))).toBe(true);
    });

    it("handles 10-farmer distribution with exact sum", () => {
      const totalCents = 158680320; // KES 1,586,803.20
      const shares = [
        { id: "1", share: 15 },
        { id: "2", share: 12 },
        { id: "3", share: 10 },
        { id: "4", share: 10 },
        { id: "5", share: 10 },
        { id: "6", share: 9 },
        { id: "7", share: 9 },
        { id: "8", share: 9 },
        { id: "9", share: 8 },
        { id: "10", share: 8 },
      ];

      const allocated = allocate(totalCents, shares);
      const sum = allocated.reduce((acc, curr) => acc + curr.amt, 0);

      expect(sum).toBe(totalCents);
    });
  });

  describe("splitByShares", () => {
    it("guarantees gross, net, and fee all sum exactly to totals", () => {
      const gross = 159960000;
      const fee = 1279680;
      const net = gross - fee;

      const members = [
        { account_id: "m1", contribution_share: 15 },
        { account_id: "m2", contribution_share: 12 },
        { account_id: "m3", contribution_share: 10 },
        { account_id: "m4", contribution_share: 10 },
        { account_id: "m5", contribution_share: 10 },
        { account_id: "m6", contribution_share: 9 },
        { account_id: "m7", contribution_share: 9 },
        { account_id: "m8", contribution_share: 9 },
        { account_id: "m9", contribution_share: 8 },
        { account_id: "m10", contribution_share: 8 },
      ];

      const lines = splitByShares(gross, fee, members);

      const sumGross = lines.reduce((acc, l) => acc + l.gross_kes_cents, 0);
      const sumFee = lines.reduce((acc, l) => acc + l.fee_kes_cents, 0);
      const sumNet = lines.reduce((acc, l) => acc + l.net_kes_cents, 0);

      expect(sumGross).toBe(gross);
      expect(sumNet).toBe(net);
      expect(sumFee).toBe(fee);

      // Line item check: gross === net + fee
      for (const line of lines) {
        expect(line.gross_kes_cents).toBe(line.net_kes_cents + line.fee_kes_cents);
      }
    });
  });

  describe("splitByKilos", () => {
    it("pays in proportion to kilos and reports percents that sum to 100", () => {
      const gross = 1_000_000;
      const fee = 8_000;
      const lines = splitByKilos(gross, fee, [
        { account_id: "a", kilos: 300 },
        { account_id: "b", kilos: 100 },
      ]);
      expect(lines.map((line) => line.share)).toEqual([75, 25]);
      expect(lines.reduce((sum, line) => sum + line.share, 0)).toBe(100);
      expect(lines.reduce((sum, line) => sum + line.net_kes_cents, 0)).toBe(gross - fee);
      expect(lines[0].net_kes_cents).toBeGreaterThan(lines[1].net_kes_cents);
    });
  });

  describe("percentsOfQuantity", () => {
    it("keeps a half-filled lot under 100 and a full lot at 100", () => {
      const half = percentsOfQuantity([40, 10], 100);
      expect(half).toEqual([40, 10]);
      expect(half.reduce((sum, n) => sum + n, 0)).toBe(50);
      const full = percentsOfQuantity([100, 100, 100], 300);
      expect(full.reduce((sum, n) => sum + n, 0)).toBe(100);
      expect(full.every((n) => Number.isInteger(n))).toBe(true);
    });
  });
});
