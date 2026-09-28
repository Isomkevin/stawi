import crypto from "crypto";
import { Invoice } from "../types";

export type PayazaMode = "mock" | "sandbox" | "live";

export interface CheckoutSessionResult {
  reference: string;
  checkoutUrl: string | null;
  public_key: string;
  transaction_reference: string;
}

export interface PayoutBeneficiary {
  credit_amount: number;
  account_number: string;
  account_name: string;
  bank_code: string;
  narration: string;
  transaction_reference: string;
  sender?: {
    sender_name: string;
    sender_phone_number: string;
    sender_address: string;
    sender_id: string;
  };
}

export interface PayoutRequest {
  payout_amount: number;
  currency: string;
  beneficiaries: PayoutBeneficiary[];
  transaction_type?: "mobile_money" | "kepss";
}

export interface PayoutResponse {
  success: boolean;
  payaza_reference: string;
  batch_reference?: string;
  status: "initiated" | "completed" | "failed";
  raw_response?: unknown;
}

export class PayazaService {
  private mode: PayazaMode;
  private publicKey: string;
  private secretKey: string;
  private transactionPin: string;
  private tenantId: string;
  private baseUrl: string = "https://api.payaza.africa/live";

  constructor() {
    this.mode = (process.env.PAYAZA_MODE as PayazaMode) || "mock";
    this.publicKey = process.env.PAYAZA_PUBLIC_KEY || "PZ78-PKTEST-mock-key";
    this.secretKey = process.env.PAYAZA_SECRET_KEY || "PZ78-SKTEST-mock-secret";
    this.transactionPin = process.env.PAYAZA_PIN || "123456";
    this.tenantId = process.env.PAYAZA_TENANT || (this.mode === "live" ? "live" : "test");
  }

  public getMode(): PayazaMode {
    return (process.env.PAYAZA_MODE as PayazaMode) || this.mode;
  }

  public getPublicKey(): string {
    return process.env.PAYAZA_PUBLIC_KEY || this.publicKey;
  }

  public getSecretKey(): string {
    return process.env.PAYAZA_SECRET_KEY || this.secretKey;
  }

  private getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const b64Key = Buffer.from(this.getPublicKey()).toString("base64");
    return {
      Authorization: `Payaza ${b64Key}`,
      "X-TenantID": process.env.PAYAZA_TENANT || this.tenantId,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  /**
   * Verifies an inbound webhook signature using HMAC-SHA512 with the secret key.
   * Compares timing-safely to prevent side-channel timing attacks.
   */
  public verifyWebhookSignature(rawBody: string | Buffer, sigHeader?: string): boolean {
    const mode = this.getMode();
    if (mode === "mock") {
      // In mock mode, if a signature header is passed, check it; otherwise permit simulated dev webhooks
      if (!sigHeader) return true;
    }

    const secret = this.getSecretKey();
    if (!sigHeader || !secret) {
      return false;
    }

    try {
      const computed = crypto
        .createHmac("sha512", secret)
        .update(rawBody)
        .digest("base64");

      const sigBuf = Buffer.from(sigHeader);
      const computedBuf = Buffer.from(computed);

      if (sigBuf.length !== computedBuf.length) {
        return false;
      }

      return crypto.timingSafeEqual(sigBuf, computedBuf);
    } catch {
      return false;
    }
  }

  /**
   * Creates a checkout session for an invoice.
   * Generates a unique transaction reference per payment attempt.
   */
  public async createCheckoutSession(
    invoice: Invoice,
    attempt: number = 1
  ): Promise<CheckoutSessionResult> {
    const transactionReference = `STAWI-${invoice.id.toUpperCase()}-${Date.now().toString(36)}-${attempt}`;

    if (this.mode === "mock") {
      return {
        reference: transactionReference,
        checkoutUrl: `http://localhost:5173/pay/${invoice.id}?ref=${transactionReference}`,
        public_key: this.publicKey,
        transaction_reference: transactionReference,
      };
    }

    // TODO(payaza): In sandbox/live, call POST /payment-link/merchant/create-payment-link
    // or return configuration for client-side Payaza Web SDK
    try {
      const response = await fetch(`${this.baseUrl}/payment-link/merchant/create-payment-link`, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          payment_link_name: `STAWI-${invoice.id}`,
          payment_description: invoice.description || `Stawi Invoice ${invoice.reference}`,
          has_fixed_amount: true,
          payment_amount: invoice.amount,
          country_code: "KEN",
          currency_code: invoice.currency,
          collect_customer_first_and_last_name: true,
          collect_customer_email: true,
          collect_customer_phone_number: true,
          redirect_url: `https://stawi.africa/pay/${invoice.id}/confirmed`,
          fee_bearer_type: "Business",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Payaza API Error] Create payment link failed:", errorText);
        // Fallback to client-side SDK reference
        return {
          reference: transactionReference,
          checkoutUrl: null,
          public_key: this.publicKey,
          transaction_reference: transactionReference,
        };
      }

      const data = (await response.json()) as { data?: { link?: string; id?: string } };
      return {
        reference: transactionReference,
        checkoutUrl: data.data?.link || null,
        public_key: this.publicKey,
        transaction_reference: transactionReference,
      };
    } catch (err) {
      console.warn("[Payaza] Live call failed, falling back to SDK checkout ref:", err);
      return {
        reference: transactionReference,
        checkoutUrl: null,
        public_key: this.publicKey,
        transaction_reference: transactionReference,
      };
    }
  }

  /**
   * Initiates settlement / payout to M-Pesa or Bank account(s).
   * Supports single or bulk beneficiaries via POST /payout-receptor/payout.
   */
  public async initiatePayout(request: PayoutRequest): Promise<PayoutResponse> {
    const payazaReference = `PZ-PAYOUT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;

    if (this.mode === "mock") {
      return {
        success: true,
        payaza_reference: payazaReference,
        batch_reference: `BATCH-${Date.now()}`,
        status: "initiated",
      };
    }

    // Live / Sandbox Payaza transfers call
    try {
      const payload = {
        transaction_type: request.transaction_type || "mobile_money",
        service_payload: {
          payout_amount: request.payout_amount,
          transaction_pin: parseInt(this.transactionPin, 10),
          account_reference: process.env.PAYAZA_KES_ACCOUNT_REF || "KES-MAIN-ACCOUNT",
          currency: request.currency || "KES",
          country: "KEN",
          payout_beneficiaries: request.beneficiaries.map((b) => ({
            credit_amount: b.credit_amount,
            account_number: b.account_number.replace(/^\+/, ""), // Remove leading plus if present
            account_name: b.account_name,
            bank_code: b.bank_code,
            narration: b.narration.substring(0, 25),
            transaction_reference: b.transaction_reference,
            sender: b.sender || {
              sender_name: "Stawi Africa",
              sender_phone_number: "254700000000",
              sender_address: "Nairobi, Kenya",
              sender_id: "",
            },
          })),
        },
      };

      const response = await fetch(`${this.baseUrl}/payout-receptor/payout`, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify(payload),
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error("[Payaza API Error] Payout failed:", responseData);
        return {
          success: false,
          payaza_reference: payazaReference,
          status: "failed",
          raw_response: responseData,
        };
      }

      return {
        success: true,
        payaza_reference: payazaReference,
        batch_reference: (responseData as any)?.response_content?.batch_reference,
        status: "initiated",
        raw_response: responseData,
      };
    } catch (err) {
      console.error("[Payaza] Payout network error:", err);
      return {
        success: false,
        payaza_reference: payazaReference,
        status: "failed",
        raw_response: String(err),
      };
    }
  }

  /**
   * Checks status of a payout transaction.
   */
  public async checkTransactionStatus(transactionReference: string): Promise<string> {
    if (this.mode === "mock") {
      return "NIP_SUCCESS";
    }

    try {
      const response = await fetch(
        `${this.baseUrl}/payaza-account/api/v1/mainaccounts/transaction/status?transaction_reference=${encodeURIComponent(transactionReference)}`,
        {
          headers: this.getAuthHeaders(),
        }
      );
      if (!response.ok) return "PENDING";
      const data = await response.json();
      return (data as any)?.transaction_status || "PENDING";
    } catch {
      return "PENDING";
    }
  }
}

export const payaza = new PayazaService();
