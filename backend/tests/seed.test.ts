import bcrypt from "bcryptjs";
import { feeCents, splitByShares, toKesCents } from "../src/services/money";
import { seedDatabase, SEED_IDS } from "../src/data/seed";
import { store } from "../src/store";
import { Payout } from "../src/types";

jest.setTimeout(20000);

describe("rich demo seed", () => {
  beforeEach(async () => {
    await store.reset();
    SEED_IDS.farmer_ids = [];
  });

  it("loads a large ledger with exact shares, payouts, and balances", async () => {
    const ids = await seedDatabase();

    expect(ids.coop_id).toBe("coop_kiambu");
    expect(ids.treasurer_id).toBe("acc_treasurer");
    expect(ids.exporter_id).toBe("acc_exporter");
    expect(ids.farmer_ids).toEqual([
      "acc_farmer_1",
      "acc_farmer_2",
      "acc_farmer_3",
      "acc_farmer_4",
      "acc_farmer_5",
      "acc_farmer_6",
      "acc_farmer_7",
      "acc_farmer_8",
      "acc_farmer_9",
      "acc_farmer_10",
    ]);
    expect(ids.invoice_ids.pending_direct).toBe("inv_2413");

    const accounts = await store.getAllAccounts();
    const coops = await store.getAllCoops();
    const invoices = await store.getInvoices();
    const transactions = await store.getAllTransactions();

    expect(accounts).toHaveLength(86);
    expect(coops).toHaveLength(4);
    expect(invoices.length).toBeGreaterThanOrEqual(75);
    expect(transactions.length).toBeGreaterThanOrEqual(150);

    const phones = accounts.map((account) => account.phone_number);
    expect(new Set(phones).size).toBe(phones.length);
    expect(phones.every((phone) => phone.startsWith("+254"))).toBe(true);

    const treasurer = await store.getAccount("acc_treasurer");
    expect(treasurer?.full_name).toBe("David Kamau");
    expect(treasurer?.phone_number).toBe("+254711000000");
    expect(await bcrypt.compare("1234", treasurer?.pin_hash || "")).toBe(true);

    const farmer = await store.getAccount("acc_farmer_1");
    expect(farmer?.full_name).toBe("Wanjiku Mwangi");
    expect(farmer?.phone_number).toBe("+254712000001");
    expect(farmer?.payout_destinations[0]?.is_verified).toBe(true);
    expect(farmer?.is_demo).toBe(true);
    expect(farmer?.balance_kes_cents).toBe(0);
    expect(farmer?.demo_balance_kes_cents).toBeGreaterThanOrEqual(100_000);

    const kiambu = await store.getCoopMembers("coop_kiambu");
    expect(kiambu).toHaveLength(10);
    expect(kiambu.find((member) => member.account_id === "acc_farmer_1")?.contribution_share).toBe(15);

    for (const coop of coops) {
      const members = await store.getCoopMembers(coop.id);
      const share = members.reduce((sum, member) => sum + member.contribution_share, 0);
      expect(share).toBe(100);
      expect(members.length).toBeGreaterThanOrEqual(10);
    }

    const london = await store.getInvoice("inv_2413");
    expect(london?.status).toBe("pending");
    expect(london?.currency).toBe("EUR");
    expect(london?.amount).toBe(1800);
    expect(london?.account_id).toBe("acc_exporter");

    const hamburg = await store.getInvoice("inv_coop_hamburg_101");
    expect(hamburg?.status).toBe("completed");
    expect(hamburg?.buyer_name).toBe("Hanseatic Coffee Roasters GmbH");
    expect(hamburg?.amount).toBe(12400);

    const berlin = await store.getInvoice("inv_coop_berlin_102");
    expect(berlin?.status).toBe("settling");
    expect(berlin?.split_approved).toBe(false);

    const payoutsByAccount = new Map<string, Payout[]>();
    let payoutCount = 0;
    let failedWithdrawal = false;
    for (const account of accounts) {
      const payouts = await store.getPayoutsByAccount(account.id);
      payoutsByAccount.set(account.id, payouts);
      payoutCount += payouts.length;

      let credits = 0;
      let withdrawn = 0;
      for (const payout of payouts) {
        expect(Number.isInteger(payout.amount_kes_cents)).toBe(true);
        expect(payout.amount_kes_cents).toBeGreaterThan(0);
        if (payout.kind === "credit" && payout.status === "confirmed") credits += payout.amount_kes_cents;
        if (payout.kind === "withdrawal" && (payout.status === "confirmed" || payout.status === "sent")) {
          withdrawn += payout.amount_kes_cents;
        }
        expect(payout.is_demo).toBe(true);
        if (payout.kind === "withdrawal" && payout.status === "failed") {
          failedWithdrawal = true;
          const dest = account.payout_destinations.find((item) => item.id === payout.destination_id);
          expect(dest?.is_verified).toBe(false);
        }
      }
      expect(account.is_demo).toBe(true);
      expect(account.balance_kes_cents).toBe(0);
      expect(account.demo_balance_kes_cents).toBe(credits - withdrawn);
      expect(account.demo_balance_kes_cents).toBeGreaterThanOrEqual(0);
    }
    expect(payoutCount).toBeGreaterThanOrEqual(400);
    expect(failedWithdrawal).toBe(true);

    for (const invoice of invoices) {
      if (invoice.status !== "completed" || invoice.kes_total_cents == null) continue;
      let net = 0;
      for (const payouts of payoutsByAccount.values()) {
        for (const payout of payouts) {
          if (payout.invoice_id === invoice.id && payout.kind === "credit") net += payout.amount_kes_cents;
        }
      }
      expect(net).toBe(invoice.kes_total_cents);
    }

    const expectedIncoming = new Map<string, number>();
    for (const invoice of invoices) {
      if (invoice.status !== "settling" || !invoice.coop_id || invoice.fx_rate == null || invoice.fee_kes_cents == null) {
        continue;
      }
      const members = await store.getCoopMembers(invoice.coop_id);
      const gross = toKesCents(invoice.amount, invoice.currency, invoice.fx_rate);
      expect(feeCents(gross, 0.8)).toBe(invoice.fee_kes_cents);
      for (const line of splitByShares(gross, invoice.fee_kes_cents, members)) {
        expectedIncoming.set(line.account_id, (expectedIncoming.get(line.account_id) ?? 0) + line.net_kes_cents);
      }
    }
    for (const account of accounts) {
      expect(account.incoming_kes_cents).toBe(0);
      expect(account.demo_incoming_kes_cents).toBe(expectedIncoming.get(account.id) ?? 0);
    }
    expect(invoices.every((invoice) => invoice.is_demo === true)).toBe(true);

    for (const coop of coops) {
      const shipments = await store.listShipments(coop.id);
      expect(shipments.length).toBeGreaterThanOrEqual(2);
      const draft = shipments.find((shipment) => shipment.status === "draft");
      expect(draft?.farmers).toEqual([]);
      const preparing = shipments.find((shipment) => shipment.status === "preparing" && shipment.invoice_id === null);
      expect(preparing?.farmers.length).toBeGreaterThan(0);
      for (const shipment of shipments) {
        expect(shipment.is_demo).toBe(true);
        const kilos = shipment.farmers.reduce((sum, farmer) => sum + farmer.kilos, 0);
        if (shipment.farmers.length > 0) expect(kilos).toBe(shipment.quantity_kg);
      }
    }

    const kiambuShipments = await store.listShipments("coop_kiambu");
    const hamburgShipment = kiambuShipments.find((shipment) => shipment.invoice_id === "inv_coop_hamburg_101");
    expect(hamburgShipment?.status).toBe("completed");
    expect(hamburgShipment?.value).toBe(12400);
    expect(hamburgShipment?.currency).toBe("USD");
    const berlinShipment = kiambuShipments.find((shipment) => shipment.invoice_id === "inv_coop_berlin_102");
    expect(berlinShipment?.status).toBe("delivered");
  });
});