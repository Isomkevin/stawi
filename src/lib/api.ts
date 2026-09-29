import { mockApi } from "./mock";
import { shipmentsApi, type Shipment } from "./shipments";
import {
  ApiError,
  type Account,
  type Balance,
  type CheckoutSession,
  type Coop,
  type CoopMember,
  type CoopMetrics,
  type CreateAccountBody,
  type CreateInvoiceBody,
  type Invoice,
  type InvoiceDetail,
  type NewDestinationBody,
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

export type VerifyResult = {
  token: string;
  account_id: string;
  role: "farmer" | "exporter" | "treasurer";
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
  createAccount: (body: CreateAccountBody): Promise<Account & { token?: string; role?: "farmer" | "exporter" | "treasurer" }> =>
    isMock ? mockApi.createAccount(body) : request("/accounts", { method: "POST", body: JSON.stringify(body) }),

  // GET /accounts/{id}
  getAccount: (accountId: string): Promise<Account> =>
    isMock ? mockApi.getAccount(accountId) : request(`/accounts/${accountId}`),

  // GET /accounts/{id}/balance
  getBalance: (accountId: string): Promise<Balance> =>
    isMock ? mockApi.getBalance(accountId) : request(`/accounts/${accountId}/balance`),

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
  resolveAccountName: (type: "mpesa" | "bank", details: string): Promise<string> =>
    isMock
      ? mockApi.resolveAccountName(type, details)
      : request<{ account_name: string }>(`/name-enquiry`, {
          method: "POST",
          body: JSON.stringify({ type, details }),
        }).then((r) => r.account_name),

  // GET /coops/{id}/shipments
  listShipments: (coopId: string): Promise<Shipment[]> =>
    isMock ? shipmentsApi.list(coopId) : request(`/coops/${coopId}/shipments`),

  // PATCH /shipments/{id} { action: "advance" } → Shipment
  advanceShipment: (shipmentId: string): Promise<Shipment> =>
    isMock
      ? shipmentsApi.advance(shipmentId)
      : request(`/shipments/${shipmentId}`, { method: "PATCH", body: JSON.stringify({ action: "advance" }) }),

  // POST /auth/otp → { sent, dev_code? }
  requestOtp: (phone: string): Promise<{ sent: boolean; dev_code?: string }> =>
    request("/auth/otp", { method: "POST", body: JSON.stringify({ phone_number: phone }) }),

  // POST /auth/verify → { token, account_id, role, account }
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
