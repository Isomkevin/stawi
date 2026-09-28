---
name: stawi-domain
description: Stawi's own internal data model and API contract. This is the single source of truth every surface (webapp, dashboard, USSD/SMS adapter) must read and write through. Use this before building any surface so all agents converge on the same schema.
---

# Stawi domain model and internal API

This is Stawi's own backend contract. The web app, the co-op dashboard, the buyer portal, and the USSD adapter call this API. Only `backend/src/services/payaza.ts` talks to Payaza. Only backend code talks to Africa's Talking.

The runnable implementation is `backend/`. Types live in `backend/src/types.ts`. Routes live in `backend/src/routes/index.ts`. If this file and the code disagree, the code (which is tested) wins, then fix this file. The frontend copy of the same shapes is `docs/LOVABLE_PROMPT.md` §8.

## Two products, one rail

**Direct** is one exporter. The buyer pays, Stawi converts to KES, takes a fee, and credits that exporter's Stawi balance.

**Co-op** is the same pipe plus a split. The buyer pays the co-op invoice. Money waits in `settling` until the treasurer approves. Stawi then credits each member's balance by contribution share. Farmers withdraw from that balance to M-Pesa or a bank.

Payaza sub-accounts are not used for farmers. Payaza's own guide limits sub-accounts to internal business units. Splits happen in Stawi's ledger (`splitByShares`), then a later withdrawal calls Payaza's payout API. See `skills/payaza/SKILL.md`.

## Money

All KES amounts are integer cents (`*_kes_cents`). Never floats.

`toKesCents` turns a buyer amount into KES cents with an FX rate. `feeCents` is 0.8% of that gross, rounded to cents. Net is gross minus fee.

`splitByShares` uses the largest-remainder method. For one invoice, member gross lines sum to the gross, net lines sum to the net, and fee lines sum to the fee.

A member's `contribution_share` is a percentage. Shares for one co-op are expected to sum to 100. The splitter normalizes by the total share it is given, and still sums exactly.

`balance_kes_cents` is spendable. It increases when a credit payout is confirmed and decreases when a withdrawal is sent. `incoming_kes_cents` is a co-op member's share of invoices that are `settling` and not yet approved. Approval moves that amount from incoming into balance.

Illustrative FX used when a payment is processed (`pipeline.getFxRate`): USD 129, EUR 142, GBP 168. The demo ledger stores its own historical rates (USD 129, EUR 140.5, GBP 168.2). Payaza publishes no FX endpoint, so both tables are Stawi's, not a live quote.

## Pipeline

Collection is idempotent on the Payaza reference. An underpayment does not credit anyone.

| Invoice status | What has happened |
|---|---|
| `pending` | Created. No money yet. |
| `paid` | Collection recorded. Conversion has not finished. |
| `converting` | Conversion is in progress. |
| `settling` | Co-op only. Converted. Waiting for the treasurer to approve the split. Members' `incoming_kes_cents` includes their net share. |
| `completed` | Direct: exporter credited. Co-op: split approved and each member credited. |
| `failed` | Collection or a later step failed. No credit. |

**Direct**, after a successful collection: collection transaction, conversion transaction (rate, gross KES, fee), settlement transaction, one confirmed `credit` payout, balance increased by the net.

**Co-op**, after a successful collection: collection and conversion only. Status becomes `settling`. `POST /invoices/{id}/approve-split` checks the treasurer id and PIN, rejects a second approval, writes the settlement transaction, and creates one confirmed `credit` payout per member.

**Withdrawal** (`POST /accounts/{id}/withdraw` or USSD option 3): PIN required, destination must exist and be verified, amount is a positive integer of cents, cannot exceed balance. `idempotency_key` returns the original payout on replay. USSD uses `sessionId` as that key. Mock mode confirms immediately. Sandbox and live stay `sent` until the payout webhook. A failed Payaza call restores the balance and stores a `failed` withdrawal. Withdrawal rows use `invoice_id` `"withdrawal"`.

PIN: 4 digits, bcrypt. Five wrong attempts lock the account for 15 minutes. Responses use `{ error: "wrong" | "locked", attemptsLeft? }`.

## Entities

### Account

A payee. Solo exporter (`coop_id` null) or co-op farmer. The treasurer is an account too, and is not required to be a member of the split.

```
Account {
  id, full_name, phone_number,          // stored and matched in international form, +254...
  id_number,
  payout_destinations: [{
    id, type: "mpesa" | "bank", details, account_name,
    is_verified, bank_code?             // M-Pesa payouts use SAFKEN unless PAYAZA_MPESA_BANK_CODE is set
  }],
  coop_id: string | null,
  channel_capability: "webapp" | "webapp+ussd",
  balance_kes_cents, incoming_kes_cents,
  pin_hash, pin_failed_attempts, pin_locked_until   // never returned by the API
}
```

### Coop and CoopMember

```
Coop { id, name, treasurer_account_id }

CoopMember {
  coop_id, account_id, full_name?,
  contribution_share,    // percentage
  kilos?                 // recorded volume; not used to compute the split
}
```

### Invoice

```
Invoice {
  id,
  type: "direct" | "coop",
  account_id: string | null,     // set when type is direct
  coop_id: string | null,         // set when type is coop
  buyer_name, buyer_email, buyer_phone?,
  amount, currency,               // buyer currency, e.g. USD
  description, reference,         // reference is unique
  status: "pending" | "paid" | "converting" | "settling" | "completed" | "failed",
  split_approved,
  fx_rate, fee_kes_cents, kes_total_cents,    // null until conversion has a result; kes_total is net
  payaza_checkout_reference, payaza_link_id?,
  created_at, due_at
}
```

### Transaction

Append-only. One invoice has a collection, then a conversion, then (when settled) a settlement.

```
Transaction {
  id, invoice_id,
  type: "collection" | "conversion" | "settlement" | "payout",
  status: "pending" | "completed" | "failed",
  amount, currency,
  payaza_reference, fx_rate,       // fx_rate on conversion
  fee_kes_cents,                   // set on conversion and settlement; this is the revenue line
  created_at
}
```

### Payout

```
Payout {
  id, invoice_id, transaction_id?, account_id,
  kind: "credit" | "withdrawal",
  amount_kes_cents,                // positive integer
  destination_id,                  // null on credits
  status: "pending" | "sent" | "confirmed" | "failed",
  idempotency_key?, payaza_reference?,
  created_at
}
```

`GET /accounts/{id}/transactions` returns payouts, newest first. That is the activity list on web and USSD. Invoice `Transaction` rows are on `GET /invoices/{id}`.

## Auth

Sessions are required when `NODE_ENV` is `production`, or `PAYAZA_MODE` is `sandbox` or `live`, unless `AUTH_REQUIRED=false`. `AUTH_REQUIRED=true` forces it on. Mock local dev is open.

`POST /auth/otp` with `{ phone_number }` always answers `{ sent: true }` when the phone is unknown, so the endpoint does not reveal who has an account. A known phone gets a 6-digit SMS, valid 5 minutes, 5 attempts. In mock mode outside production the response also includes `dev_code`.

`POST /auth/verify` with `{ phone_number, code }` returns `{ token, account_id, role, account }`. `role` is `treasurer` if the account is a co-op's `treasurer_account_id`, otherwise `farmer` when `coop_id` is set, otherwise `exporter`. The token is also set as an HttpOnly `stawi_session` cookie (7 days). Send `Authorization: Bearer <token>` or the cookie.

`POST /auth/logout` clears the cookie.

When auth is on, these stay public: `GET /health`, `POST /accounts`, `POST /auth/otp`, `POST /auth/verify`, `GET /invoices/{id}`, `POST /invoices/{id}/checkout-session`, `POST /webhooks/payaza`, `POST /ussd/callback`, and `/dev/*`.

Everyone else must be signed in. You can read and write your own account. A treasurer can read member accounts in their co-op, but cannot withdraw for them. Co-op routes and co-op invoices require the treasurer. A direct invoice must name the caller's own account.

## API

Errors are JSON `{ error: string }` with 400, 401, 403, or 404.

```
GET  /health

POST /auth/otp                          { phone_number } -> { sent: true, dev_code? }
POST /auth/verify                       { phone_number, code } -> { token, account_id, role, account }
POST /auth/logout

POST /accounts                          { full_name, phone_number, id_number, pin, destination?: { type, details, account_name }, ussd?, coop_id? }
                                        -> 201 public Account (no pin fields)
GET  /accounts/{id}
GET  /accounts/{id}/balance             -> { balance_kes_cents, incoming_kes_cents }
GET  /accounts/{id}/transactions?limit  -> Payout[]
POST /accounts/{id}/destinations        { type, details, account_name, bank_code? } -> 201 PayoutDestination, 409 if duplicate
DELETE /accounts/{id}/destinations/{destId} -> 204, 400 if it is the last destination
POST /accounts/{id}/withdraw            { destination_id, amount_kes_cents, pin, idempotency_key? }

POST /coops                             { name, treasurer_account_id }
GET  /coops/{id}
GET  /coops/{id}/members
POST /coops/{id}/members                { account_id, contribution_share, kilos? }
PATCH /coops/{id}/members/{accountId}   { contribution_share }
GET  /coops/{id}/payouts                -> Payout[] for this co-op's invoices, newest first
GET  /coops/{id}/metrics                -> { invoices, total_collected_kes_cents, fee_taken_kes_cents, total_split_kes_cents, avg_payout_time }

POST /name-enquiry                      { type, details } -> { account_name } or 404
                                        KES name enquiry is not in Payaza's docs. This matches a Stawi account the caller already holds.

GET  /invoices?coop_id=&account_id=
POST /invoices                          { type, account_id | coop_id, buyer_name, buyer_email, buyer_phone?, amount, currency, description?, reference?, due_at? }
GET  /invoices/{id}                     -> { invoice, transactions, split_preview: SplitLine[] | null }
POST /invoices/{id}/checkout-session    -> { reference, checkoutUrl | null, public_key, transaction_reference, link_id | null }
POST /invoices/{id}/approve-split       { treasurer_id, pin }

POST /webhooks/payaza                   Payaza collection and payout notifications. HMAC when a secret is configured.
POST /ussd/callback                     Africa's Talking. See skills/africas-talking/SKILL.md.
                                        Rejected with 401 unless ?s= or the x-ussd-secret header matches AT_CALLBACK_SECRET.

POST /dev/simulate-payment/{invoiceId}  Mock mode only. Runs the same collection path as a webhook.
GET  /dev/seed-ids                      Mock mode only. Canonical Kiambu ids. The rest of the ledger is in docs/SCAFFOLD.md.
```

`SplitLine` is `{ account_id, share, gross_kes_cents, fee_kes_cents, net_kes_cents }`.

## Channel parity

Web and USSD both read `balance_kes_cents` and the same payout list. USSD only changes presentation (for example `KES 1,200.00` instead of cents). The menu is balance, last three payouts, and withdraw-with-PIN to a verified M-Pesa or bank destination.

## Where the demo data lives

Startup seeding, phones, PIN `1234`, and the canonical invoice ids are documented in `docs/SCAFFOLD.md` under Demo seed. `backend/src/data/catalog.ts` is the dataset. `backend/src/data/seed.ts` writes it. The Lovable mock (`src/lib/mock.ts`) is a smaller Kiambu story and is not this API.
