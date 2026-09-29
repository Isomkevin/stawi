import crypto from "crypto";
import request from "supertest";
import { createApp } from "../src/app";
import { store } from "../src/store";

describe("REST API Endpoints", () => {
  const app = createApp();

  beforeEach(async () => {
    await store.reset();
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
    process.env.AUTH_REQUIRED = "false";

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

    const updated = await store.getInvoice(invId);
    expect(updated?.status).toBe("completed");

    process.env.PAYAZA_MODE = "mock";
    delete process.env.AUTH_REQUIRED;
  });

  it("does not credit an underpaid Payaza collection", async () => {
    const secret = "test-secret-key";
    process.env.PAYAZA_SECRET_KEY = secret;
    process.env.PAYAZA_MODE = "live";
    process.env.AUTH_REQUIRED = "false";

    const invRes = await request(app).post("/invoices").send({
      type: "direct",
      account_id: "acc_demo",
      buyer_name: "Artisan Importers",
      buyer_email: "buyer@artisan.com",
      amount: 1500,
      currency: "USD",
      description: "Underpay",
    });
    const invId = invRes.body.id;
    const payload = JSON.stringify({
      transaction_reference: `STAWI-${invId}-SHORT`,
      merchant_reference: `STAWI-${invId}-SHORT`,
      amount_received: 100,
      request_amount: 1500,
      amount_validation: "UNDERPAYMENT",
      currency_code: "USD",
      status: "Completed",
      additional_details: { invoice_id: invId },
    });
    const sig = crypto.createHmac("sha512", secret).update(payload).digest("base64");
    const res = await request(app)
      .post("/webhooks/payaza")
      .set("Content-Type", "application/json")
      .set("x-payaza-signature", sig)
      .send(payload);

    expect(res.status).toBe(200);
    expect((await store.getInvoice(invId))?.status).toBe("failed");
    process.env.PAYAZA_MODE = "mock";
    delete process.env.AUTH_REQUIRED;
  });

  it("names the seller on a public invoice without a session", async () => {
    const account = await request(app).post("/accounts").send({
      full_name: "Grace Wanjiru",
      phone_number: "+254700111222",
      id_number: "ID777888",
      pin: "1234",
      destination: { type: "mpesa", details: "+254700111222", account_name: "Grace Wanjiru" },
      ussd: false,
    });
    const coop = await request(app).post("/coops").send({
      name: "Kiambu Highlands Coffee Co-op",
      treasurer_account_id: account.body.id,
    });
    const invoice = await request(app).post("/invoices").send({
      type: "coop",
      coop_id: coop.body.id,
      buyer_name: "East Produce Kenya",
      buyer_email: "ap@eastproduce.example",
      amount: 1000,
      currency: "USD",
      description: "10 tonnes coffee",
    });

    const res = await request(app).get(`/invoices/${invoice.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body.payee_name).toBe("Kiambu Highlands Coffee Co-op");
    expect(res.body.farmer_count).toBe(0);
    expect(res.body.invoice.buyer_name).toBe("East Produce Kenya");
  });

  it("refuses simulated payment when Payaza is not in mock mode", async () => {
    const invoice = await request(app).post("/invoices").send({
      type: "direct",
      account_id: "acc_demo",
      buyer_name: "East Produce Kenya",
      buyer_email: "ap@eastproduce.example",
      amount: 1000,
      currency: "USD",
      description: "Coffee",
    });
    process.env.PAYAZA_MODE = "sandbox";
    const res = await request(app).post(`/dev/simulate-payment/${invoice.body.id}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/PAYAZA_MODE=mock/);
    process.env.PAYAZA_MODE = "mock";
  });

  it("issues a payment receipt only after the payment is received", async () => {
    process.env.PAYAZA_MODE = "mock";
    const created = await request(app).post("/invoices").send({
      type: "direct",
      account_id: "acc_demo",
      buyer_name: "East Produce Kenya",
      buyer_email: "ap@eastproduce.example",
      amount: 1000,
      currency: "USD",
      description: "Coffee",
      reference: "INV-RECEIPT-1",
    });
    const early = await request(app).get(`/invoices/${created.body.id}/receipt`);
    expect(early.status).toBe(409);

    const paid = await request(app).post(`/dev/simulate-payment/${created.body.id}`);
    expect(paid.status).toBe(200);

    const receipt = await request(app).get(`/invoices/${created.body.id}/receipt`);
    expect(receipt.status).toBe(200);
    expect(receipt.body.receipt_number).toBe("RCP-INV-RECEIPT-1");
    expect(receipt.body.buyer_name).toBe("East Produce Kenya");
    expect(receipt.body.amount).toBe(1000);
    expect(receipt.body.currency).toBe("USD");
    expect(receipt.body.fee_kes_cents).toBeGreaterThan(0);
    expect(receipt.body.net_kes_cents + receipt.body.fee_kes_cents).toBe(receipt.body.gross_kes_cents);
    expect(receipt.body.paid_at).toBeTruthy();
  });

  it("checkout session includes the Payaza connection mode", async () => {
    const invoice = await request(app).post("/invoices").send({
      type: "direct",
      account_id: "acc_demo",
      buyer_name: "East Produce Kenya",
      buyer_email: "ap@eastproduce.example",
      amount: 1000,
      currency: "USD",
      description: "Coffee",
    });
    const res = await request(app).post(`/invoices/${invoice.body.id}/checkout-session`);
    expect(res.status).toBe(200);
    expect(res.body.connection_mode).toBe("Test");
    expect(res.body.transaction_reference).toBeTruthy();
    expect(res.body.public_key).toBeTruthy();
    expect(res.body.currency_code).toBe("USD");
    expect(res.body.checkout_amount).toBe(1000);
  });

  it("converts a USD invoice into KES for Payaza checkout and rejects an unknown currency", async () => {
    const invoice = await request(app).post("/invoices").send({
      type: "direct",
      account_id: "acc_demo",
      buyer_name: "East Produce Kenya",
      buyer_email: "ap@eastproduce.example",
      amount: 1000,
      currency: "USD",
      description: "Coffee",
    });
    const kes = await request(app).post(`/invoices/${invoice.body.id}/checkout-session`).send({ currency_code: "kes" });
    expect(kes.status).toBe(200);
    expect(kes.body.currency_code).toBe("KES");
    expect(kes.body.checkout_amount).toBe(1000 * 129);

    const rejected = await request(app).post(`/invoices/${invoice.body.id}/checkout-session`).send({ currency_code: "BTC" });
    expect(rejected.status).toBe(400);
  });
});
