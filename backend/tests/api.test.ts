import crypto from "crypto";
import request from "supertest";
import { createApp } from "../src/app";
import { store } from "../src/store";

describe("REST API Endpoints", () => {
  const app = createApp();

  beforeEach(() => {
    store.reset();
  });

  it("GET /health returns 200 { status: 'ok' }", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("POST /accounts creates an account without leaking pin_hash", async () => {
    const payload = {
      full_name: "Baraka Mwangi",
      phone_number: "+254712345678",
      id_number: "ID555666",
      pin: "1234",
      destination: {
        type: "mpesa",
        details: "+254712345678",
        account_name: "Baraka Mwangi",
      },
      ussd: true,
    };

    const res = await request(app).post("/accounts").send(payload);
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.full_name).toBe("Baraka Mwangi");
    expect(res.body.pin_hash).toBeUndefined();
    expect(res.body.channel_capability).toBe("webapp+ussd");

    const getRes = await request(app).get(`/accounts/${res.body.id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.pin_hash).toBeUndefined();
  });

  it("POST /invoices creates direct and coop invoices", async () => {
    const directPayload = {
      type: "direct",
      account_id: "acc_demo",
      buyer_name: "Artisan Importers",
      buyer_email: "buyer@artisan.com",
      amount: 1500,
      currency: "USD",
      description: "Sample Sisal Lot",
    };

    const res = await request(app).post("/invoices").send(directPayload);
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("pending");
    expect(res.body.amount).toBe(1500);
    expect(res.body.currency).toBe("USD");
  });

  it("POST /webhooks/payaza verifies signature and processes payment", async () => {
    const secret = "test-secret-key";
    process.env.PAYAZA_SECRET_KEY = secret;
    process.env.PAYAZA_MODE = "live"; // Force signature verification

    // Create an invoice first
    const invRes = await request(app).post("/invoices").send({
      type: "direct",
      account_id: "acc_demo",
      buyer_name: "Artisan Importers",
      buyer_email: "buyer@artisan.com",
      amount: 1500,
      currency: "USD",
      description: "Sample Sisal Lot",
    });
    const invId = invRes.body.id;

    const payload = JSON.stringify({
      transaction_reference: `STAWI-${invId}-TX1`,
      merchant_reference: `STAWI-${invId}-TX1`,
      amount_received: 1500,
      currency_code: "USD",
      status: "Completed",
      additional_details: { invoice_id: invId },
    });

    // 1. Invalid signature -> 401
    const resBad = await request(app)
      .post("/webhooks/payaza")
      .set("Content-Type", "application/json")
      .set("x-payaza-signature", "invalid-sig")
      .send(payload);
    expect(resBad.status).toBe(401);

    // 2. Valid signature -> 200
    const validSig = crypto.createHmac("sha512", secret).update(payload).digest("base64");
    const resGood = await request(app)
      .post("/webhooks/payaza")
      .set("Content-Type", "application/json")
      .set("x-payaza-signature", validSig)
      .send(payload);
    expect(resGood.status).toBe(200);
    expect(resGood.body.received).toBe(true);

    process.env.PAYAZA_MODE = "mock";
  });
});
