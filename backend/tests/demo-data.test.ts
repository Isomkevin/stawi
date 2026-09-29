import request from "supertest";
import { createApp } from "../src/app";
import { store } from "../src/store";
import { Invoice } from "../src/types";

describe("demo data alongside live transactions", () => {
  const app = createApp();
  const previous = {
    mode: process.env.PAYAZA_MODE,
    auth: process.env.AUTH_REQUIRED,
    demo: process.env.DEMO_DATA_ENABLED,
  };

  beforeEach(async () => {
    await store.reset();
    process.env.PAYAZA_MODE = "mock";
    delete process.env.AUTH_REQUIRED;
    delete process.env.DEMO_DATA_ENABLED;
  });

  afterAll(() => {
    if (previous.mode === undefined) delete process.env.PAYAZA_MODE;
    else process.env.PAYAZA_MODE = previous.mode;
    if (previous.auth === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previous.auth;
    if (previous.demo === undefined) delete process.env.DEMO_DATA_ENABLED;
    else process.env.DEMO_DATA_ENABLED = previous.demo;
  });

  async function signup(): Promise<{ id: string; token: string; destinationId: string }> {
    const res = await request(app).post("/accounts").send({
      full_name: "Amina Otieno",
      phone_number: "+254700111222",
      id_number: "ID900",
      pin: "1234",
      destination: { type: "mpesa", details: "+254700111222", account_name: "Amina Otieno" },
    });
    expect(res.status).toBe(201);
    expect(res.body.is_demo).toBe(false);
    return {
      id: res.body.id as string,
      token: res.body.token as string,
      destinationId: res.body.payout_destinations[0].id as string,
    };
  }

  function sampleInvoice(accountId: string): Invoice {
    return {
      id: "inv_sample_1",
      type: "direct",
      account_id: accountId,
      coop_id: null,
      buyer_name: "Sample Buyer",
      buyer_email: "sample@example.com",
      amount: 100,
      currency: "USD",
      description: "Sample lot",
      reference: "SAMPLE-1",
      status: "pending",
      split_approved: false,
      fx_rate: null,
      fee_kes_cents: null,
      kes_total_cents: null,
      payaza_checkout_reference: null,
      is_demo: true,
      created_at: new Date().toISOString(),
      due_at: null,
    };
  }

  it("stores the switch on the account and hides sample invoices without deleting them", async () => {
    const { id, token } = await signup();
    await store.saveInvoice(sampleInvoice(id));
    const live = await request(app).post("/invoices").send({
      type: "direct",
      account_id: id,
      buyer_name: "Live Buyer",
      buyer_email: "live@example.com",
      amount: 50,
      currency: "USD",
    });
    expect(live.status).toBe(201);
    expect(live.body.is_demo).toBe(false);

    const auth = { Authorization: `Bearer ${token}` };
    const shown = await request(app).get("/invoices").query({ account_id: id }).set(auth);
    expect(shown.body.map((row: Invoice) => row.id).sort()).toEqual(["inv_sample_1", live.body.id].sort());

    const off = await request(app).patch(`/accounts/${id}/settings`).set(auth).send({ demo_data_enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.demo_data_visible).toBe(false);
    expect(off.body.effect).toMatch(/does not switch Payaza mode/);

    const hidden = await request(app).get("/invoices").query({ account_id: id }).set(auth);
    expect(hidden.body.map((row: Invoice) => row.id)).toEqual([live.body.id]);
    expect((await store.getInvoice("inv_sample_1"))?.is_demo).toBe(true);

    const saved = await request(app).get(`/accounts/${id}/settings`).set(auth);
    expect(saved.body.demo_data_enabled).toBe(false);

    const reset = await request(app).patch(`/accounts/${id}/settings`).set(auth).send({ demo_data_enabled: null });
    expect(reset.body.demo_data_enabled).toBeNull();
    expect(reset.body.demo_data_visible).toBe(reset.body.demo_data_default);
  });

  it("refuses to send sample invoices or sample balances through live Payaza", async () => {
    const { id, destinationId } = await signup();
    const account = await store.getAccount(id);
    account!.balance_kes_cents = 25_000;
    account!.demo_balance_kes_cents = 80_000;
    await store.saveAccount(account!);
    await store.saveInvoice(sampleInvoice(id));

    process.env.PAYAZA_MODE = "live";
    process.env.AUTH_REQUIRED = "false";

    const blocked = await request(app).post(`/accounts/${id}/withdraw`).send({
      destination_id: destinationId,
      amount_kes_cents: 50_000,
      pin: "1234",
    });
    expect(blocked.status).toBe(400);
    expect(String(blocked.body.error).toLowerCase()).toContain("insufficient");
    expect(String(blocked.body.error)).toContain("Sample funds");

    const untouched = await store.getAccount(id);
    expect(untouched?.balance_kes_cents).toBe(25_000);
    expect(untouched?.demo_balance_kes_cents).toBe(80_000);

    const checkout = await request(app).post("/invoices/inv_sample_1/checkout-session");
    expect(checkout.status).toBe(409);
    expect((await store.getInvoice("inv_sample_1"))?.status).toBe("pending");

    process.env.PAYAZA_MODE = "mock";
    const withdrawal = await request(app).post(`/accounts/${id}/withdraw`).send({
      destination_id: destinationId,
      amount_kes_cents: 50_000,
      pin: "1234",
      idempotency_key: "demo-wth-1",
    });
    expect(withdrawal.status).toBe(200);
    expect(withdrawal.body.is_demo).toBe(false);
    expect(withdrawal.body.demo_portion_kes_cents).toBe(25_000);

    const after = await store.getAccount(id);
    expect(after?.balance_kes_cents).toBe(0);
    expect(after?.demo_balance_kes_cents).toBe(55_000);
  });
});
