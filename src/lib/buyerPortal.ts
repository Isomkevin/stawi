import { API_BASE_URL, isMock } from "./api";
import { mockApi } from "./mock";
import { shipmentsApi } from "./shipments";
import { ApiError, type BuyerLookup, type NewPaymentProofBody, type PaymentProof } from "./types";

/** Hardcoded for now. The server accepts BUYER_PORTAL_CODE, defaulting to this value. */
export const BUYER_PORTAL_CODE = "STAWI-BUYER-2026";

let mockProofs: Array<PaymentProof & { receipt_data?: string | null }> = [];

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const b = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, b.error ?? "Request failed");
  }
  return (await res.json()) as T;
}

async function mockLookup(code: string, ref: string): Promise<BuyerLookup> {
  if (code.trim().toUpperCase() !== BUYER_PORTAL_CODE) throw new ApiError(403, "That access code isn't right");
  const all = await shipmentsApi.list("coop_kiambu");
  const s = all.find((x) => x.reference.toLowerCase() === ref.trim().toLowerCase());
  if (!s?.invoice_id) throw new ApiError(404, "No shipment with that number has an invoice yet");
  const { invoice, payee_name } = await mockApi.getInvoice(s.invoice_id);
  return {
    shipment: { reference: s.reference, product: s.product, quantity_kg: s.quantity_kg, destination: s.destination, ship_date: s.ship_date, status: s.status },
    invoice: { id: invoice.id, reference: invoice.reference, amount: invoice.amount, currency: invoice.currency, description: invoice.description, status: invoice.status, buyer_name: invoice.buyer_name, due_at: invoice.due_at },
    payee_name: payee_name ?? "Kiambu Highlands Coffee Co-op",
    proofs: mockProofs.filter((p) => p.invoice_id === invoice.id),
  };
}

export const buyerPortal = {
  lookup: (access_code: string, shipment_reference: string): Promise<BuyerLookup> =>
    isMock ? mockLookup(access_code, shipment_reference) : post("/buyer/lookup", { access_code, shipment_reference }),

  submitProof: async (body: NewPaymentProofBody): Promise<PaymentProof> => {
    if (!isMock) return post("/buyer/payment-proofs", body);
    const found = await mockLookup(body.access_code, body.shipment_reference);
    const proof: PaymentProof & { receipt_data?: string | null } = {
      id: `pp_${Date.now()}`, invoice_id: found.invoice.id, shipment_id: null, shipment_reference: found.shipment.reference,
      coop_id: "coop_kiambu", account_id: null, payer_name: body.payer_name, payer_email: body.payer_email,
      bank_reference: body.bank_reference, amount: body.amount, currency: body.currency, paid_at: body.paid_at,
      note: body.note ?? null, receipt_name: body.receipt_name ?? null, receipt_data: body.receipt_data ?? null,
      has_receipt: Boolean(body.receipt_data), status: "submitted", reviewed_by: null, reviewed_at: null, created_at: new Date().toISOString(),
    };
    mockProofs = [proof, ...mockProofs];
    return proof;
  },

  listCoop: async (coopId: string): Promise<PaymentProof[]> => {
    if (isMock) return mockProofs.filter((p) => p.coop_id === coopId);
    const { api } = await import("./api");
    return api.listPaymentProofs(`/coops/${coopId}/payment-proofs`);
  },

  listAccount: async (accountId: string): Promise<PaymentProof[]> => {
    if (isMock) return mockProofs.filter((p) => p.account_id === accountId);
    const { api } = await import("./api");
    return api.listPaymentProofs(`/accounts/${accountId}/payment-proofs`);
  },

  receipt: async (id: string): Promise<{ receipt_name: string | null; receipt_data: string | null }> => {
    if (isMock) {
      const p = mockProofs.find((x) => x.id === id);
      return { receipt_name: p?.receipt_name ?? null, receipt_data: p?.receipt_data ?? null };
    }
    const { api } = await import("./api");
    return api.getProofReceipt(id);
  },

  review: async (id: string, action: "confirm" | "reject"): Promise<void> => {
    if (isMock) {
      const p = mockProofs.find((x) => x.id === id);
      if (!p) throw new ApiError(404, "Payment proof not found");
      if (action === "confirm") await mockApi.simulatePayment(p.invoice_id);
      p.status = action === "confirm" ? "confirmed" : "rejected";
      p.reviewed_at = new Date().toISOString();
      return;
    }
    const { api } = await import("./api");
    await api.reviewProof(id, action);
  },
};
