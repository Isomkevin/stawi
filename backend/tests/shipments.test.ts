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

  it("adds a co-op farmer to a shipment so they can be paid", async () => {
    await store.saveAccount({
      id: "acc_farmer",
      full_name: "Wanjiku",
      phone_number: "+254722000001",
      id_number: "ID2",
      payout_destinations: [],
      coop_id: "coop_test",
      channel_capability: "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 50_000,
      demo_incoming_kes_cents: 0,
    });
    await store.saveAccount({
      id: "acc_other",
      full_name: "Achieng",
      phone_number: "+254722000002",
      id_number: "ID3",
      payout_destinations: [],
      coop_id: "coop_test",
      channel_capability: "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 50_000,
    });
    await store.addCoopMember({ coop_id: "coop_test", account_id: "acc_farmer", contribution_share: 50 });
    await store.addCoopMember({ coop_id: "coop_test", account_id: "acc_other", contribution_share: 50 });
    await store.saveInvoice({
      id: "inv_settling",
      type: "coop",
      account_id: null,
      coop_id: "coop_test",
      buyer_name: "Buyer",
      buyer_email: "buyer@example.com",
      amount: 100,
      currency: "USD",
      description: "Lot",
      reference: "INV-SETTLING",
      status: "settling",
      split_approved: false,
      fx_rate: 129,
      fee_kes_cents: 10320,
      kes_total_cents: 1_279_680,
      payaza_checkout_reference: null,
      created_at: new Date().toISOString(),
      due_at: null,
    });
    await store.saveShipment(shipment({ status: "draft", quantity_kg: 100, farmers: [], invoice_id: null }));
    const blocked = await request(app).patch("/shipments/shp_test").send({ action: "advance" });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error).toBe("Add farmers whose kilos add up to the shipment quantity");

    await store.saveShipment(shipment({
      status: "delivered",
      quantity_kg: 100,
      farmers: [],
      invoice_id: "inv_settling",
    }));

    const stranger = await request(app).post("/shipments/shp_test/farmers").send({ account_id: "acc_missing", kilos: 10 });
    expect(stranger.status).toBe(400);

    const added = await request(app).post("/shipments/shp_test/farmers").send({ account_id: "acc_farmer", kilos: 60 });
    expect(added.status).toBe(201);
    expect(added.body.farmers).toEqual([{ account_id: "acc_farmer", kilos: 60 }]);

    const updated = await request(app).post("/shipments/shp_test/farmers").send({ account_id: "acc_farmer", kilos: 40 });
    expect(updated.status).toBe(200);

    const second = await request(app).post("/shipments/shp_test/farmers").send({ account_id: "acc_other", kilos: 60 });
    expect(second.status).toBe(201);
    expect(second.body.farmers).toEqual([
      { account_id: "acc_farmer", kilos: 40 },
      { account_id: "acc_other", kilos: 60 },
    ]);

    const farmer = await store.getAccount("acc_farmer");
    const other = await store.getAccount("acc_other");
    expect((farmer?.incoming_kes_cents ?? 0) + (other?.incoming_kes_cents ?? 0)).toBe(1_279_680);
    expect(other?.incoming_kes_cents).toBeGreaterThan(farmer?.incoming_kes_cents ?? 0);

    const tooMuch = await request(app).post("/shipments/shp_test/farmers").send({ account_id: "acc_other", kilos: 80 });
    expect(tooMuch.status).toBe(400);

    const removed = await request(app).delete("/shipments/shp_test/farmers/acc_other");
    expect(removed.status).toBe(200);
    expect(removed.body.farmers).toEqual([{ account_id: "acc_farmer", kilos: 40 }]);
    expect((await store.getAccount("acc_other"))?.incoming_kes_cents).toBe(0);
    expect((await store.getAccount("acc_farmer"))?.incoming_kes_cents).toBe(1_279_680);

    await store.saveInvoice({
      ...(await store.getInvoice("inv_settling"))!,
      status: "completed",
      split_approved: true,
    });
    const locked = await request(app).post("/shipments/shp_test/farmers").send({ account_id: "acc_other", kilos: 60 });
    expect(locked.status).toBe(409);
  });

  it("links a new invoice to the shipment you choose", async () => {
    await store.saveShipment(shipment({ invoice_id: null, buyer_name: "Buyer not assigned", value: 1000 }));
    const created = await request(app).post("/invoices").send({
      type: "coop",
      coop_id: "coop_test",
      buyer_name: "Buyer BV",
      buyer_email: "buyer@bv.com",
      amount: 2500,
      currency: "usd",
      description: "Washed AA",
      shipment_id: "shp_test",
    });
    expect(created.status).toBe(201);
    const linked = await store.getShipment("shp_test");
    expect(linked?.invoice_id).toBe(created.body.id);
    expect(linked?.buyer_name).toBe("Buyer BV");
    expect(linked?.value).toBe(2500);
    expect(linked?.currency).toBe("USD");
    expect(linked?.farmers).toEqual([{ account_id: "acc_farmer", kilos: 100 }]);

    const again = await request(app).post("/invoices").send({
      type: "coop",
      coop_id: "coop_test",
      buyer_name: "Other Buyer",
      buyer_email: "other@bv.com",
      amount: 900,
      currency: "USD",
      description: "Another lot",
      shipment_id: "shp_test",
    });
    expect(again.status).toBe(409);
    expect((await store.listShipments("coop_test")).filter((item) => item.invoice_id === again.body?.id)).toEqual([]);

    const fresh = await request(app).post("/invoices").send({
      type: "coop",
      coop_id: "coop_test",
      buyer_name: "New Buyer",
      buyer_email: "new@bv.com",
      amount: 400,
      currency: "EUR",
      description: "500 kg peaberry",
    });
    expect(fresh.status).toBe(201);
    const opened = await store.getShipmentByInvoice(fresh.body.id);
    expect(opened?.quantity_kg).toBe(500);
    expect(opened?.farmers).toEqual([]);
    expect(opened?.id).not.toBe("shp_test");
  });

  it("returns 404 for an unknown co-op or shipment", async () => {
    const missingCoop = await request(app).get("/coops/missing/shipments");
    expect(missingCoop.status).toBe(404);
    const missing = await request(app).patch("/shipments/missing").send({ action: "advance" });
    expect(missing.status).toBe(404);
  });
});
