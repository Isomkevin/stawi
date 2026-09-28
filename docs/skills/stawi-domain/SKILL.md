---
name: stawi-domain
description: Stawi's own internal data model and API contract. This is the single source of truth every surface (webapp, dashboard, USSD/SMS adapter) must read and write through. Use this before building any surface so all agents converge on the same schema.
---

# Stawi domain model & internal API contract

This is Stawi's own backend contract — not Payaza's, not Africa's Talking's. Every frontend surface and the USSD adapter talk to *this* API; only the backend talks to Payaza and Africa's Talking directly.

## Why this file exists

Multiple agents are building different surfaces in parallel today. If each one invents its own shape for "an account" or "a transaction," the pieces won't fit together at integration time. Treat every schema below as fixed — if a surface needs a field that isn't here, add it here first and tell the other agents, don't invent a local variant.

**Money rule: all KES amounts are integer cents (`*_kes_cents`). Never floats. Splits use the largest-remainder method so lines sum exactly to the net amount. The runnable implementation of this contract is in `backend/` and the types in `backend/src/types.ts`; if this file and the code disagree, the code (which is tested) wins, then fix this file.**

## Core entities

### Account
A payee — either a solo exporter (Stawi Direct) or a co-op farmer (Stawi Co-op). Same shape either way.

```
Account {
  id: string
  full_name: string
  phone_number: string        // international format, +254...
  id_number: string
  payout_destinations: [
    { type: "mpesa" | "bank", details: string, is_verified: boolean }
  ]
  coop_id: string | null      // null for a solo exporter
  channel_capability: "webapp" | "webapp+ussd"
  pin_hash: string | null     // Stawi PIN, hashed (argon2/bcrypt); required for USSD withdrawals in live
  pin_failed_attempts: number
  pin_locked_until: datetime | null
  balance_kes_cents: number   // integer cents. cached, derived from Payout credits minus withdrawals
  incoming_kes_cents: number
}
```

### Coop
```
Coop {
  id: string
  name: string
  treasurer_account_id: string
}
```

### CoopMember
```
CoopMember {
  coop_id: string
  account_id: string
  contribution_share: number   // percentage, all members of one coop's active invoice must sum to 100
}
```

### Invoice
```
Invoice {
  id: string
  type: "direct" | "coop"
  account_id: string | null    // set if type == "direct"
  coop_id: string | null       // set if type == "coop"
  buyer_email: string
  buyer_phone: string
  amount: number
  currency: string              // buyer's currency, e.g. "USD"
  description: string
  status: "pending" | "paid" | "converting" | "settling" | "completed" | "failed"
  payaza_checkout_reference: string | null
  created_at: datetime
}
```

### Transaction
Every step of the money's journey — append-only, never edit a past Transaction.
```
Transaction {
  id: string
  invoice_id: string
  type: "collection" | "conversion" | "settlement" | "payout"
  status: "pending" | "completed" | "failed"
  amount: number
  currency: string
  payaza_reference: string | null
  fx_rate: number | null        // set on "conversion" type transactions
  fee_amount: number | null     // Stawi's own fee, set on "settlement"/"payout" — this feeds the revenue-model display
  created_at: datetime
}
```

### Payout
The terminal transaction to one specific Account.
```
Payout {
  id: string
  invoice_id: string
  transaction_id: string
  account_id: string
  kind: "credit" | "withdrawal"   // credit = split/settlement lands in the Stawi balance; withdrawal = sent to M-Pesa/bank
  amount_kes_cents: number
  destination_id: string | null   // null for credits
  status: "pending" | "sent" | "confirmed" | "failed"
  idempotency_key?: string
}
```

## Internal API contract

All surfaces (webapp, dashboard, USSD adapter) call these — none of them call Payaza or Africa's Talking directly.

```
POST   /accounts                        create an Account (onboarding)
GET    /accounts/{id}                   fetch an Account
GET    /accounts/{id}/balance           { balance_kes }
GET    /accounts/{id}/transactions      recent Transactions for this Account (via its Payouts)
POST   /accounts/{id}/withdraw          { destination_id, amount, pin, idempotency_key } → verifies PIN, creates/advances a Payout. Same endpoint for webapp and USSD; idempotency_key = sessionId for USSD.

POST   /coops                           create a Coop
POST   /coops/{id}/members              add a CoopMember { account_id, contribution_share }
GET    /coops/{id}/metrics              { total_collected, total_split, fee_taken, avg_payout_time }

POST   /invoices                        create an Invoice (type: direct | coop)
GET    /invoices/{id}                   fetch Invoice + its Transactions
POST   /invoices/{id}/checkout-session  server calls Payaza, returns a checkout URL/reference for the Buyer Portal

POST   /webhooks/payaza                 Payaza's async payment/settlement notifications land here (see skills/payaza/SKILL.md)
POST   /ussd/callback                   Africa's Talking's USSD gateway lands here (see skills/africas-talking/SKILL.md)
```

## Channel-parity rule (non-negotiable)

`GET /accounts/{id}/balance` and `GET /accounts/{id}/transactions` are called by **both** the webapp and the USSD adapter, unmodified. If the USSD handler formats a balance differently, it must be presentation-only (e.g., "KES 1,200" vs a raw number) — the underlying value and its correctness must never diverge between channels. This is the whole point of the two-pronged pitch: one account, one identity, two access methods.

## Revenue model wiring

`Transaction.fee_amount` is calculated at settlement time (illustrative: 0.5–1% of the converted amount) and must be visible in two places: the Co-op Dashboard's metrics (`GET /coops/{id}/metrics` → `fee_taken`) and the Invoice breakdown a buyer or treasurer can see. Don't bury this — it's the direct answer to the judges' "revenue model and pricing" question.

## Build order for this file's consumers

1. Backend agent implements this schema + the endpoints above, backed by whatever DB is fastest to stand up (Postgres or SQLite).
2. Backend agent wires `POST /invoices/{id}/checkout-session` and `POST /webhooks/payaza` to real Payaza sandbox calls (see `skills/payaza/SKILL.md`).
3. Backend agent wires `POST /ussd/callback` to Africa's Talking (see `skills/africas-talking/SKILL.md`), calling the same `/accounts/{id}/balance`, `/transactions`, `/withdraw` endpoints internally.
4. Frontend agents (webapp, dashboard, buyer portal) build against this contract as soon as it exists, even with a stubbed/mocked backend response matching these shapes — don't block frontend work on the real Payaza integration finishing first.
