import request from "supertest";
import { createApp } from "../src/app";
import { formatKes } from "../src/services/money";
import { hashPin } from "../src/services/pin";
import { store } from "../src/store";
import { Account, Invoice, Payout } from "../src/types";

describe("USSD stress", () => {
  const app = createApp();
  const secret = "test-secret";
  process.env.AT_CALLBACK_SECRET = secret;
  jest.setTimeout(20000);
  let pinHash = "";

  beforeEach(async () => {
    delete process.env.AT_USSD_SERVICE_CODE;
    process.env.AT_USSD_SESSION_TTL_MS = "180000";
    process.env.AT_USSD_RATE_LIMIT = "200";
    await store.reset();
    pinHash = await hashPin("1234");
  });

  function dial(sessionId: string, phone: string, text: string) {
    return request(app)
      .post(`/ussd/callback?s=${secret}`)
      .send({ sessionId, phoneNumber: phone, serviceCode: "*384*1#", text });
  }

  async function farmer(id: string, phone: string, balance: number): Promise<void> {
    const account: Account = {
      id,
      full_name: id,
      phone_number: phone,
      id_number: id,
      payout_destinations: [
        {
          id: `dest_${id}`,
          type: "mpesa",
          details: phone,
          account_name: id,
          is_verified: true,
        },
      ],
      coop_id: null,
      channel_capability: "webapp+ussd",
      balance_kes_cents: balance,
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    };
    await store.saveAccount(account);
  }

  it("pays once when the gateway retries one withdrawal together", async () => {
    await farmer("acc_burst", "+254700112233", 350000);
    const calls = Array.from({ length: 20 }, () => dial("S-burst", "+254700112233", "3*1*100*1234"));
    const results = await Promise.all(calls);

    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.text.length).toBeLessThanOrEqual(182);
      expect(res.text).toContain("END Withdrawal of KES 100.00");
    }
    const account = await store.getAccount("acc_burst");
    expect(account?.balance_kes_cents).toBe(340000);
    const payouts = await store.getPayoutsByAccount("acc_burst");
    expect(payouts).toHaveLength(1);
    const web = await request(app).get("/accounts/acc_burst");
    expect(web.body.balance_kes_cents).toBe(340000);
  });

  it("keeps concurrent dials on different phones on their own balances", async () => {
    const people = Array.from({ length: 25 }, (_, i) => {
      const n = String(i + 1).padStart(3, "0");
      return { id: `acc_p${n}`, phone: `+254711000${n}`, cents: (i + 1) * 10000 };
    });
    for (const person of people) {
      await farmer(person.id, person.phone, person.cents);
    }

    const results = await Promise.all(
      people.map((person, i) => dial(`S-phone-${i}`, person.phone, "1"))
    );

    for (let i = 0; i < results.length; i += 1) {
      const res = results[i];
      expect(res.status).toBe(200);
      expect(res.text.length).toBeLessThanOrEqual(182);
      expect(res.text).toContain(`KES ${formatKes(people[i].cents)}`);
      const account = await store.getAccount(people[i].id);
      expect(account?.balance_kes_cents).toBe(people[i].cents);
    }
  });

  it("rejects a burst over the rate limit without moving money", async () => {
    process.env.AT_USSD_RATE_LIMIT = "8";
    await farmer("acc_rate", "+254700112233", 350000);
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => dial(`S-rate-${i}`, "+254700112233", "1"))
    );

    const allowed = results.filter((res) => res.text.includes("Your Stawi balance"));
    const blocked = results.filter((res) => res.text.includes("Too many requests"));
    expect(allowed).toHaveLength(8);
    expect(blocked).toHaveLength(32);
    for (const res of results) {
      expect(res.status).toBe(200);
      expect(res.text.length).toBeLessThanOrEqual(182);
    }
    expect((await store.getAccount("acc_rate"))?.balance_kes_cents).toBe(350000);
  });

  it("does not overdraw when many sessions withdraw at once", async () => {
    await farmer("acc_many", "+254700112244", 50000);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => dial(`S-w-${i}`, "+254700112244", "3*1*100*1234"))
    );

    const paid = results.filter((res) => res.text.includes("Withdrawal of KES 100.00"));
    const refused = results.filter((res) => res.text.includes("Not enough balance"));
    expect(paid.length).toBe(5);
    expect(refused.length).toBe(7);
    const account = await store.getAccount("acc_many");
    expect(account?.balance_kes_cents).toBe(0);
    expect(account?.balance_kes_cents).toBeGreaterThanOrEqual(0);
    expect(await store.getPayoutsByAccount("acc_many")).toHaveLength(5);
  });

  it("keeps a long transaction list inside the gateway character limit", async () => {
    await farmer("acc_long", "+254700112255", 1000);
    const reference = `INV-${"LONGREF".repeat(12)}`;
    const invoice: Invoice = {
      id: "inv_long",
      type: "direct",
      account_id: "acc_long",
      coop_id: null,
      buyer_name: "Buyer",
      buyer_email: "buyer@example.com",
      amount: 10,
      currency: "USD",
      description: "Long reference",
      reference,
      status: "completed",
      split_approved: false,
      fx_rate: null,
      fee_kes_cents: null,
      kes_total_cents: 1000,
      payaza_checkout_reference: null,
      created_at: new Date().toISOString(),
      due_at: null,
    };
    await store.saveInvoice(invoice);
    for (let i = 0; i < 3; i += 1) {
      const payout: Payout = {
        id: `payout_long_${i}`,
        invoice_id: invoice.id,
        account_id: "acc_long",
        kind: "credit",
        amount_kes_cents: 1000,
        destination_id: null,
        status: "confirmed",
        created_at: new Date(Date.now() - i * 1000).toISOString(),
      };
      await store.addPayout(payout);
    }

    const res = await dial("S-long", "+254700112255", "2");
    expect(res.status).toBe(200);
    expect(res.text.startsWith("END ")).toBe(true);
    expect(res.text.length).toBeLessThanOrEqual(182);
    expect(res.text.endsWith("...")).toBe(true);
  });
});
