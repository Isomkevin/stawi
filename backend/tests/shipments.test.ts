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

  it("deletes a shipment with no paid invoice and refuses one that has been paid", async () => {
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
      status: "pending",
      split_approved: false,
      fx_rate: null,
      fee_kes_cents: null,
      kes_total_cents: null,
      payaza_checkout_reference: null,
      created_at: new Date().toISOString(),
      due_at: null,
    });
    await store.saveShipment(shipment({ invoice_id: "inv_open" }));

    const removed = await request(app).delete("/shipments/shp_test");
    expect(removed.status).toBe(204);
    expect(await store.getShipment("shp_test")).toBeUndefined();

    await store.saveInvoice({
      ...(await store.getInvoice("inv_open"))!,
      status: "completed",
      split_approved: true,
    });
    await store.saveShipment(shipment({ id: "shp_paid", reference: "TEST-S-2", invoice_id: "inv_open", status: "delivered" }));
    const blocked = await request(app).delete("/shipments/shp_paid");
    expect(blocked.status).toBe(409);
    expect(await store.getShipment("shp_paid")).toBeDefined();
  });

  it("deletes only a pending invoice and drops the shipment link", async () => {
    await store.saveInvoice({
      id: "inv_open",
      type: "coop",
      account_id: null,
      coop_id: "coop_test",
      buyer_name: "Buyer",
      buyer_email: "buyer@example.com",
      amount: 500,
      currency: "USD",
      description: "Lot",
      reference: "INV-OPEN-2",
      status: "pending",
      split_approved: false,
      fx_rate: null,
      fee_kes_cents: null,
      kes_total_cents: null,
      payaza_checkout_reference: null,
      created_at: new Date().toISOString(),
      due_at: null,
    });
    await store.saveShipment(shipment({ invoice_id: "inv_open" }));

    const deleted = await request(app).delete("/invoices/inv_open");
    expect(deleted.status).toBe(204);
    expect(await store.getInvoice("inv_open")).toBeUndefined();
    expect((await store.getShipment("shp_test"))?.invoice_id).toBeNull();

    await store.saveInvoice({
      id: "inv_paid",
      type: "coop",
      account_id: null,
      coop_id: "coop_test",
      buyer_name: "Buyer",
      buyer_email: "buyer@example.com",
      amount: 500,
      currency: "USD",
      description: "Lot",
      reference: "INV-PAID",
      status: "settling",
      split_approved: false,
      fx_rate: 129,
      fee_kes_cents: 100,
      kes_total_cents: 1000,
      payaza_checkout_reference: null,
      created_at: new Date().toISOString(),
      due_at: null,
    });
    const blocked = await request(app).delete("/invoices/inv_paid");
    expect(blocked.status).toBe(409);
    expect(await store.getInvoice("inv_paid")).toBeDefined();
  });

  it("removes a farmer from the co-op and keeps their account", async () => {
    await store.saveAccount({
      id: "acc_farmer",
      full_name: "Wanjiku Mwangi",
      phone_number: "+254712000001",
      id_number: "ID2",
      payout_destinations: [],
      coop_id: "coop_test",
      channel_capability: "webapp",
      balance_kes_cents: 5000,
      incoming_kes_cents: 0,
    });
    await store.addCoopMember({
      coop_id: "coop_test",
      account_id: "acc_farmer",
      full_name: "Wanjiku Mwangi",
      contribution_share: 15,
      kilos: 100,
    });

    const removed = await request(app).delete("/coops/coop_test/members/acc_farmer");
    expect(removed.status).toBe(204);
    expect(await store.getCoopMembers("coop_test")).toEqual([]);
    const account = await store.getAccount("acc_farmer");
    expect(account?.coop_id).toBeNull();
    expect(account?.balance_kes_cents).toBe(5000);

    const again = await request(app).delete("/coops/coop_test/members/acc_farmer");
    expect(again.status).toBe(404);
  });

  it("returns 404 for an unknown co-op or shipment", async () => {
    const missingCoop = await request(app).get("/coops/missing/shipments");
    expect(missingCoop.status).toBe(404);
    const missing = await request(app).patch("/shipments/missing").send({ action: "advance" });
    expect(missing.status).toBe(404);
  });
});
