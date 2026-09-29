import request from "supertest";
import { createApp } from "../src/app";
import { formatKes } from "../src/services/money";
import { GLOBAL_SMS_RECIPIENT } from "../src/services/notify";
import { pipeline } from "../src/services/pipeline";
import { hashPin } from "../src/services/pin";
import { store } from "../src/store";
import { Account, Coop, Invoice, Shipment } from "../src/types";

describe("Pipeline Service", () => {
  beforeEach(async () => {
    await store.reset();
  });

  it("completes Stawi Direct collection, conversion, and credits exporter balance", async () => {
    const pinHash = await hashPin("1234");
    const exporter: Account = {
      id: "acc_exp",
      full_name: "Exporter Jane",
      phone_number: "+254711111111",
      id_number: "ID111",
      payout_destinations: [],
      coop_id: null,
      channel_capability: "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    };
    await store.saveAccount(exporter);

    const inv: Invoice = {
      id: "inv_dir_test",
      type: "direct",
      account_id: exporter.id,
      coop_id: null,
      buyer_name: "Global Importers",
      buyer_email: "buyer@example.com",
      amount: 1000,
      currency: "USD",
      description: "Test Direct Invoice",
      reference: "INV-DIR-TEST",
      status: "pending",
      split_approved: false,
      fx_rate: null,
      fee_kes_cents: null,
      kes_total_cents: null,
      payaza_checkout_reference: null,
      created_at: new Date().toISOString(),
      due_at: null,
    };
    await store.saveInvoice(inv);

    const res = await pipeline.processPayment(inv.id);
    expect(res.invoice.status).toBe("completed");
    expect(res.invoice.fx_rate).toBe(129.0);
    expect(res.invoice.kes_total_cents).toBeGreaterThan(0);

    const updatedExp = await store.getAccount(exporter.id);
    expect(updatedExp?.balance_kes_cents).toBe(res.invoice.kes_total_cents);

    const payouts = await store.getPayoutsByAccount(exporter.id);
    expect(payouts.length).toBe(1);
    expect(payouts[0].kind).toBe("credit");
    expect(payouts[0].status).toBe("confirmed");
  });

  it("handles Stawi Co-op flow with split approval and largest-remainder payout distribution", async () => {
    const pinHash = await hashPin("1234");

    const coop: Coop = {
      id: "coop_test",
      name: "Test Co-op",
      treasurer_account_id: "acc_treasurer",
    };
    await store.saveCoop(coop);

    const treasurer: Account = {
      id: "acc_treasurer",
      full_name: "Treasurer Dan",
      phone_number: "+254722222222",
      id_number: "ID222",
      payout_destinations: [],
      coop_id: coop.id,
      channel_capability: "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    };
    await store.saveAccount(treasurer);

    const farmer1: Account = {
      id: "acc_f1",
      full_name: "Farmer One",
      phone_number: "+254733333331",
      id_number: "ID331",
      payout_destinations: [],
      coop_id: coop.id,
      channel_capability: "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    };
    const farmer2: Account = {
      id: "acc_f2",
      full_name: "Farmer Two",
      phone_number: "+254733333332",
      id_number: "ID332",
      payout_destinations: [],
      coop_id: coop.id,
      channel_capability: "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    };
    await store.saveAccount(farmer1);
    await store.saveAccount(farmer2);

    const farmer3: Account = {
      id: "acc_f3",
      full_name: "Farmer Three",
      phone_number: "+254733333333",
      id_number: "ID333",
      payout_destinations: [],
      coop_id: coop.id,
      channel_capability: "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    };
    await store.saveAccount(farmer3);

    await store.addCoopMember({ coop_id: coop.id, account_id: farmer1.id, contribution_share: 60 });
    await store.addCoopMember({ coop_id: coop.id, account_id: farmer2.id, contribution_share: 40 });
    await store.addCoopMember({ coop_id: coop.id, account_id: farmer3.id, contribution_share: 0 });

    const inv: Invoice = {
      id: "inv_coop_test",
      type: "coop",
      account_id: null,
      coop_id: coop.id,
      buyer_name: "Buyer BV",
      buyer_email: "buyer@bv.com",
      amount: 5000,
      currency: "USD",
      description: "Coop Coffee Lot",
      reference: "INV-COOP-TEST",
      status: "pending",
      split_approved: false,
      fx_rate: null,
      fee_kes_cents: null,
      kes_total_cents: null,
      payaza_checkout_reference: null,
      created_at: new Date().toISOString(),
      due_at: null,
    };
    await store.saveInvoice(inv);

    const shipment: Shipment = {
      id: "shp_coop_test",
      reference: "SHP-COOP-TEST",
      coop_id: coop.id,
      buyer_name: inv.buyer_name,
      product: "Coop Coffee Lot",
      quantity_kg: 100,
      destination: "Rotterdam",
      value: inv.amount,
      currency: inv.currency,
      ship_date: new Date().toISOString(),
      shipped_at: null,
      status: "ready",
      invoice_id: inv.id,
      farmers: [
        { account_id: farmer1.id, kilos: 60 },
        { account_id: farmer2.id, kilos: 40 },
      ],
      updated_at: new Date().toISOString(),
    };
    await store.saveShipment(shipment);

    // 1. Process payment: puts into settling state, populates incoming_kes_cents
    const step1 = await pipeline.processPayment(inv.id);
    expect(step1.invoice.status).toBe("settling");
    expect(step1.invoice.split_approved).toBe(false);

    const f1AfterPayment = await store.getAccount(farmer1.id);
    const f3AfterPayment = await store.getAccount(farmer3.id);
    expect(f1AfterPayment?.incoming_kes_cents).toBeGreaterThan(0);
    expect(f3AfterPayment?.incoming_kes_cents).toBe(0);
    expect(f1AfterPayment?.balance_kes_cents).toBe(0); // Not yet available!

    // 2. Approve split with Treasurer PIN. Each farmer is texted, and the demo phone gets the same text.
    const messages: { to: string; message: string }[] = [];
    const originalFetch = global.fetch;
    const previousKey = process.env.AT_API_KEY;
    process.env.AT_ENV = "sandbox";
    process.env.AT_USERNAME = "sandbox";
    process.env.AT_API_KEY = "stawi-sms-key";
    process.env.AT_CALLBACK_SECRET = "test-secret";
    global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
      const params = new URLSearchParams(String(init?.body));
      messages.push({ to: params.get("to") || "", message: params.get("message") || "" });
      return {
        ok: true,
        json: async () => ({ SMSMessageData: { Recipients: [{ status: "Success", messageId: "m1" }] } }),
      } as Response;
    }) as typeof fetch;

    let approval: Awaited<ReturnType<typeof pipeline.approveCoopSplit>>;
    try {
      approval = await pipeline.approveCoopSplit(inv.id, treasurer.id, "1234");
    } finally {
      global.fetch = originalFetch;
      if (previousKey === undefined) delete process.env.AT_API_KEY;
      else process.env.AT_API_KEY = previousKey;
    }
    expect(approval.success).toBe(true);
    expect(approval.invoice?.status).toBe("completed");
    expect(approval.invoice?.split_approved).toBe(true);
    expect(approval.payouts?.length).toBe(2);

    // Verify balances credited
    const f1Final = await store.getAccount(farmer1.id);
    const f2Final = await store.getAccount(farmer2.id);
    const f3Final = await store.getAccount(farmer3.id);
    expect(f1Final?.balance_kes_cents).toBeGreaterThan(0);
    expect(f2Final?.balance_kes_cents).toBeGreaterThan(0);
    expect(f3Final?.balance_kes_cents).toBe(0);
    expect(f1Final?.balance_kes_cents! + f2Final?.balance_kes_cents!).toBe(inv.kes_total_cents);

    const farmerOneText = messages.find((item) => item.to === farmer1.phone_number);
    const farmerTwoText = messages.find((item) => item.to === farmer2.phone_number);
    expect(farmerOneText?.message).toContain("Farmer One, KES");
    expect(farmerOneText?.message).toContain("is done in your Stawi balance");
    expect(farmerOneText?.message).toContain("Ref INV-COOP-TEST");
    expect(farmerOneText?.message).toContain("choose 2 to check");
    expect(farmerTwoText?.message).toContain("Farmer Two, KES");
    expect(farmerTwoText?.message).not.toContain(formatKes(approval.payouts!.find((p) => p.account_id === farmer1.id)!.amount_kes_cents));
    expect(messages.filter((item) => item.to === GLOBAL_SMS_RECIPIENT).map((item) => item.message)).toEqual([
      farmerOneText?.message,
      farmerTwoText?.message,
    ]);
    expect(messages.some((item) => item.to === farmer3.phone_number)).toBe(false);

    const app = createApp();
    const paidOne = approval.payouts!.find((p) => p.account_id === farmer1.id)!;
    const paidTwo = approval.payouts!.find((p) => p.account_id === farmer2.id)!;
    const ussdOne = await request(app)
      .post("/ussd/callback?s=test-secret")
      .send({ sessionId: "S-f1", phoneNumber: farmer1.phone_number, text: "2" });
    const ussdTwo = await request(app)
      .post("/ussd/callback?s=test-secret")
      .send({ sessionId: "S-f2", phoneNumber: farmer2.phone_number, text: "2" });
    const ussdNone = await request(app)
      .post("/ussd/callback?s=test-secret")
      .send({ sessionId: "S-f3", phoneNumber: farmer3.phone_number, text: "2" });
    expect(ussdOne.text).toContain("END Transaction done:");
    expect(ussdOne.text).toContain(`INV-COOP-TEST - done - KES ${formatKes(paidOne.amount_kes_cents)}`);
    expect(ussdOne.text).not.toContain(formatKes(paidTwo.amount_kes_cents));
    expect(ussdTwo.text).toContain(`INV-COOP-TEST - done - KES ${formatKes(paidTwo.amount_kes_cents)}`);
    expect(ussdTwo.text).not.toContain(formatKes(paidOne.amount_kes_cents));
    expect(ussdNone.text).toContain("END No recent transactions found.");

    // 3. Double-approval rejected
    const doubleApprove = await pipeline.approveCoopSplit(inv.id, treasurer.id, "1234");
    expect(doubleApprove.success).toBe(false);
    expect(doubleApprove.error).toContain("already approved");
  });

  it("refuses a split when the shipment has no farmers", async () => {
    const pinHash = await hashPin("1234");
    await store.saveAccount({
      id: "acc_treasurer",
      full_name: "Treasurer",
      phone_number: "+254700000001",
      id_number: "ID1",
      payout_destinations: [],
      coop_id: "coop_empty",
      channel_capability: "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    });
    await store.saveCoop({ id: "coop_empty", name: "Empty", treasurer_account_id: "acc_treasurer" });
    await store.saveInvoice({
      id: "inv_empty",
      type: "coop",
      account_id: null,
      coop_id: "coop_empty",
      buyer_name: "Buyer",
      buyer_email: "buyer@example.com",
      amount: 100,
      currency: "USD",
      description: "Lot",
      reference: "INV-EMPTY",
      status: "settling",
      split_approved: false,
      fx_rate: 129,
      fee_kes_cents: 100,
      kes_total_cents: 1000,
      payaza_checkout_reference: null,
      created_at: new Date().toISOString(),
      due_at: null,
    });
    const approval = await pipeline.approveCoopSplit("inv_empty", "acc_treasurer", "1234");
    expect(approval.success).toBe(false);
    expect(approval.error).toBe("Add farmers to the shipment before approving the split");
  });

  it("enforces withdrawal rules: PIN verification, balance deduction, and idempotency", async () => {
    const pinHash = await hashPin("1234");
    const account: Account = {
      id: "acc_wth_user",
      full_name: "Alice Wangari",
      phone_number: "+254744444444",
      id_number: "ID444",
      payout_destinations: [
        {
          id: "dest_mpesa_alice",
          type: "mpesa",
          details: "+254744444444",
          account_name: "Alice Wangari",
          is_verified: true,
        },
      ],
      coop_id: null,
      channel_capability: "webapp+ussd",
      balance_kes_cents: 500000, // KES 5,000.00
      incoming_kes_cents: 0,
      pin_hash: pinHash,
    };
    await store.saveAccount(account);

    // Overdraw rejected
    const overdraw = await pipeline.withdraw(
      account.id,
      "dest_mpesa_alice",
      600000,
      "1234",
      "idem-1"
    );
    expect(overdraw.success).toBe(false);
    expect(overdraw.error).toContain("Insufficient balance");

    // Successful withdrawal
    const wth = await pipeline.withdraw(
      account.id,
      "dest_mpesa_alice",
      200000, // KES 2,000.00
      "1234",
      "idem-valid"
    );
    expect(wth.success).toBe(true);
    expect(wth.payout?.amount_kes_cents).toBe(200000);

    const updated = await store.getAccount(account.id);
    expect(updated?.balance_kes_cents).toBe(300000);

    // Replay with same idempotency key returns existing payout without double deducting
    const replay = await pipeline.withdraw(
      account.id,
      "dest_mpesa_alice",
      200000,
      "1234",
      "idem-valid"
    );
    expect(replay.success).toBe(true);
    expect(replay.payout?.id).toBe(wth.payout?.id);
    expect((await store.getAccount(account.id))?.balance_kes_cents).toBe(300000);
  });
});
