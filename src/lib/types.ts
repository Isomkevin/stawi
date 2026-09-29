// Mirrors the backend contract in packages/shared/src/index.ts exactly.
// Money rule: every *_kes_cents field is an integer number of KES cents.
// Buyer-currency invoice `amount` is a plain decimal in that currency.

export type PayoutDestination = {
  id: string;
  type: "mpesa" | "bank";
  details: string;
  account_name: string;
  is_verified: boolean;
};

export type Account = {
  id: string;
  full_name: string;
  phone_number: string;
  id_number: string;
  payout_destinations: PayoutDestination[];
  coop_id: string | null;
  channel_capability: "webapp" | "webapp+ussd";
  balance_kes_cents: number;
  incoming_kes_cents: number;
}; // pin_hash is never returned

export type Coop = {
  id: string;
  name: string;
  treasurer_account_id: string;
};

export type CoopMember = {
  coop_id: string;
  account_id: string;
  full_name?: string | undefined;
  contribution_share: number;
  kilos?: number | undefined;
};

export type InvoiceStatus =
  | "pending"
  | "paid"
  | "converting"
  | "settling"
  | "completed"
  | "failed";

export type Invoice = {
  id: string;
  type: "direct" | "coop";
  account_id: string | null;
  coop_id: string | null;
  buyer_name: string;
  buyer_email: string;
  buyer_phone?: string | undefined;
  amount: number;
  currency: string;
  description: string;
  reference: string;
  status: InvoiceStatus;
  split_approved: boolean;
  fx_rate: number | null;
  fee_kes_cents: number | null;
  kes_total_cents: number | null; // net after fee
  payaza_checkout_reference: string | null;
  created_at: string;
  due_at: string | null;
};

export type Transaction = {
  id: string;
  invoice_id: string;
  type: "collection" | "conversion" | "settlement" | "payout";
  status: "pending" | "completed" | "failed";
  amount: number;
  currency: string;
  fx_rate: number | null;
  fee_kes_cents: number | null;
  created_at: string;
};

export type Payout = {
  id: string;
  invoice_id: string;
  account_id: string;
  kind: "credit" | "withdrawal"; // credit = split landed in Stawi balance
  amount_kes_cents: number;
  destination_id: string | null;
  status: "pending" | "sent" | "confirmed" | "failed";
  created_at: string;
};

export type SplitLine = {
  account_id: string;
  share: number;
  gross_kes_cents: number;
  fee_kes_cents: number;
  net_kes_cents: number;
};

export type Balance = {
  balance_kes_cents: number;
  incoming_kes_cents: number;
};

export type CoopMetrics = {
  invoices: number;
  total_collected_kes_cents: number;
  fee_taken_kes_cents: number;
  total_split_kes_cents: number;
};

export type InvoiceDetail = {
  invoice: Invoice;
  transactions: Transaction[];
  split_preview: SplitLine[] | null;
};

export type CheckoutSession = {
  reference: string;
  checkoutUrl: string | null;
  public_key: string;
  transaction_reference: string;
};

export type CreateAccountBody = {
  full_name: string;
  phone_number: string;
  id_number: string;
  pin: string;
  destination: { type: "mpesa" | "bank"; details: string; account_name: string };
  ussd: boolean;
  coop_id?: string | undefined;
};

export type CreateInvoiceBody = {
  type: "direct" | "coop";
  account_id?: string | undefined;
  coop_id?: string | undefined;
  buyer_name: string;
  buyer_email: string;
  buyer_phone?: string | undefined;
  amount: number;
  currency: string;
  description: string;
  reference?: string | undefined;
  due_at?: string | null | undefined;
};

export type WithdrawBody = {
  destination_id: string;
  amount_kes_cents: number;
  pin: string;
  idempotency_key: string;
};

export type NewDestinationBody = { type: "mpesa" | "bank"; details: string; account_name: string };

export type ShipmentStatus = "draft" | "preparing" | "ready" | "in_transit" | "delivered" | "completed";

export type ShipmentFarmer = { account_id: string; kilos: number };

export type Shipment = {
  id: string;
  reference: string;
  coop_id: string;
  buyer_name: string;
  product: string;
  quantity_kg: number;
  destination: string;
  value: number;
  currency: string;
  ship_date: string;
  shipped_at: string | null;
  status: ShipmentStatus;
  invoice_id: string | null;
  farmers: ShipmentFarmer[];
  updated_at: string;
};

export type Role = "farmer" | "exporter" | "treasurer" | "buyer";

export class ApiError extends Error {
  status: number;
  code: string;
  attemptsLeft?: number | undefined;

  constructor(status: number, code: string, attemptsLeft?: number) {
    super(code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.attemptsLeft = attemptsLeft;
  }
}
