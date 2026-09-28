export type PayoutDestination = {
  id: string;
  type: "mpesa" | "bank";
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
  created_at: string;
  due_at: string | null;
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
};

export type SplitLine = {
  account_id: string;
  share: number;
  gross_kes_cents: number;
  fee_kes_cents: number;
  net_kes_cents: number;
};

export type CoopMetrics = {
  invoices: number;
  total_collected_kes_cents: number;
  fee_taken_kes_cents: number;
  total_split_kes_cents: number;
  avg_payout_time?: string;
};
