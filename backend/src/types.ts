// Backend domain types. Mirror these in the frontend client. Money fields ending in `_kes_cents` are integers.
export type DestinationType = "mpesa" | "bank";
export interface PayoutDestination {
  id: string; type: DestinationType; details: string; account_name: string; is_verified: boolean;
}
export interface Account {
  id: string; full_name: string; phone_number: string; id_number: string;
  payout_destinations: PayoutDestination[]; coop_id: string | null;
  channel_capability: "webapp" | "webapp+ussd";
  pin_hash: string | null; pin_failed_attempts: number; pin_locked_until: string | null;
  balance_kes_cents: number; incoming_kes_cents: number;
}
export interface Coop { id: string; name: string; treasurer_account_id: string }
export interface CoopMember { coop_id: string; account_id: string; contribution_share: number; kilos?: number }
export type InvoiceStatus = "pending" | "paid" | "converting" | "settling" | "completed" | "failed";
export interface Invoice {
  id: string; type: "direct" | "coop"; account_id: string | null; coop_id: string | null;
  buyer_name: string; buyer_email: string; buyer_phone?: string;
  amount: number; currency: string; description: string; reference: string;
  status: InvoiceStatus; split_approved: boolean;
  fx_rate: number | null; fee_kes_cents: number | null; kes_total_cents: number | null;
  payaza_checkout_reference: string | null; created_at: string; due_at: string | null;
}
export type TxType = "collection" | "conversion" | "settlement" | "payout";
export interface Transaction {
  id: string; invoice_id: string; type: TxType; status: "pending" | "completed" | "failed";
  amount: number; currency: string; payaza_reference: string | null;
  fx_rate: number | null; fee_kes_cents: number | null; created_at: string;
}
export interface Payout {
  id: string; invoice_id: string; transaction_id: string; account_id: string;
  kind: "credit" | "withdrawal";            // credit = split lands in Stawi balance; withdrawal = sent to M-Pesa/bank
  amount_kes_cents: number; destination_id: string | null;
  status: "pending" | "sent" | "confirmed" | "failed"; idempotency_key?: string; created_at: string;
}
export interface SplitLine { account_id: string; share: number; gross_kes_cents: number; fee_kes_cents: number; net_kes_cents: number }
