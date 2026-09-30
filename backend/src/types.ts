/** Signup name check when Payaza has no KES carrier lookup and the number is not already a Stawi account. */
export const UNRESOLVED_ACCOUNT_NAME = "Pending name check";

export type PayoutDestination = {
  id: string;
  /** momo = other mobile money (Airtel Money). Sent as Payaza mobile_money. */
  type: "mpesa" | "momo" | "bank";
  details: string;
  account_name: string;
  is_verified: boolean;
  /** Payaza bank code. Required for bank payouts; M-Pesa uses SAFKEN unless overridden. */
  bank_code?: string;
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
  /** Sample funds. Never sent through Payaza sandbox or live payouts. */
  demo_balance_kes_cents?: number;
  /** Sample share of co-op invoices still waiting for split approval. */
  demo_incoming_kes_cents?: number;
  /** Seeded sample account. Live signups are false. */
  is_demo?: boolean;
  /**
   * Saved Demo Data switch. Null follows DEMO_DATA_ENABLED. Unset means sample rows stay visible.
   * This does not change PAYAZA_MODE.
   */
  demo_data_enabled?: boolean | null;
  /** Effective switch for this account, including the env default. Response-only. */
  demo_data_visible?: boolean;
  pin_hash?: string | null;
  pin_failed_attempts?: number;
  pin_locked_until?: string | null;
};

export type PublicAccount = Omit<Account, "pin_hash" | "pin_failed_attempts" | "pin_locked_until">;

export type Coop = {
  id: string;
  name: string;
  treasurer_account_id: string;
};

export type CoopMember = {
  coop_id: string;
  account_id: string;
  full_name?: string;
  contribution_share: number;
  kilos?: number;
};

export type InvoiceType = "direct" | "coop";
export type InvoiceStatus = "pending" | "paid" | "converting" | "settling" | "completed" | "failed";

export type Invoice = {
  id: string;
  type: InvoiceType;
  account_id: string | null;
  coop_id: string | null;
  buyer_name: string;
  buyer_email: string;
  buyer_phone?: string;
  amount: number;
  currency: string;
  description: string;
  reference: string;
  status: InvoiceStatus;
  split_approved: boolean;
  fx_rate: number | null;
  fee_kes_cents: number | null;
  kes_total_cents: number | null;
  payaza_checkout_reference: string | null;
  /** Payaza payment-link id, saved so webhooks can be correlated back to this invoice. */
  payaza_link_id?: string | null;
  /** Sample invoice. New invoices created through the API are false. */
  is_demo?: boolean;
  created_at: string;
  due_at: string | null;
};

/** Fields a treasurer or exporter may change while the invoice is still unpaid. */
export type UpdateInvoiceBody = {
  buyer_name?: string;
  buyer_email?: string;
  buyer_phone?: string | null;
  amount?: number;
  currency?: string;
  description?: string;
  due_at?: string | null;
  /** Co-op only. Moves the link to another shipment that does not already have an invoice. */
  shipment_id?: string;
};

export type TransactionType = "collection" | "conversion" | "settlement" | "payout";
export type TransactionStatus = "pending" | "completed" | "failed";

export type Transaction = {
  id: string;
  invoice_id: string;
  type: TransactionType;
  status: TransactionStatus;
  amount: number;
  currency: string;
  payaza_reference: string | null;
  fx_rate: number | null;
  fee_kes_cents: number | null;
  /** Copied from the invoice. Sample activity stays sample. */
  is_demo?: boolean;
  created_at: string;
};

export type PayoutKind = "credit" | "withdrawal";
export type PayoutStatus = "pending" | "sent" | "confirmed" | "failed";

export type Payout = {
  id: string;
  invoice_id: string;
  transaction_id?: string;
  account_id: string;
  kind: PayoutKind;
  amount_kes_cents: number;
  destination_id: string | null;
  status: PayoutStatus;
  created_at: string;
  idempotency_key?: string;
  /** Beneficiary transaction_reference sent to Payaza, used to apply payout webhooks. */
  payaza_reference?: string | null;
  /** Entirely sample money. Mixed mock withdrawals stay live so a real payout is not hidden. */
  is_demo?: boolean;
  /** Cents of this withdrawal that came from demo_balance_kes_cents. Used to restore the right balance. */
  demo_portion_kes_cents?: number;
};

export type SplitLine = {
  account_id: string;
  share: number;
  gross_kes_cents: number;
  fee_kes_cents: number;
  net_kes_cents: number;
};

export type CoopMetricsBucket = {
  invoices: number;
  total_collected_kes_cents: number;
  fee_taken_kes_cents: number;
  total_split_kes_cents: number;
};

export type CoopMetrics = CoopMetricsBucket & {
  avg_payout_time?: string;
  /** Live invoices only. Top-level totals include sample rows when Demo Data is on, for existing clients. */
  live: CoopMetricsBucket;
  /** Present when the viewer has Demo Data on. */
  demo?: CoopMetricsBucket;
};

export type DemoDataSettings = {
  demo_data_enabled: boolean | null;
  demo_data_visible: boolean;
  demo_data_default: boolean;
  effect: string;
};

/** Dashboard access for one phone. A phone may hold more than one at the same time. */
export const ACCOUNT_TYPES = ["farmer", "exporter", "coop"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export type PhoneMapping = {
  phone_number: string;
  account_id: string | null;
  full_name: string | null;
  account_types: AccountType[];
  /** True once an admin has saved this phone. Otherwise types are derived from the account. */
  explicit: boolean;
  multiple: boolean;
};

export const SHIPMENT_STATUSES = ["draft", "preparing", "ready", "in_transit", "delivered", "completed"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export type ShipmentFarmer = {
  account_id: string;
  kilos: number;
};

/**
 * Returned when a farmer is added or their kilos change.
 * The payout itself still waits for the treasurer PIN on approve-split, which calls Payaza.
 */
export type FarmerShareConfirmation = {
  account_id: string;
  kilos: number;
  /** Integer percent of this shipment's kilos. Null when there is no co-op invoice to price. */
  share: number | null;
  net_kes_cents: number | null;
  /** Masked verified M-Pesa or mobile-money number, when one is saved. */
  mpesa: string | null;
  /**
   * mpesa_on_approval: a live invoice will send this share through Payaza on approve.
   * sample_balance: the invoice is sample data, so Payaza is not called.
   * balance: no verified mobile number, so the share stays in the Stawi balance.
   * awaiting_payment: the buyer has not paid yet.
   */
  payout: "mpesa_on_approval" | "sample_balance" | "balance" | "awaiting_payment";
};

/** Buyer-currency `value` is a decimal, same as invoice `amount`. Kilos are whole kilograms. */
export type Shipment = {
  id: string;
  reference: string;
  /** Empty for exporter shipments. */
  coop_id: string;
  /** Set for a Direct exporter's own shipment. */
  account_id?: string | null;
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
  /**
   * Unique code for this shipment's buyer portal.
   * The share link is `/buyer?code=` plus this value. Assigned when the shipment is saved.
   */
  buyer_code?: string;
  updated_at: string;
  is_demo?: boolean;
};

export type PaymentProofStatus = "submitted" | "confirmed" | "rejected";

/** Bank-transfer proof a buyer submits in the buyer portal. `amount` is buyer currency decimal. */
export type PaymentProof = {
  id: string;
  invoice_id: string;
  shipment_id: string | null;
  shipment_reference: string;
  coop_id: string | null;
  account_id: string | null;
  payer_name: string;
  payer_email: string;
  bank_reference: string;
  amount: number;
  currency: string;
  paid_at: string;
  note: string | null;
  receipt_name: string | null;
  /** data: URL. Omitted from list responses unless requested. */
  receipt_data?: string | null;
  status: PaymentProofStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type RosterImportStatus = "add" | "update" | "invite" | "other_coop";

export type RosterColumnMap = {
  name: number;
  phone: number;
  share?: number;
  kilos?: number;
};

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

export type RosterInvite = {
  name: string;
  phone: string;
  share: number;
  url: string;
};

export type RosterApplyResult = {
  added: string[];
  updated: string[];
  invites: RosterInvite[];
  failed: Array<{ name: string; reason: string }>;
};
