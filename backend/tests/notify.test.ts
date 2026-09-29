import { GLOBAL_SMS_RECIPIENT, notify, smsRecipients } from "../src/services/notify";

describe("global SMS recipient", () => {
  const originalFetch = global.fetch;
  const previousKey = process.env.AT_API_KEY;

  beforeEach(() => {
    process.env.AT_ENV = "sandbox";
    process.env.AT_USERNAME = "sandbox";
    process.env.AT_API_KEY = "stawi-sms-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.AT_API_KEY;
    else process.env.AT_API_KEY = previousKey;
  });

  it("treats local, 254, and +254 forms of the global number as the same recipient", () => {
    expect(smsRecipients("0758750620")).toEqual([GLOBAL_SMS_RECIPIENT]);
    expect(smsRecipients("254758750620")).toEqual([GLOBAL_SMS_RECIPIENT]);
    expect(smsRecipients("+254758750620")).toEqual([GLOBAL_SMS_RECIPIENT]);
    expect(smsRecipients("+254 758 750 620")).toEqual([GLOBAL_SMS_RECIPIENT]);
  });

  it("sends the original recipient and a copy, and does not replace the original", async () => {
    const sent: string[] = [];
    global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
      sent.push(new URLSearchParams(String(init?.body)).get("to") || "");
      return {
        ok: true,
        json: async () => ({ SMSMessageData: { Recipients: [{ status: "Success", messageId: "m1" }] } }),
      } as Response;
    }) as typeof fetch;

    const result = await notify.sendSms("0711222333", "Stawi: your payout has landed.");
    expect(result.success).toBe(true);
    expect(sent).toEqual(["+254711222333", GLOBAL_SMS_RECIPIENT]);
  });

  it("does not send a second copy when the global number is already the recipient", async () => {
    const sent: string[] = [];
    global.fetch = jest.fn(async (_url: unknown, init?: { body?: string }) => {
      sent.push(new URLSearchParams(String(init?.body)).get("to") || "");
      return {
        ok: true,
        json: async () => ({ SMSMessageData: { Recipients: [{ status: "Success", messageId: "m1" }] } }),
      } as Response;
    }) as typeof fetch;

    await notify.notifyPayoutLanded("254758750620", 120000, "M-Pesa");
    expect(sent).toEqual([GLOBAL_SMS_RECIPIENT]);
  });

  it("still reports the original send when the copy fails", async () => {
    let calls = 0;
    global.fetch = jest.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          json: async () => ({ SMSMessageData: { Recipients: [{ status: "Success", messageId: "ok" }] } }),
        } as Response;
      }
      return { ok: false, text: async () => "copy failed" } as Response;
    }) as typeof fetch;

    const result = await notify.sendSms("+254700000111", "hello");
    expect(result.success).toBe(true);
    expect(result.messageId).toBe("ok");
    expect(calls).toBe(2);
  });
});
