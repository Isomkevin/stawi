import { mockApi } from "./mock";
import { shipmentsApi, type NewShipmentInput, type Shipment } from "./shipments";
import {
  ApiError,
  type Account,
  type Balance,
  type CheckoutSession,
  type Coop,
  type CoopMember,
  type CoopMetrics,
  type CreateAccountBody,
  type DemoDataSettings,
  type CreateInvoiceBody,
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

  // GET /invoices/{id}
  getInvoice: (invoiceId: string): Promise<InvoiceDetail> =>
    isMock ? mockApi.getInvoice(invoiceId) : request(`/invoices/${invoiceId}`),

  // GET /invoices/{id}/receipt — only after the payment is recorded
  getPaymentReceipt: (invoiceId: string): Promise<PaymentReceipt> =>
    isMock ? mockApi.getPaymentReceipt(invoiceId) : request(`/invoices/${invoiceId}/receipt`),

  // POST /invoices/{id}/checkout-session
  createCheckoutSession: (invoiceId: string): Promise<CheckoutSession> =>
    isMock
      ? mockApi.createCheckoutSession(invoiceId)
      : request(`/invoices/${invoiceId}/checkout-session`, { method: "POST" }),

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

  // POST /coops/{id}/invites/sms { recipients } → per-phone send status
  sendInviteSms: (
    coopId: string,
    recipients: Array<{ phone_number: string; full_name: string; link: string }>,
  ): Promise<{ sent: number; failed: number; results: Array<{ phone_number: string; sent: boolean; error?: string }> }> =>
    isMock
      ? Promise.resolve({ sent: recipients.length, failed: 0, results: recipients.map((r) => ({ phone_number: r.phone_number, sent: true })) })
      : request(`/coops/${coopId}/invites/sms`, { method: "POST", body: JSON.stringify({ recipients }) }),

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
