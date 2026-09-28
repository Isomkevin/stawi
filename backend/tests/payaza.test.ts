import crypto from "crypto";
import {
  classifyPayazaWebhook,
  ensureTransactionReference,
  payaza,
  sanitizeNarration,
  toMpesaAccountNumber,
} from "../src/services/payaza";

describe("Payaza skill helpers", () => {
  it("normalizes M-Pesa numbers to 254 without a plus", () => {
    expect(toMpesaAccountNumber("+254712345678")).toBe("254712345678");
    expect(toMpesaAccountNumber("0712345678")).toBe("254712345678");
    expect(toMpesaAccountNumber("712345678")).toBe("254712345678");
  });

  it("keeps narration free of special characters and within 25 chars", () => {
    expect(sanitizeNarration("Stawi payout!")).toBe("Stawi payout");
    expect(sanitizeNarration("x".repeat(40)).length).toBe(25);
  });

  it("pads short transaction references to the 10 character minimum", () => {
    expect(ensureTransactionReference("abc").length).toBeGreaterThanOrEqual(10);
  });

  it("verifies HMAC-SHA512 webhook signatures and rejects mismatches", () => {
    process.env.PAYAZA_MODE = "live";
    process.env.PAYAZA_SECRET_KEY = "secret-key";
    const body = JSON.stringify({ status: "Completed" });
    const sig = crypto.createHmac("sha512", "secret-key").update(body).digest("base64");
    expect(payaza.verifyWebhookSignature(body, sig)).toBe(true);
    expect(payaza.verifyWebhookSignature(body, "nope")).toBe(false);
    expect(payaza.verifyWebhookSignature(body, undefined)).toBe(false);
    process.env.PAYAZA_MODE = "mock";
  });

  it("classifies collection, underpayment, and payout webhooks", () => {
    expect(
      classifyPayazaWebhook({ status: "Completed", transaction_reference: "T1", merchant_reference: "M1" }).kind
    ).toBe("collection_success");
    expect(
      classifyPayazaWebhook({ amount_validation: "UNDERPAYMENT", transaction_reference: "T2" }).kind
    ).toBe("underpayment");
    expect(
      classifyPayazaWebhook({ transaction_status: "NIP_SUCCESS", transaction_reference: "P1" }).kind
    ).toBe("payout_success");
    expect(
      classifyPayazaWebhook({ transaction_status: "NIP_FAILURE", transaction_reference: "P2" }).kind
    ).toBe("payout_failed");
    expect(classifyPayazaWebhook({ status: "Initialized", transaction_reference: "T3" }).kind).toBe("ignored");
  });

  it("signs the exact payout body with HMAC-SHA512", () => {
    process.env.PAYAZA_SECRET_KEY = "secret-key";
    const raw = JSON.stringify({ payout_amount: 100 });
    const sig = payaza.signBody(raw);
    const expected = crypto.createHmac("sha512", "secret-key").update(raw, "utf8").digest("base64");
    expect(sig).toBe(expected);
  });
});
