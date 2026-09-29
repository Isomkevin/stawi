// Mirrors the backend contract in packages/shared/src/index.ts exactly.
// Money rule: every *_kes_cents field is an integer number of KES cents.
// Buyer-currency invoice `amount` is a plain decimal in that currency.

export type PayoutDestination = {
  id: string;
  type: "mpesa" | "momo" | "bank";
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
  demo_balance_kes_cents?: number;
  demo_incoming_kes_cents?: number;
  is_demo?: boolean;
  /** Saved override. Null follows the server default. */
  demo_data_enabled?: boolean | null;
  demo_data_visible?: boolean;
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
  is_demo?: boolean;
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
  payaza_reference?: string | null;
  is_demo?: boolean;
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
  payaza_reference?: string | null;
  is_demo?: boolean;
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
  demo_balance_kes_cents?: number;
  demo_incoming_kes_cents?: number;
};

export type CoopMetricsBucket = {
  invoices: number;
  total_collected_kes_cents: number;
  fee_taken_kes_cents: number;
  total_split_kes_cents: number;
};

export type CoopMetrics = CoopMetricsBucket & {
  /** Live invoices only. Prefer this for headline totals. */
  live?: CoopMetricsBucket;
  /** Present while Demo Data is on. */
  demo?: CoopMetricsBucket;
};

export type DemoDataSettings = {
  demo_data_enabled: boolean | null;
  demo_data_visible: boolean;
  demo_data_default: boolean;
  effect: string;
};

export type PaymentReceipt = {
  receipt_number: string;
  invoice_id: string;
  invoice_reference: string;
  paid_at: string;
  payee_name: string;
  buyer_name: string;
  buyer_email: string;
  description: string;
  amount: number;
  currency: string;
  fx_rate: number | null;
  gross_kes_cents: number | null;
  fee_kes_cents: number | null;
  net_kes_cents: number | null;
  payaza_reference: string | null;
  status: InvoiceStatus;
};

export type InvoiceDetail = {
  invoice: Invoice;
  transactions: Transaction[];
  split_preview: SplitLine[] | null;
  /** Co-op name or exporter name. Present on the public pay page. */
  payee_name?: string;
  /** Member count for a co-op invoice. Null for a direct invoice. */
  farmer_count?: number | null;
};

export type CheckoutSession = {
  reference: string;
  checkoutUrl: string | null;
  public_key: string;
  transaction_reference: string;
  link_id?: string | null;
  connection_mode?: "Test" | "Live";
  checkout_amount: number;
  currency_code: string;
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

export type NewDestinationBody = { type: "mpesa" | "momo" | "bank"; details: string; account_name: string };

export type ShipmentStatus = "draft" | "preparing" | "ready" | "in_transit" | "delivered" | "completed";

export type ShipmentFarmer = { account_id: string; kilos: number };

export type FarmerShareConfirmation = {
  account_id: string;
  kilos: number;
  share: number | null;
  net_kes_cents: number | null;
  mpesa: string | null;
  payout: "mpesa_on_approval" | "sample_balance" | "balance" | "awaiting_payment";
};

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
  /** Unique per shipment. The buyer link is `/buyer?code=` plus this value. */
  buyer_code?: string;
  updated_at: string;
  is_demo?: boolean;
};

export const ACCOUNT_TYPES = ["farmer", "exporter", "coop"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

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

export type PaymentProofStatus = "submitted" | "confirmed" | "rejected";

export type PaymentProof = {
  id: string;
  invoice_id: string;
  shipment_id: string | null;
  shipment_reference: string;
  coop_id: string | null;
  account_id: string | null;
  payer_name: string;
  payer_email?: string;
  bank_reference: string;
  amount: number;
  currency: string;
  paid_at: string;
  note: string | null;
  receipt_name: string | null;
  has_receipt?: boolean;
  status: PaymentProofStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type BuyerLookup = {
  shipment: { reference: string; product: string; quantity_kg: number; destination: string; ship_date: string; status: ShipmentStatus };
  invoice: { id: string; reference: string; amount: number; currency: string; description: string; status: InvoiceStatus; buyer_name: string; due_at: string | null };
  payee_name?: string;
  proofs: PaymentProof[];
};

export type NewPaymentProofBody = {
  access_code: string;
  shipment_reference: string;
  payer_name: string;
  payer_email: string;
  bank_reference: string;
  amount: number;
  currency: string;
  paid_at: string;
  note?: string | undefined;
  receipt_name?: string | undefined;
  receipt_data?: string | undefined;
};
