import { hashPin, verifyAccountPin, verifyPin } from "../src/services/pin";
import { Account } from "../src/types";

describe("PIN Service", () => {
  it("hashes and verifies PIN correctly", async () => {
    const hash = await hashPin("1234");
    expect(await verifyPin("1234", hash)).toBe(true);
    expect(await verifyPin("0000", hash)).toBe(false);
  });

  describe("verifyAccountPin", () => {
    let testAccount: Account;

    beforeEach(async () => {
      const pin_hash = await hashPin("1234");
      testAccount = {
        id: "acc_test",
        full_name: "Test User",
        phone_number: "+254700000000",
        id_number: "ID123",
        payout_destinations: [],
        coop_id: null,
        channel_capability: "webapp+ussd",
        balance_kes_cents: 10000,
        incoming_kes_cents: 0,
        pin_hash,
        pin_failed_attempts: 0,
        pin_locked_until: null,
      };
    });

    it("accepts correct PIN and resets failed attempts", async () => {
      testAccount.pin_failed_attempts = 2;
      const res = await verifyAccountPin(testAccount, "1234");
      expect(res.valid).toBe(true);
      expect(testAccount.pin_failed_attempts).toBe(0);
      expect(testAccount.pin_locked_until).toBeNull();
    });

    it("rejects wrong PIN and decrements remaining attempts", async () => {
      const res = await verifyAccountPin(testAccount, "9999");
      expect(res.valid).toBe(false);
      expect(res.error).toBe("wrong");
      expect(res.attemptsLeft).toBe(4);
      expect(testAccount.pin_failed_attempts).toBe(1);
    });

    it("locks account after 5 failed attempts for 15 minutes", async () => {
      for (let i = 0; i < 4; i++) {
        await verifyAccountPin(testAccount, "9999");
      }
      expect(testAccount.pin_failed_attempts).toBe(4);

      // 5th attempt triggers lockout
      const res5 = await verifyAccountPin(testAccount, "9999");
      expect(res5.valid).toBe(false);
      expect(res5.error).toBe("locked");
      expect(res5.lockedUntil).toBeDefined();
      expect(testAccount.pin_locked_until).toBeDefined();

      // Subsequent attempt even with correct PIN is blocked while locked
      const resLocked = await verifyAccountPin(testAccount, "1234");
      expect(resLocked.valid).toBe(false);
      expect(resLocked.error).toBe("locked");
    });
  });
});
