import request from "supertest";
import { createApp } from "../src/app";
import { hashPin } from "../src/services/pin";
import { store } from "../src/store";
import { Account } from "../src/types";

describe("USSD Gateway Adapter", () => {
  const app = createApp();
  const secret = "test-secret";
  process.env.AT_CALLBACK_SECRET = secret;

  beforeEach(async () => {
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

    // Verify balance was reduced
    const updated = await store.getAccountByPhone("+254700112233");
    expect(updated?.balance_kes_cents).toBe(250000);
  });
});
