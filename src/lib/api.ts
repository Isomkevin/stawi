import { mockApi } from "./mock";
import { shipmentsApi, type NewShipmentInput, type Shipment } from "./shipments";
import {
  ApiError,
  type Account,
  type Balance,
  type CheckoutSession,
  type Coop,
  type CoopMember,
  type CoopSmsSettings,
  type ExporterSmsSettings,
  type SmsLogEntry,
  type CoopMetrics,
  type CreateAccountBody,
  type DemoDataSettings,
  type CreateInvoiceBody,
  type UpdateInvoiceBody,
  type Invoice,
  type InvoiceDetail,
  type PaymentReceipt,
  type NewDestinationBody,
  type PaymentProof,
  type FarmerShareConfirmation,
  type Payout,
  type PayoutDestination,
  type WithdrawBody,
} from "./types";

export const API_MODE = (import.meta.env["VITE_API_MODE"] as "mock" | "live") ?? "mock";
export const API_BASE_URL = (import.meta.env["VITE_API_BASE_URL"] as string) ?? "";
export const isMock = API_MODE !== "live";

let sessionToken: string | null = null; // live mode also gets an httpOnly cookie from the server
export function setSessionToken(token: string | null) {
  sessionToken = token;
}

export type PhoneLookup = {
  phone_number: string;
  account_id: string | null;
  full_name: string | null;
  already_member: boolean;
  other_coop: boolean;
};

export const INVITE_SMS_CHUNK = 100;

export type RosterImportStatus = "add" | "update" | "invite" | "other_coop";

export type RosterColumnMap = { name: number; phone: number; share?: number; kilos?: number };

export type RosterImportRow = {
  line: number;
  name: string;
  phone: string;
  share: number;
  kilos?: number;
  error?: string;
  status?: RosterImportStatus;
  account_id?: string | null;
  full_name?: string | null;
};

export type RosterPreview = {
  needs_mapping: boolean;
  headers: string[];
  delimiter: "," | ";" | "\t";
  rows: RosterImportRow[];
  total_share: number;
};

export type RosterApplyResult = {
  added: string[];
  updated: string[];
  invites: Array<{ name: string; phone: string; share: number; url: string }>;
  failed: Array<{ name: string; reason: string }>;
};

export type InviteSmsProgress = { done: number; total: number; sent: number; failed: number };

export type FxQuote = {
  source: "frankfurter" | "fallback";
  as_of: string | null;
  rates: Record<string, number>;
};

export type AppRole = "farmer" | "exporter" | "treasurer";

export type VerifyResult = {
  token: string;
  account_id: string;
  role: AppRole;
  roles: AppRole[];
  account_types: Array<"farmer" | "exporter" | "coop">;
  account: Account;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      attemptsLeft?: number;
    };
    throw new ApiError(response.status, body.error ?? "Request failed", body.attemptsLeft);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  // POST /accounts
  createAccount: (body: CreateAccountBody): Promise<Account & { token?: string; role?: AppRole; roles?: AppRole[]; account_types?: Array<"farmer" | "exporter" | "coop"> }> =>
    isMock ? mockApi.createAccount(body) : request("/accounts", { method: "POST", body: JSON.stringify(body) }),

  // GET /accounts/{id}
  getAccount: (accountId: string): Promise<Account> =>
    isMock ? mockApi.getAccount(accountId) : request(`/accounts/${accountId}`),

  // GET /accounts/{id}/balance
  getBalance: (accountId: string): Promise<Balance> =>
    isMock ? mockApi.getBalance(accountId) : request(`/accounts/${accountId}/balance`),

  // GET /accounts/{id}/settings
  getDemoSettings: (accountId: string): Promise<DemoDataSettings> =>
    isMock ? mockApi.getDemoSettings(accountId) : request(`/accounts/${accountId}/settings`),

  // PATCH /accounts/{id}/settings — does not change Payaza mode or relabel new invoices
  updateDemoSettings: (accountId: string, demo_data_enabled: boolean | null): Promise<DemoDataSettings> =>
    isMock
      ? mockApi.updateDemoSettings(accountId, demo_data_enabled)
      : request(`/accounts/${accountId}/settings`, {
          method: "PATCH",
          body: JSON.stringify({ demo_data_enabled }),
        }),

  // GET /accounts/{id}/transactions?limit
  getAccountTransactions: (accountId: string, limit = 50): Promise<Payout[]> =>
    isMock
      ? mockApi.getAccountTransactions(accountId, limit)
      : request(`/accounts/${accountId}/transactions?limit=${limit}`),

  // POST /accounts/{id}/withdraw
  withdraw: (accountId: string, body: WithdrawBody): Promise<Payout> =>
    isMock
      ? mockApi.withdraw(accountId, body)
      : request(`/accounts/${accountId}/withdraw`, { method: "POST", body: JSON.stringify(body) }),

  // GET /coops/{id}
  getCoop: (coopId: string): Promise<Coop> =>
    isMock ? mockApi.getCoop(coopId) : request(`/coops/${coopId}`),

  updateSmsSettings: (coopId: string, patch: Partial<CoopSmsSettings>): Promise<CoopSmsSettings> =>
    isMock
      ? mockApi.updateSmsSettings(coopId, patch)
      : request(`/coops/${coopId}/sms-settings`, { method: "PATCH", body: JSON.stringify(patch) }),

  listSmsLogs: (coopId: string): Promise<SmsLogEntry[]> =>
    isMock ? mockApi.listSmsLogs(coopId) : request(`/coops/${coopId}/sms-logs?limit=50`),

  updateExporterSmsSettings: (accountId: string, patch: Partial<ExporterSmsSettings>): Promise<ExporterSmsSettings> =>
    isMock
      ? mockApi.updateExporterSmsSettings(accountId, patch)
      : request(`/accounts/${accountId}/sms-settings`, { method: "PATCH", body: JSON.stringify(patch) }),

  listAccountSmsLogs: (accountId: string): Promise<SmsLogEntry[]> =>
    isMock ? mockApi.listAccountSmsLogs(accountId) : request(`/accounts/${accountId}/sms-logs?limit=50`),

  // GET /coops/{id}/members
  getCoopMembers: (coopId: string): Promise<CoopMember[]> =>
    isMock ? mockApi.getCoopMembers(coopId) : request(`/coops/${coopId}/members`),

  // POST /coops/{id}/members
  addCoopMember: (coopId: string, member: Omit<CoopMember, "coop_id">): Promise<CoopMember> =>
    isMock
      ? mockApi.addCoopMember(coopId, member)
      : request(`/coops/${coopId}/members`, { method: "POST", body: JSON.stringify(member) }),

  // GET /coops/{id}/metrics
  getCoopMetrics: (coopId: string): Promise<CoopMetrics> =>
    isMock ? mockApi.getCoopMetrics(coopId) : request(`/coops/${coopId}/metrics`),

  // GET /invoices?coop_id=&account_id=
  listInvoices: (params: { coop_id?: string; account_id?: string }): Promise<Invoice[]> => {
    if (isMock) return mockApi.listInvoices(params);
    const query = new URLSearchParams(
      Object.entries(params).filter(([, v]) => Boolean(v)) as [string, string][],
    );
    return request(`/invoices?${query.toString()}`);
  },

  // POST /invoices
  createInvoice: (body: CreateInvoiceBody): Promise<Invoice> =>
    isMock ? mockApi.createInvoice(body) : request("/invoices", { method: "POST", body: JSON.stringify(body) }),

  // PATCH /invoices/{id} — unpaid invoices only
  updateInvoice: (invoiceId: string, body: UpdateInvoiceBody): Promise<Invoice> =>
    isMock
      ? mockApi.updateInvoice(invoiceId, body)
      : request(`/invoices/${invoiceId}`, { method: "PATCH", body: JSON.stringify(body) }),

  // GET /invoices/{id}
  getInvoice: (invoiceId: string): Promise<InvoiceDetail> =>
    isMock ? mockApi.getInvoice(invoiceId) : request(`/invoices/${invoiceId}`),

  // GET /invoices/{id}/receipt — only after the payment is recorded
  getPaymentReceipt: (invoiceId: string): Promise<PaymentReceipt> =>
    isMock ? mockApi.getPaymentReceipt(invoiceId) : request(`/invoices/${invoiceId}/receipt`),

  // GET /fx — live KES-per-unit quotes, or the illustrative table when the feed is down
  getFxQuote: (): Promise<FxQuote> => request("/fx"),

  // POST /invoices/{id}/checkout-session { currency_code? }
  createCheckoutSession: (invoiceId: string, currencyCode?: string): Promise<CheckoutSession> =>
    isMock
      ? mockApi.createCheckoutSession(invoiceId, currencyCode)
      : request(`/invoices/${invoiceId}/checkout-session`, {
          method: "POST",
          body: JSON.stringify(currencyCode ? { currency_code: currencyCode } : {}),
        }),

  // POST /invoices/{id}/approve-split → { success, invoice, payouts }
  approveSplit: (invoiceId: string, treasurerId: string, pin: string): Promise<Invoice> =>
    isMock
      ? mockApi.approveSplit(invoiceId, pin)
      : request<{ invoice: Invoice }>(`/invoices/${invoiceId}/approve-split`, {
          method: "POST",
          body: JSON.stringify({ treasurer_id: treasurerId, pin }),
        }).then((r) => r.invoice),

  // POST /dev/simulate-payment/{invoiceId} → { success, invoice, ... } (mock backend only)
  simulatePayment: (invoiceId: string): Promise<Invoice> =>
    isMock
      ? mockApi.simulatePayment(invoiceId)
      : request<{ invoice: Invoice }>(`/dev/simulate-payment/${invoiceId}`, { method: "POST" }).then(
          (r) => r.invoice,
        ),

  // GET /coops/{id}/payouts
  listCoopPayouts: (coopId: string): Promise<Payout[]> =>
    isMock ? mockApi.listCoopPayouts(coopId) : request(`/coops/${coopId}/payouts`),

  // POST /accounts/{id}/destinations → PayoutDestination
  addDestination: (accountId: string, body: NewDestinationBody): Promise<PayoutDestination> =>
    isMock
      ? mockApi.addDestination(accountId, body)
      : request(`/accounts/${accountId}/destinations`, { method: "POST", body: JSON.stringify(body) }),

  // DELETE /accounts/{id}/destinations/{destId} → 204
  removeDestination: (accountId: string, destId: string): Promise<void> =>
    isMock
      ? mockApi.removeDestination(accountId, destId)
      : request<void>(`/accounts/${accountId}/destinations/${destId}`, { method: "DELETE" }),

  // POST /name-enquiry → { account_name }
  resolveAccountName: (type: "mpesa" | "momo" | "bank", details: string): Promise<string> =>
    isMock
      ? mockApi.resolveAccountName(type, details)
      : request<{ account_name: string }>(`/name-enquiry`, {
          method: "POST",
          body: JSON.stringify({ type, details }),
        }).then((r) => r.account_name),

  // GET /coops/{id}/shipments
  listShipments: (coopId: string): Promise<Shipment[]> =>
    isMock ? shipmentsApi.list(coopId) : request(`/coops/${coopId}/shipments`),

  // POST /coops/{id}/shipments { buyer_name, product, quantity_kg, destination, value, currency, ship_date } → Shipment (draft)
  createShipment: (coopId: string, input: NewShipmentInput): Promise<Shipment> =>
    isMock ? shipmentsApi.create(coopId, input) : request(`/coops/${coopId}/shipments`, { method: "POST", body: JSON.stringify(input) }),

  // POST /shipments/{id}/farmers { account_id, kilos, mpesa? } → Shipment & { confirmation }
  addShipmentFarmer: (
    shipmentId: string,
    accountId: string,
    kilos: number,
    mpesa?: string,
  ): Promise<Shipment & { confirmation: FarmerShareConfirmation }> =>
    isMock
      ? shipmentsApi.addFarmer(shipmentId, accountId, kilos, mpesa)
      : request(`/shipments/${shipmentId}/farmers`, {
          method: "POST",
          body: JSON.stringify({ account_id: accountId, kilos, ...(mpesa ? { mpesa } : {}) }),
        }),

  // DELETE /shipments/{id}/farmers/{accountId} → Shipment
  removeShipmentFarmer: (shipmentId: string, accountId: string): Promise<Shipment> =>
    isMock
      ? shipmentsApi.removeFarmer(shipmentId, accountId)
      : request(`/shipments/${shipmentId}/farmers/${accountId}`, { method: "DELETE" }),

  // PATCH /shipments/{id} { buyer_name, product, quantity_kg, destination, value, currency, ship_date } → Shipment
  // 409 once an invoice is linked.
  updateShipment: (shipmentId: string, input: NewShipmentInput): Promise<Shipment> =>
    isMock
      ? shipmentsApi.update(shipmentId, input)
      : request(`/shipments/${shipmentId}`, { method: "PATCH", body: JSON.stringify(input) }),

  // PATCH /shipments/{id} { action: "advance" } → Shipment
  advanceShipment: (shipmentId: string): Promise<Shipment> =>
    isMock
      ? shipmentsApi.advance(shipmentId)
      : request(`/shipments/${shipmentId}`, { method: "PATCH", body: JSON.stringify({ action: "advance" }) }),

  // POST /auth/otp → { sent, dev_code? }
  requestOtp: (phone: string): Promise<{ sent: boolean; dev_code?: string }> =>
    request("/auth/otp", { method: "POST", body: JSON.stringify({ phone_number: phone }) }),

  // POST /auth/verify → { token, account_id, role, roles, account_types, account }
  verifyOtp: (phone: string, code: string): Promise<VerifyResult> =>
    request("/auth/verify", { method: "POST", body: JSON.stringify({ phone_number: phone, code }) }),

  // POST /auth/logout → 204
  logout: (): Promise<void> => (isMock ? Promise.resolve() : request<void>("/auth/logout", { method: "POST" })),

  // DELETE /invoices/{id} → 204 (only pending invoices; 409 otherwise)
  deleteInvoice: (invoiceId: string): Promise<void> =>
    isMock ? mockApi.deleteInvoice(invoiceId) : request<void>(`/invoices/${invoiceId}`, { method: "DELETE" }),

  // DELETE /coops/{id}/members/{accountId} → 204
  removeCoopMember: (coopId: string, accountId: string): Promise<void> =>
    isMock
      ? mockApi.removeCoopMember(coopId, accountId)
      : request<void>(`/coops/${coopId}/members/${accountId}`, { method: "DELETE" }),

  // DELETE /shipments/{id} → 204
  deleteShipment: (shipmentId: string): Promise<void> =>
    isMock ? shipmentsApi.remove(shipmentId) : request<void>(`/shipments/${shipmentId}`, { method: "DELETE" }),

  // GET /accounts/{id}/shipments — a Direct exporter's own shipments
  listAccountShipments: (accountId: string): Promise<Shipment[]> =>
    isMock
      ? shipmentsApi.list("coop_kiambu").then((l) => l.slice(0, 4))
      : request(`/accounts/${accountId}/shipments`),

  // POST /coops/{id}/members/lookup { phones } → which phones already have a Stawi account
  lookupPhones: (coopId: string, phones: string[]): Promise<PhoneLookup[]> =>
    isMock
      ? mockApi.lookupPhones(coopId, phones)
      : request(`/coops/${coopId}/members/lookup`, { method: "POST", body: JSON.stringify({ phones }) }),

  // POST /coops/{id}/members/import/preview
  previewMemberImport: (
    coopId: string,
    body: { csv_base64?: string; csv?: string; columns?: RosterColumnMap },
  ): Promise<RosterPreview> =>
    isMock
      ? mockApi.previewMemberImport(coopId, body)
      : request(`/coops/${coopId}/members/import/preview`, { method: "POST", body: JSON.stringify(body) }),

  // POST /coops/{id}/members/import
  applyMemberImport: (coopId: string, body: { origin: string; rows: RosterImportRow[] }, idempotencyKey: string): Promise<RosterApplyResult> =>
    isMock
      ? mockApi.applyMemberImport(coopId, body, idempotencyKey)
      : request(`/coops/${coopId}/members/import`, {
          method: "POST",
          body: JSON.stringify(body),
          headers: { "Idempotency-Key": idempotencyKey },
        }),

  // POST /coops/{id}/invites/sms { recipients } → per-phone send status, chunked so a long list is not capped at 500
  sendInviteSms: async (
    coopId: string,
    recipients: Array<{ phone_number: string; full_name: string; link: string }>,
    onProgress?: (progress: InviteSmsProgress) => void,
  ): Promise<{ sent: number; failed: number; results: Array<{ phone_number: string; sent: boolean; error?: string }> }> => {
    let sent = 0;
    let failed = 0;
    const results: Array<{ phone_number: string; sent: boolean; error?: string }> = [];
    const total = recipients.length;
    if (total === 0) return { sent, failed, results };
    for (let i = 0; i < total; i += INVITE_SMS_CHUNK) {
      const chunk = recipients.slice(i, i + INVITE_SMS_CHUNK);
      try {
        const part = isMock
          ? {
              sent: chunk.length,
              failed: 0,
              results: chunk.map((r) => ({ phone_number: r.phone_number, sent: true })),
            }
          : await request<{ sent: number; failed: number; results: Array<{ phone_number: string; sent: boolean; error?: string }> }>(
              `/coops/${coopId}/invites/sms`,
              { method: "POST", body: JSON.stringify({ recipients: chunk }) },
            );
        results.push(...part.results);
        sent += part.sent;
        failed += part.failed;
      } catch (err) {
        const reason = err instanceof ApiError ? err.message : "Couldn't send texts";
        for (const recipient of chunk) results.push({ phone_number: recipient.phone_number, sent: false, error: reason });
        failed += chunk.length;
      }
      onProgress?.({ done: Math.min(i + chunk.length, total), total, sent, failed });
    }
    return { sent, failed, results };
  },

  // GET /coops/{id}/payment-proofs or /accounts/{id}/payment-proofs (live only; see buyerPortal.ts)
  listPaymentProofs: (path: string): Promise<PaymentProof[]> => request(path),

  // GET /payment-proofs/{id}/receipt
  getProofReceipt: (id: string): Promise<{ receipt_name: string | null; receipt_data: string | null }> =>
    request(`/payment-proofs/${id}/receipt`),

  // POST /payment-proofs/{id}/confirm | reject
  reviewProof: (id: string, action: "confirm" | "reject"): Promise<unknown> =>
    request(`/payment-proofs/${id}/${action}`, { method: "POST" }),

  // TODO(backend): add to contract — co-op invite links (POST /coops/{id}/invites)
  updateMemberShare: (coopId: string, accountId: string, share: number): Promise<void> =>
    isMock
      ? mockApi.updateMemberShare(accountId, share)
      : request(`/coops/${coopId}/members/${accountId}`, {
          method: "PATCH",
          body: JSON.stringify({ contribution_share: share }),
        }),
};

export { ApiError };
