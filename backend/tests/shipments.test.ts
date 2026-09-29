import request from "supertest";
import { createApp } from "../src/app";
import { store } from "../src/store";
import { Shipment } from "../src/types";

function shipment(overrides: Partial<Shipment> = {}): Shipment {
  return {
    id: "shp_test",
    reference: "TEST-S-1",
    coop_id: "coop_test",
    buyer_name: "Buyer",
    product: "Green coffee",
    quantity_kg: 100,
    destination: "Hamburg",
    value: 1000,
    currency: "USD",
    ship_date: new Date().toISOString(),
    shipped_at: null,
    status: "ready",
    invoice_id: null,
    farmers: [{ account_id: "acc_farmer", kilos: 100 }],
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("Co-op shipments", () => {
  const app = createApp();

  beforeEach(async () => {
    await store.reset();
    delete process.env.AUTH_REQUIRED;
    process.env.PAYAZA_MODE = "mock";
    await store.saveCoop({ id: "coop_test", name: "Test Co-op", treasurer_account_id: "acc_treasurer" });
    await store.saveAccount({
      id: "acc_treasurer",
      full_name: "Treasurer",
      phone_number: "+254711000000",
      id_number: "ID1",
      payout_destinations: [],
      coop_id: "coop_test",
      channel_capability: "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 0,
    });
  });

  it("lists a co-op's shipments and advances one stage", async () => {
    await store.saveShipment(shipment());
    await store.saveShipment(shipment({ id: "shp_other", reference: "OTHER-1", coop_id: "coop_other" }));

    const listed = await request(app).get("/coops/coop_test/shipments");
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].id).toBe("shp_test");
    expect(listed.body[0].farmers).toEqual([{ account_id: "acc_farmer", kilos: 100 }]);

    const advanced = await request(app).patch("/shipments/shp_test").send({ action: "advance" });
    expect(advanced.status).toBe(200);
    expect(advanced.body.status).toBe("in_transit");
    expect(advanced.body.shipped_at).toEqual(expect.any(String));

    const again = await request(app).get("/coops/coop_test/shipments");
    expect(again.body[0].status).toBe("in_transit");
  });

  it("refuses to close a delivered shipment until the invoice is completed", async () => {
    await store.saveInvoice({
      id: "inv_open",
      type: "coop",
      account_id: null,
      coop_id: "coop_test",
      buyer_name: "Buyer",
      buyer_email: "buyer@example.com",
      amount: 1000,
      currency: "USD",
      description: "Lot",
      reference: "INV-OPEN",
      status: "settling",
      split_approved: false,
      fx_rate: 129,
      fee_kes_cents: 100,
      kes_total_cents: 10000,
      payaza_checkout_reference: null,
      created_at: new Date().toISOString(),
      due_at: null,
    });
    await store.saveShipment(shipment({ status: "delivered", invoice_id: "inv_open", shipped_at: new Date().toISOString() }));

    const blocked = await request(app).patch("/shipments/shp_test").send({ action: "advance" });
    expect(blocked.status).toBe(400);

    const invoice = await store.getInvoice("inv_open");
    await store.saveInvoice({ ...invoice!, status: "completed", split_approved: true });
    const closed = await request(app).patch("/shipments/shp_test").send({ action: "advance" });
    expect(closed.status).toBe(200);
    expect(closed.body.status).toBe("completed");

    const done = await request(app).patch("/shipments/shp_test").send({ action: "advance" });
    expect(done.status).toBe(400);
  });

  it("returns 404 for an unknown co-op or shipment", async () => {
    const missingCoop = await request(app).get("/coops/missing/shipments");
    expect(missingCoop.status).toBe(404);
    const missing = await request(app).patch("/shipments/missing").send({ action: "advance" });
    expect(missing.status).toBe(404);
  });
});
