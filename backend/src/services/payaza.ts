import crypto from "crypto";
import { Invoice } from "../types";

export type PayazaMode = "mock" | "sandbox" | "live";

export interface CheckoutSessionResult {
  reference: string;
  checkoutUrl: string | null;
  public_key: string;
  transaction_reference: string;
  link_id: string | null;
  /** Payaza Web SDK connection_mode. Sandbox and mock use Test. */
  connection_mode: "Test" | "Live";
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
  error?: string;
}

export type PayazaWebhookKind =
  | "collection_success"
  | "collection_failed"
  | "underpayment"
  | "payout_success"
  | "payout_failed"
  | "ignored";

export interface PayazaWebhookDecision {
  kind: PayazaWebhookKind;
  reference: string;
  merchantReference: string | null;
  invoiceId: string | null;
  amountReceived?: number;
  currency?: string;
}

/**
 * M-Pesa numbers for Payaza are 12 digits, country code + number, no "+".
 */
export function toMpesaAccountNumber(details: string): string {
  let digits = details.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `254${digits.slice(1)}`;
  else if (!digits.startsWith("254") && digits.length === 9) digits = `254${digits}`;
  return digits;
}

export function sanitizeNarration(text: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, 25);
  return cleaned || "Stawi payout";
}

export function ensureTransactionReference(reference: string): string {
  const cleaned = reference.replace(/[^A-Za-z0-9-]/g, "");
  if (cleaned.length >= 10) return cleaned.slice(0, 64);
  return `STAWI${cleaned}`.padEnd(10, "0").slice(0, 64);
}

/**
 * Classify a Payaza webhook. Collection success is Funds Received / Completed
 * with an exact (or unspecified) amount. Underpayment is never treated as paid.
 * Payout results are NIP_SUCCESS / NIP_FAILURE.
 */
export function classifyPayazaWebhook(payload: Record<string, unknown>): PayazaWebhookDecision {
  const transactionReference = String(payload.transaction_reference || "");
  const merchantReference = payload.merchant_reference ? String(payload.merchant_reference) : null;
  const reference = transactionReference || merchantReference || "";
  const details = payload.additional_details as { invoice_id?: string } | undefined;
  const invoiceId = details?.invoice_id ? String(details.invoice_id) : null;
  const status = String(payload.status || "");
  const transactionStatus = String(payload.transaction_status || "");
  const amountValidation = String(payload.amount_validation || "");
  const amountReceived = payload.amount_received !== undefined ? Number(payload.amount_received) : undefined;
  const currency = payload.currency_code ? String(payload.currency_code) : undefined;

  const base = { reference, merchantReference, invoiceId, amountReceived, currency };

  const isPayout =
    transactionStatus.startsWith("NIP_") ||
    payload.is_reversed === true ||
    payload.sent_to !== undefined;

  if (isPayout) {
    if (payload.is_reversed === true || transactionStatus === "NIP_FAILURE") {
      return { ...base, kind: "payout_failed" };
    }
    if (transactionStatus === "NIP_SUCCESS") {
      return { ...base, kind: "payout_success" };
    }
    return { ...base, kind: "ignored" };
  }

  if (amountValidation === "UNDERPAYMENT") {
    return { ...base, kind: "underpayment" };
  }

  if (status === "Failed" || transactionStatus === "Transaction Failed") {
    return { ...base, kind: "collection_failed" };
  }

  if (status === "Completed" || transactionStatus === "Funds Received") {
    return { ...base, kind: "collection_success" };
  }

  return { ...base, kind: "ignored" };
}

export class PayazaService {
  private baseUrl = "https://api.payaza.africa/live";
  private kesAccountRefCache: string | null = null;

  public getMode(): PayazaMode {
    const mode = process.env.PAYAZA_MODE;
    if (mode === "sandbox" || mode === "live" || mode === "mock") return mode;
    return "mock";
  }

  public getPublicKey(): string {
    return process.env.PAYAZA_PUBLIC_KEY || "PZ78-PKTEST-mock-key";
  }

  public getSecretKey(): string {
    return process.env.PAYAZA_SECRET_KEY || "";
  }

  private getAuthHeaders(extra: Record<string, string> = {}): Record<string, string> {
    const b64Key = Buffer.from(this.getPublicKey()).toString("base64");
    const tenant = process.env.PAYAZA_TENANT || (this.getMode() === "live" ? "live" : "test");
    return {
      Authorization: `Payaza ${b64Key}`,
      "X-TenantID": tenant,
      "Content-Type": "application/json",
      ...extra,
    };
  }

  /**
   * HMAC-SHA512 of the raw body with the secret key, Base64, compared in constant time.
   * Mock mode accepts unsigned dev webhooks. Sandbox and live fail closed.
   */
  public verifyWebhookSignature(rawBody: string | Buffer, sigHeader?: string): boolean {
    if (this.getMode() === "mock" && !sigHeader) return true;

    const secret = this.getSecretKey();
    if (!sigHeader || !secret) return false;

    try {
      const computed = crypto.createHmac("sha512", secret).update(rawBody).digest("base64");
      const sigBuf = Buffer.from(sigHeader);
      const computedBuf = Buffer.from(computed);
      if (sigBuf.length !== computedBuf.length) return false;
      return crypto.timingSafeEqual(sigBuf, computedBuf);
    } catch {
      return false;
    }
  }

  public signBody(rawBody: string): string {
    return crypto.createHmac("sha512", this.getSecretKey()).update(rawBody, "utf8").digest("base64");
  }

  /**
   * KES payazaAccountReference. Env override wins; otherwise enquiry of main accounts.
   * There is no documented FX endpoint, so this only locates the KES payout account.
   */
  public async resolveKesAccountReference(): Promise<string> {
    const fromEnv = process.env.PAYAZA_KES_ACCOUNT_REF;
    if (fromEnv) return fromEnv;
    if (this.getMode() === "mock") return "KES-MOCK-ACCOUNT";
    if (this.kesAccountRefCache) return this.kesAccountRefCache;

    const response = await fetch(
      `${this.baseUrl}/payaza-account/api/v1/mainaccounts/merchant/enquiry/main`,
      { headers: this.getAuthHeaders() }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Payaza KES account enquiry failed (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as unknown;
    const list = Array.isArray(data)
      ? data
      : ((data as { data?: unknown }).data ?? (data as { response_content?: unknown }).response_content ?? []);
    const accounts = Array.isArray(list) ? list : [];
    const kes = accounts.find((entry) => {
      const row = entry as { currency?: string; postNoDebit?: boolean; payazaAccountReference?: string };
      return String(row.currency || "").toUpperCase() === "KES" && row.postNoDebit !== true && row.payazaAccountReference;
    }) as { payazaAccountReference?: string } | undefined;

    if (!kes?.payazaAccountReference) {
      throw new Error("No fundable KES Payaza account. Set PAYAZA_KES_ACCOUNT_REF or fund the KES account.");
    }
    this.kesAccountRefCache = kes.payazaAccountReference;
    return this.kesAccountRefCache;
  }

  /**
   * Creates a payment link for an invoice (one link per attempt name).
   * The webhook, not this response, is what marks the invoice paid.
   */
  public async createCheckoutSession(invoice: Invoice, attempt: number = 1): Promise<CheckoutSessionResult> {
    const transactionReference = ensureTransactionReference(
      `STAWI-${invoice.id}-${Date.now().toString(36)}-${attempt}`
    );
    const mode = this.getMode();
    const connection_mode: "Test" | "Live" = mode === "live" ? "Live" : "Test";

    if (mode === "mock") {
      return {
        reference: transactionReference,
        checkoutUrl: `http://localhost:5173/pay/${invoice.id}?ref=${transactionReference}`,
        public_key: this.getPublicKey(),
        transaction_reference: transactionReference,
        link_id: null,
        connection_mode,
      };
    }

    const slugBase = (invoice.reference || invoice.id).replace(/[^A-Za-z0-9]/g, "").slice(0, 32);
    const paymentLinkName = attempt > 1 ? `STAWI-${slugBase}-${attempt}` : `STAWI-${slugBase}`;

    try {
      const response = await fetch(`${this.baseUrl}/payment-link/merchant/create-payment-link`, {
        method: "POST",
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          payment_link_name: paymentLinkName,
          payment_description: (invoice.description || `Stawi invoice ${invoice.reference}`).slice(0, 200),
          has_fixed_amount: true,
          payment_amount: invoice.amount,
          country_code: "KEN",
          currency_code: invoice.currency,
          collect_customer_first_and_last_name: true,
          collect_customer_email: true,
          collect_customer_phone_number: true,
          redirect_url: process.env.PAYAZA_REDIRECT_URL || "https://stawi.africa/paid",
          fee_bearer_type: "Business",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Payaza API Error] Create payment link failed:", errorText);
        return {
          reference: transactionReference,
          checkoutUrl: null,
          public_key: this.getPublicKey(),
          transaction_reference: transactionReference,
          link_id: null,
          connection_mode,
        };
      }

      const data = (await response.json()) as { data?: { link?: string; id?: string } };
      return {
        reference: transactionReference,
        checkoutUrl: data.data?.link || null,
        public_key: this.getPublicKey(),
        transaction_reference: transactionReference,
        link_id: data.data?.id ? String(data.data.id) : null,
        connection_mode,
      };
    } catch (err) {
      console.warn("[Payaza] Payment link call failed, falling back to SDK checkout ref:", err);
      return {
        reference: transactionReference,
        checkoutUrl: null,
        public_key: this.getPublicKey(),
        transaction_reference: transactionReference,
        link_id: null,
        connection_mode,
      };
    }
  }

  /**
   * POST /payout-receptor/payout. One call, many beneficiaries (Co-op option A)
   * or a single beneficiary (withdrawal). Signs the exact JSON body when
   * PAYAZA_SIGN_TRANSFERS=true.
   */
  public async initiatePayout(request: PayoutRequest): Promise<PayoutResponse> {
    const payazaReference = ensureTransactionReference(
      `PZPAYOUT-${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).substring(2, 6).toUpperCase()}`
    );
    const mode = this.getMode();

    if (mode === "mock") {
      return {
        success: true,
        payaza_reference: payazaReference,
        batch_reference: `BATCH-${Date.now()}`,
        status: "initiated",
      };
    }

    const transactionType = request.transaction_type || "mobile_money";
    for (const beneficiary of request.beneficiaries) {
      if (!beneficiary.bank_code) {
        return {
          success: false,
          payaza_reference: payazaReference,
          status: "failed",
          error: "Bank code is required for a Payaza payout",
        };
      }
    }

    try {
      const accountReference = await this.resolveKesAccountReference();
      const pin = parseInt(process.env.PAYAZA_PIN || "", 10);
      if (!Number.isInteger(pin)) {
        return {
          success: false,
          payaza_reference: payazaReference,
          status: "failed",
          error: "PAYAZA_PIN is not set",
        };
      }

      const payload = {
        transaction_type: transactionType,
        service_payload: {
          payout_amount: request.payout_amount,
          transaction_pin: pin,
          account_reference: accountReference,
          currency: request.currency || "KES",
          country: "KEN",
          payout_beneficiaries: request.beneficiaries.map((b) => ({
            credit_amount: b.credit_amount,
            account_number:
              transactionType === "mobile_money" ? toMpesaAccountNumber(b.account_number) : b.account_number.replace(/\D/g, ""),
            account_name: b.account_name,
            bank_code: b.bank_code,
            narration: sanitizeNarration(b.narration),
            transaction_reference: ensureTransactionReference(b.transaction_reference),
            sender: b.sender || {
              sender_name: "Stawi Africa",
              sender_phone_number: "254700000000",
              sender_address: "Nairobi Kenya",
              sender_id: "",
            },
          })),
        },
      };

      const rawBody = JSON.stringify(payload);
      const headers = this.getAuthHeaders();
      if (process.env.PAYAZA_SIGN_TRANSFERS === "true") {
        if (!this.getSecretKey()) {
          return {
            success: false,
            payaza_reference: payazaReference,
            status: "failed",
            error: "PAYAZA_SIGN_TRANSFERS requires PAYAZA_SECRET_KEY",
          };
        }
        headers["X-Payaza-Signature"] = this.signBody(rawBody);
      }

      const response = await fetch(`${this.baseUrl}/payout-receptor/payout`, {
        method: "POST",
        headers,
        body: rawBody,
      });

      const responseData = await response.json().catch(() => ({}));
      if (!response.ok) {
        console.error("[Payaza API Error] Payout failed:", responseData);
        return {
          success: false,
          payaza_reference: payazaReference,
          status: "failed",
          raw_response: responseData,
          error: "Payaza payout was rejected",
        };
      }

      const content = (responseData as { response_content?: { batch_reference?: string } }).response_content;
      return {
        success: true,
        payaza_reference: payazaReference,
        batch_reference: content?.batch_reference,
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
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  public async checkTransactionStatus(transactionReference: string): Promise<string> {
    if (this.getMode() === "mock") return "NIP_SUCCESS";

    try {
      const response = await fetch(
        `${this.baseUrl}/payaza-account/api/v1/mainaccounts/transaction/status?transaction_reference=${encodeURIComponent(transactionReference)}`,
        { headers: this.getAuthHeaders() }
      );
      if (!response.ok) return "PENDING";
      const data = (await response.json()) as { transaction_status?: string };
      return data.transaction_status || "PENDING";
    } catch {
      return "PENDING";
    }
  }
}

export const payaza = new PayazaService();
