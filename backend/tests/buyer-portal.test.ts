import request from "supertest";
import { createApp } from "../src/app";
import { store } from "../src/store";

describe("Buyer portal codes", () => {
  const app = createApp();

  beforeEach(async () => {
    await store.reset();
    delete process.env.AUTH_REQUIRED;
    process.env.PAYAZA_MODE = "mock";
    await store.saveCoop({ id: "coop_test", name: "Test Co-op", treasurer_account_id: "acc_treasurer" });
  });

  it("opens the shipment that owns the code, and each shipment has a different code", async () => {
    const invoice = {
      type: "coop",
      coop_id: "coop_test",
      buyer_name: "Nordic Roasters",
      buyer_email: "pay@nordic.example",
      amount: 1000,
      currency: "EUR",
      description: "500 kg coffee",
    };
    expect((await request(app).post("/invoices").send(invoice)).status).toBe(201);
    expect((await request(app).post("/invoices").send({
      ...invoice,
      buyer_name: "Other Buyer",
      buyer_email: "pay@other.example",
      description: "200 kg tea",
    })).status).toBe(201);

    const listed = await request(app).get("/coops/coop_test/shipments");
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(2);
    const codes = listed.body.map((s: { buyer_code: string }) => s.buyer_code);
    expect(codes[0]).toMatch(/^[A-Z0-9]{8}$/);
    expect(codes[1]).toMatch(/^[A-Z0-9]{8}$/);
    expect(codes[0]).not.toBe(codes[1]);

    for (const shipment of listed.body) {
      const hit = await request(app).post("/buyer/lookup").send({ access_code: shipment.buyer_code });
      expect(hit.status).toBe(200);
      expect(hit.body.shipment.reference).toBe(shipment.reference);
      expect(hit.body.invoice.buyer_name).toBe(shipment.buyer_name);
    }

    const [a, b] = listed.body;
    const mismatch = await request(app).post("/buyer/lookup").send({
      access_code: a.buyer_code,
      shipment_reference: b.reference,
    });
    expect(mismatch.status).toBe(404);

    const shared = await request(app).post("/buyer/lookup").send({
      access_code: "STAWI-BUYER-2026",
      shipment_reference: a.reference,
    });
    expect(shared.status).toBe(403);

    const again = await request(app).get("/coops/coop_test/shipments");
    expect(again.body.map((s: { buyer_code: string }) => s.buyer_code).sort()).toEqual([...codes].sort());
  });
});
