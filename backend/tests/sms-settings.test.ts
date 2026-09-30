import request from "supertest";
import { createApp } from "../src/app";
import { notify } from "../src/services/notify";
import { store } from "../src/store";
import { Account, CoopSmsSettings, SMS_TOGGLE_KEYS } from "../src/types";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc_amina",
    full_name: "Amina Wanjiku",
    phone_number: "+254711222333",
    id_number: "ID9",
    payout_destinations: [],
    coop_id: "coop_test",
    channel_capability: "webapp",
    balance_kes_cents: 0,
    incoming_kes_cents: 0,
    ...overrides,
  };
}

const ALL_ON: CoopSmsSettings = {
  invite: true,
  invite_summary: true,
  share_landed: true,
  payout_sent: true,
  payout_failed: true,
};

describe("Co-op SMS settings and usage log", () => {
  const app = createApp();
  const previousAuth = process.env.AUTH_REQUIRED;

  beforeEach(async () => {
    await store.reset();
    process.env.AUTH_REQUIRED = "false";
    delete process.env.AT_API_KEY;
    await store.saveAccount(account());
    await store.saveCoop({ id: "coop_test", name: "Kiambu Highlands Coffee Co-op", treasurer_account_id: "acc_treasurer" });
  });

  afterEach(() => {
    if (previousAuth === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previousAuth;
  });

  it("starts with every switch on and keeps login codes out of the switches", async () => {
    const res = await request(app).get("/coops/coop_test/sms-settings");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(ALL_ON);
    expect(res.body.otp).toBeUndefined();

    const coop = await request(app).get("/coops/coop_test");
    expect(coop.body.sms_settings).toEqual(ALL_ON);
  });

  it("turns one purpose off without turning the others off", async () => {
    const res = await request(app).patch("/coops/coop_test/sms-settings").send({ payout_failed: false });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ...ALL_ON, payout_failed: false });
  });

  it("rejects a switch that is not true or false", async () => {
    const res = await request(app).patch("/coops/coop_test/sms-settings").send({ invite: "no" });
    expect(res.status).toBe(400);
  });

  it("skips a turned-off invite, still sends the login code, and logs both without the code", async () => {
    await request(app).patch("/coops/coop_test/sms-settings").send({ invite: false });

    const invite = await request(app)
      .post("/coops/coop_test/invites/sms")
      .send({
        recipients: [
          {
            phone_number: "+254711222333",
            full_name: "Amina Wanjiku",
            link: "https://stawi.test/onboarding?phone=%2B254711222333",
          },
        ],
      });
    expect(invite.status).toBe(200);
    expect(invite.body.sent).toBe(0);
    expect(invite.body.results[0].error).toMatch(/turned off/i);

    const otp = await request(app).post("/auth/otp").send({ phone_number: "+254711222333" });
    expect([200, 502]).toContain(otp.status);

    const logs = await request(app).get("/coops/coop_test/sms-logs");
    expect(logs.status).toBe(200);
    const inviteRow = logs.body.find((row: { purpose: string }) => row.purpose === "invite");
    const summaryRow = logs.body.find((row: { purpose: string }) => row.purpose === "invite_summary");
    const otpRow = logs.body.find((row: { purpose: string }) => row.purpose === "otp");
    expect(inviteRow).toMatchObject({ status: "skipped", phone_number: "+254711222333" });
    expect(summaryRow.status).toBe("sent");
    expect(otpRow.status).toBe("sent");
    expect(otpRow.message).toMatch(/login code: \*+/);
    expect(otpRow.message).not.toMatch(/\d{6}/);
  });

  it("skips each co-op purpose on its own switch and still sends a login code when all are off", async () => {
    const off = Object.fromEntries(SMS_TOGGLE_KEYS.map((key) => [key, false])) as CoopSmsSettings;
    await store.saveCoop({
      id: "coop_test",
      name: "Kiambu Highlands Coffee Co-op",
      treasurer_account_id: "acc_treasurer",
      sms_settings: off,
    });

    for (const purpose of SMS_TOGGLE_KEYS) {
      const result = await notify.sendSms("+254711222333", `purpose ${purpose}`, {
        copy: false,
        purpose,
        coopId: "coop_test",
      });
      expect(result.skipped).toBe(true);
    }

    const otp = await notify.sendSms("+254711222333", "Stawi login code: 482915. It expires in 5 minutes.", {
      copy: false,
      purpose: "otp",
      coopId: "coop_test",
    });
    expect(otp.success).toBe(true);
    expect(otp.skipped).toBeUndefined();

    const logs = await store.listSmsLogs("coop_test", 20);
    expect(logs.filter((row) => row.status === "skipped").map((row) => row.purpose).sort()).toEqual([...SMS_TOGGLE_KEYS].sort());
    const otpRow = logs.find((row) => row.purpose === "otp");
    expect(otpRow?.message).toBe("Stawi login code: ******. It expires in 5 minutes.");
  });

  it("turns off the exporter payment text without blocking the login code", async () => {
    const off = await request(app).patch("/accounts/acc_amina/sms-settings").send({ payment_received: false });
    expect(off.status).toBe(200);
    expect(off.body).toEqual({ payment_received: false });

    const skipped = await notify.sendSms("+254711222333", "buyer paid", {
      copy: false,
      purpose: "payment_received",
      accountId: "acc_amina",
    });
    expect(skipped.skipped).toBe(true);

    const otp = await notify.sendSms("+254711222333", "Stawi login code: 111222. It expires in 5 minutes.", {
      copy: false,
      purpose: "otp",
      accountId: "acc_amina",
    });
    expect(otp.success).toBe(true);

    const logs = await request(app).get("/accounts/acc_amina/sms-logs");
    expect(logs.status).toBe(200);
    expect(logs.body.find((row: { purpose: string }) => row.purpose === "payment_received")).toMatchObject({
      status: "skipped",
      account_id: "acc_amina",
    });
    const otpRow = logs.body.find((row: { purpose: string }) => row.purpose === "otp");
    expect(otpRow.message).toBe("Stawi login code: ******. It expires in 5 minutes.");
  });
});
