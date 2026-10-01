import request from "supertest";
import { createApp } from "../src/app";
import { pipeline } from "../src/services/pipeline";
import { hashPin } from "../src/services/pin";
import { store } from "../src/store";
import { Account } from "../src/types";

describe("USSD Gateway Adapter", () => {
  const app = createApp();
  const secret = "test-secret";
  process.env.AT_CALLBACK_SECRET = secret;

  beforeEach(async () => {
    delete process.env.AT_USSD_SERVICE_CODE;
    process.env.AT_USSD_SESSION_TTL_MS = "180000";
    process.env.AT_USSD_RATE_LIMIT = "30";
    await store.reset();

    const pinHash = await hashPin("1234");
    const account: Account = {
      id: "acc_ussd_farmer",
      full_name: "Farmer Kip",
      phone_number: "+254700112233",
      id_number: "ID999",
      payout_destinations: [
        {
          id: "dest_mpesa_kip",
          type: "mpesa",
          details: "+254700112233",
          account_name: "Farmer Kip",
          is_verified: true,
        },
      ],
      coop_id: null,
      channel_capability: "webapp+ussd",
      balance_kes_cents: 350000, // KES 3,500.00
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    };
    await store.saveAccount(account);
  });

  it("rejects unauthorized requests without valid secret", async () => {
    const res = await request(app)
      .post("/ussd/callback")
      .send({ sessionId: "S1", phoneNumber: "+254700112233", text: "" });

    expect(res.status).toBe(401);
  });

  it("returns root menu with secret provided", async () => {
    const res = await request(app)
      .post(`/ussd/callback?s=${secret}`)
      .send({ sessionId: "S1", phoneNumber: "+254700112233", text: "" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("CON Welcome to Stawi");
    expect(res.text).toContain("1. My balance");
    expect(res.text).toContain("2. Transaction status");
    expect(res.text).toContain("3. Withdraw");
  });

  it("handles Option 1 (balance lookup) matching webapp account balance", async () => {
    const res = await request(app)
      .post(`/ussd/callback?s=${secret}`)
      .send({ sessionId: "S1", phoneNumber: "+254700112233", text: "1" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("END Your Stawi balance: KES 3,500.00");
  });

  it("handles Option 3 withdrawal menu flow with PIN verification", async () => {
    // Step 1: text="3" -> show destination choices
    const res1 = await request(app)
      .post(`/ussd/callback?s=${secret}`)
      .send({ sessionId: "S2", phoneNumber: "+254700112233", text: "3" });
    expect(res1.text).toContain("CON Withdraw to:");
    expect(res1.text).toContain("1. M-Pesa");

    // Step 2: text="3*1" -> enter amount
    const res2 = await request(app)
      .post(`/ussd/callback?s=${secret}`)
      .send({ sessionId: "S2", phoneNumber: "+254700112233", text: "3*1" });
    expect(res2.text).toContain("CON Enter amount (KES):");

    // Step 3: text="3*1*1000" -> enter PIN
    const res3 = await request(app)
      .post(`/ussd/callback?s=${secret}`)
      .send({ sessionId: "S2", phoneNumber: "+254700112233", text: "3*1*1000" });
    expect(res3.text).toContain("CON Enter your Stawi PIN:");

    // Step 4: text="3*1*1000*1234" -> execute withdrawal
    const res4 = await request(app)
      .post(`/ussd/callback?s=${secret}`)
      .send({ sessionId: "S2", phoneNumber: "+254700112233", text: "3*1*1000*1234" });
    expect(res4.text).toContain("END Withdrawal of KES 1,000.00 to +254700112233 initiated.");

    const updated = await store.getAccountByPhone("+254700112233");
    expect(updated?.balance_kes_cents).toBe(250000);
    const web = await request(app).get("/accounts/acc_ussd_farmer");
    expect(web.status).toBe(200);
    expect(web.body.balance_kes_cents).toBe(250000);

    const saved = await store.getUssdSession("S2");
    expect(saved?.last_text).toBe("3*1*1000*****");
    expect(saved?.last_text).not.toContain("1234");
  });

  it("sends the USSD withdrawal through Payaza and leaves it sent", async () => {
    const previous = {
      mode: process.env.PAYAZA_MODE,
      pin: process.env.PAYAZA_PIN,
      kes: process.env.PAYAZA_KES_ACCOUNT_REF,
    };
    process.env.PAYAZA_MODE = "sandbox";
    process.env.PAYAZA_PIN = "135790";
    process.env.PAYAZA_KES_ACCOUNT_REF = "KES-TEST-REF";

    const calls: { url: string; body: { transaction_type?: string; service_payload?: { payout_beneficiaries?: unknown[] } } }[] = [];
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async (url: unknown, init?: { body?: string }) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : {} });
      return {
        ok: true,
        json: async () => ({ response_content: { response_status: "TRANSACTION_INITIATED" } }),
      } as Response;
    }) as typeof fetch;

    try {
      const res = await request(app)
        .post(`/ussd/callback?s=${secret}`)
        .send({ sessionId: "S-ussd-pay", phoneNumber: "+254700112233", text: "3*1*1000*1234" });

      expect(res.status).toBe(200);
      expect(res.text).toContain("END Withdrawal of KES 1,000.00 to +254700112233 initiated.");

      const payoutCalls = calls.filter((call) => call.url.includes("/payout-receptor/payout"));
      expect(payoutCalls).toHaveLength(1);
      expect(payoutCalls[0].body.transaction_type).toBe("mobile_money");
      expect(payoutCalls[0].body.service_payload?.payout_beneficiaries).toHaveLength(1);

      const account = await store.getAccountByPhone("+254700112233");
      expect(account?.balance_kes_cents).toBe(250000);
      const payouts = await store.getPayoutsByAccount(account!.id);
      expect(payouts[0].status).toBe("sent");
      expect(payouts[0].kind).toBe("withdrawal");

      const replay = await request(app)
        .post(`/ussd/callback?s=${secret}`)
        .send({ sessionId: "S-ussd-pay", phoneNumber: "+254700112233", text: "3*1*1000*1234" });
      expect(replay.text).toContain("initiated.");
      expect(calls.filter((call) => call.url.includes("/payout-receptor/payout"))).toHaveLength(1);
      expect((await store.getAccountByPhone("+254700112233"))?.balance_kes_cents).toBe(250000);
    } finally {
      global.fetch = originalFetch;
      if (previous.mode === undefined) delete process.env.PAYAZA_MODE;
      else process.env.PAYAZA_MODE = previous.mode;
      if (previous.pin === undefined) delete process.env.PAYAZA_PIN;
      else process.env.PAYAZA_PIN = previous.pin;
      if (previous.kes === undefined) delete process.env.PAYAZA_KES_ACCOUNT_REF;
      else process.env.PAYAZA_KES_ACCOUNT_REF = previous.kes;
    }
  });

  function dial(sessionId: string, text: string, phone = "+254700112233", serviceCode?: string) {
    return request(app)
      .post(`/ussd/callback?s=${secret}`)
      .send({ sessionId, phoneNumber: phone, text, ...(serviceCode ? { serviceCode } : {}) });
  }

  it("accepts the callback secret header", async () => {
    const res = await request(app)
      .post("/ussd/callback")
      .set("x-ussd-secret", secret)
      .send({ sessionId: "S-header", phoneNumber: "+254700112233", text: "" });
    expect(res.status).toBe(200);
    expect(res.text).toContain("CON Welcome to Stawi");
    expect(res.text).toContain("0. Exit");
  });

  it("ends cleanly on a malformed request", async () => {
    const res = await request(app)
      .post(`/ussd/callback?s=${secret}`)
      .send({ phoneNumber: "+254700112233", text: { nested: true } });
    expect(res.status).toBe(200);
    expect(res.text).toBe("END Invalid request. Please dial again.");
  });

  it("rejects an unknown number and a number with USSD turned off", async () => {
    const unknown = await dial("S-unknown", "", "+254700000099");
    expect(unknown.text).toBe("END No Stawi account for this number. Register on the Stawi app.");

    const account = await store.getAccount("acc_ussd_farmer");
    account!.channel_capability = "webapp";
    await store.saveAccount(account!);
    const off = await dial("S-off", "1");
    expect(off.text).toBe("END USSD is off for this account. Turn it on in the Stawi app.");
    expect(off.text).not.toContain("3,500.00");
  });

  it("shows transaction status from the same payout list as the web app", async () => {
    const empty = await dial("S-status-empty", "2");
    expect(empty.text).toBe("END No recent transactions found.");

    await dial("S-status-pay", "3*1*500*1234");
    const status = await dial("S-status", "2");
    expect(status.text).toContain("END Transaction done:");
    expect(status.text).toContain("Withdrawal - done - KES 500.00");
    const web = await request(app).get("/accounts/acc_ussd_farmer/transactions");
    expect(web.body[0].amount_kes_cents).toBe(50000);
    expect(web.body[0].kind).toBe("withdrawal");
  });

  it("rejects a bad menu choice, a bad amount, a short PIN, and a missing bank", async () => {
    expect((await dial("S-bad-menu", "9")).text).toBe("END Invalid selection. Please dial again.");
    expect((await dial("S-bad-amount", "3*1*12.5")).text).toBe("END Invalid amount entered.");
    expect((await dial("S-bad-pin", "3*1*100*12")).text).toBe("END Enter a 4-digit PIN.");
    expect((await dial("S-bad-bank", "3*2*100*1234")).text).toBe(
      "END No verified bank destination linked to your account."
    );
    expect((await store.getAccountByPhone("+254700112233"))?.balance_kes_cents).toBe(350000);
  });

  it("says goodbye on exit", async () => {
    expect((await dial("S-exit", "0")).text).toBe("END Goodbye.");
  });

  it("reports a wrong PIN, then locks the account without moving money", async () => {
    const wrong = await dial("S-pin-1", "3*1*100*0000");
    expect(wrong.text).toBe("END Incorrect PIN. Attempts remaining: 4");
    expect((await store.getAccountByPhone("+254700112233"))?.balance_kes_cents).toBe(350000);

    await dial("S-pin-2", "3*1*100*0000");
    await dial("S-pin-3", "3*1*100*0000");
    await dial("S-pin-4", "3*1*100*0000");
    const locked = await dial("S-pin-5", "3*1*100*0000");
    expect(locked.text).toBe("END Account locked. Try again in 15 minutes.");
    expect((await store.getAccountByPhone("+254700112233"))?.balance_kes_cents).toBe(350000);
  });

  it("refuses a withdrawal above the balance", async () => {
    const res = await dial("S-low", "3*1*4000*1234");
    expect(res.text).toBe("END Not enough balance.");
    expect(res.text).not.toContain("Available");
    expect((await store.getAccountByPhone("+254700112233"))?.balance_kes_cents).toBe(350000);
  });

  it("does not run a withdrawal again when the gateway retries the same step", async () => {
    const spy = jest.spyOn(pipeline, "withdraw");
    try {
      const first = await dial("S-replay", "3*1*100*1234");
      const second = await dial("S-replay", "3*1*100*1234");
      expect(first.text).toContain("END Withdrawal of KES 100.00");
      expect(second.text).toBe(first.text);
      expect(spy).toHaveBeenCalledTimes(1);
      expect((await store.getAccountByPhone("+254700112233"))?.balance_kes_cents).toBe(340000);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a different phone on an open session", async () => {
    const pinHash = await hashPin("1234");
    await store.saveAccount({
      id: "acc_other",
      full_name: "Other Farmer",
      phone_number: "+254700112244",
      id_number: "ID998",
      payout_destinations: [
        {
          id: "dest_other",
          type: "mpesa",
          details: "+254700112244",
          account_name: "Other Farmer",
          is_verified: true,
        },
      ],
      coop_id: null,
      channel_capability: "webapp+ussd",
      balance_kes_cents: 90000,
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    });

    await dial("S-bind", "", "+254700112233");
    const swapped = await dial("S-bind", "1", "+254700112244");
    expect(swapped.text).toBe("END This session does not match your number.");
    expect((await store.getAccount("acc_other"))?.balance_kes_cents).toBe(90000);
    expect((await store.getAccount("acc_ussd_farmer"))?.balance_kes_cents).toBe(350000);
  });

  it("does not pay a second account that reuses a withdrawal key", async () => {
    const pinHash = await hashPin("1234");
    await store.saveAccount({
      id: "acc_other_key",
      full_name: "Other Key",
      phone_number: "+254700112255",
      id_number: "ID997",
      payout_destinations: [
        {
          id: "dest_other_key",
          type: "mpesa",
          details: "+254700112255",
          account_name: "Other Key",
          is_verified: true,
        },
      ],
      coop_id: null,
      channel_capability: "webapp+ussd",
      balance_kes_cents: 80000,
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    });

    const first = await pipeline.withdraw("acc_ussd_farmer", "dest_mpesa_kip", 10000, "1234", "shared-key");
    expect(first.success).toBe(true);
    const second = await pipeline.withdraw("acc_other_key", "dest_other_key", 10000, "1234", "shared-key");
    expect(second.success).toBe(false);
    expect(second.error).toBe("idempotency_conflict");
    expect((await store.getAccount("acc_other_key"))?.balance_kes_cents).toBe(80000);
    expect((await store.getAccount("acc_ussd_farmer"))?.balance_kes_cents).toBe(340000);
  });

  it("ends an expired session without moving money", async () => {
    process.env.AT_USSD_SESSION_TTL_MS = "0";
    await dial("S-expire", "");
    const next = await dial("S-expire", "3*1*100*1234");
    expect(next.text).toBe("END Session expired. Please dial again.");
    expect((await store.getAccountByPhone("+254700112233"))?.balance_kes_cents).toBe(350000);
  });

  it("rejects a service code that does not match the configured short code", async () => {
    process.env.AT_USSD_SERVICE_CODE = "*384*1#";
    const wrong = await dial("S-code", "", "+254700112233", "*999#");
    expect(wrong.text).toBe("END This service is not available.");
    const right = await dial("S-code-ok", "", "+254700112233", "*384*1#");
    expect(right.text).toContain("CON Welcome to Stawi");
  });

  it("stops a phone that dials too often", async () => {
    process.env.AT_USSD_RATE_LIMIT = "2";
    expect((await dial("S-rate-1", "")).text).toContain("CON Welcome to Stawi");
    expect((await dial("S-rate-2", "")).text).toContain("CON Welcome to Stawi");
    const blocked = await dial("S-rate-3", "1");
    expect(blocked.text).toBe("END Too many requests. Please dial again shortly.");
    expect(blocked.text).not.toContain("3,500.00");
  });

  it("returns a short END screen when a service throws", async () => {
    const spy = jest.spyOn(pipeline, "withdraw").mockRejectedValueOnce(new Error("database unavailable"));
    try {
      const res = await dial("S-boom", "3*1*100*1234");
      expect(res.status).toBe(200);
      expect(res.text).toBe("END Stawi is unavailable right now. Please dial again.");
      expect(res.text).not.toContain("database");
    } finally {
      spy.mockRestore();
    }
  });

  it("lists recent sessions for an admin without the PIN or full phone", async () => {
    const previous = process.env.ADMIN_SECRET;
    process.env.ADMIN_SECRET = "admin-test";
    try {
      await dial("S-admin", "3*1*100*1234");
      const hidden = await request(app).get("/admin/ussd-sessions");
      expect(hidden.status).toBe(401);

      const login = await request(app).post("/admin/phones/login").type("form").send({ secret: "admin-test" });
      const raw = login.headers["set-cookie"];
      const cookie = (Array.isArray(raw) ? raw : [String(raw)]).map((item) => item.split(";")[0]).join("; ");
      const res = await request(app).get("/admin/ussd-sessions").set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.sessions[0].session_id).toBe("S-admin");
      expect(res.body.sessions[0].phone_masked).toBe("***2233");
      expect(res.body.sessions[0].state).toBe("withdraw_done");
      expect(JSON.stringify(res.body)).not.toContain("1234");
      expect(JSON.stringify(res.body)).not.toContain("+254700112233");

      delete process.env.ADMIN_SECRET;
      const missing = await request(app).get("/admin/ussd-sessions");
      expect(missing.status).toBe(404);
    } finally {
      if (previous === undefined) delete process.env.ADMIN_SECRET;
      else process.env.ADMIN_SECRET = previous;
    }
  });
});
