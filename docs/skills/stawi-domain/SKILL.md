---
name: stawi-domain
description: Stawi's own internal data model and API contract. This is the single source of truth every surface (webapp, dashboard, USSD/SMS adapter) must read and write through. Use this before building any surface so all agents converge on the same schema.
---

# Stawi domain model and internal API

This is Stawi's own backend contract. The web app, the co-op dashboard, the buyer portal, and the USSD adapter call this API. Only `backend/src/services/payaza.ts` talks to Payaza. Only backend code talks to Africa's Talking.

The runnable implementation is `backend/`. Types live in `backend/src/types.ts`. Routes live in `backend/src/routes/index.ts`. If this file and the code disagree, the code (which is tested) wins, then fix this file. The frontend copy of the same shapes is `docs/LOVABLE_PROMPT.md` §8.

## Two products, one rail

**Direct** is one exporter. The buyer pays, Stawi converts to KES, takes a fee, and credits that exporter's Stawi balance.

**Co-op** is the same pipe plus a split. The buyer pays the co-op invoice. Money waits in `settling` until the treasurer approves. Stawi then credits each farmer on the linked shipment in proportion to their kilos. A roster member who is not on that shipment is not paid. Farmers withdraw from that balance to M-Pesa or a bank.

Payaza sub-accounts are not used for farmers. Payaza's own guide limits sub-accounts to internal business units. Splits happen in Stawi's ledger (`splitByKilos`). Payaza Transfers then pays one person at a time: when the treasurer approves, and again when a farmer or exporter withdraws whatever is still in the balance. See `skills/payaza/SKILL.md`.

## Money

All KES amounts are integer cents (`*_kes_cents`). Never floats.

`toKesCents` turns a buyer amount into KES cents with an FX rate. `feeCents` is 0.8% of that gross, rounded to cents. Net is gross minus fee.

`splitByShares` uses the largest-remainder method. For one invoice, member gross lines sum to the gross, net lines sum to the net, and fee lines sum to the fee.

A member's `contribution_share` is a percentage from 0 to 100. A co-op roster may total more or less than 100. Those standing shares are not the payout split. The splitter normalizes by the total share it is given, and still sums exactly.

A co-op invoice does not split by roster share. It pays the farmers on the shipment whose `invoice_id` points at that invoice, weighted by their kilos. `split_preview.share` is that weight as an integer percent, and those percents sum to 100. A draft shipment cannot advance until those kilos equal `quantity_kg`. Approving the split with no shipment farmers is rejected.

`balance_kes_cents` is the live spendable balance. It increases when a live credit payout is confirmed and decreases when a withdrawal is sent. `incoming_kes_cents` is a co-op member's live share of invoices that are `settling` and not yet approved. Approval moves that amount from incoming into balance.

Sample rows carry `is_demo: true`. Their funds sit in `demo_balance_kes_cents` and `demo_incoming_kes_cents`. Sandbox and live Payaza payouts never spend sample funds. Mock mode may spend them, because mock does not move real money. A new invoice, collection, or withdrawal is live even when Demo Data is on. A sample invoice is not sent to Payaza unless `PAYAZA_MODE=mock`.

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

**Direct**, after a successful collection: collection transaction, conversion transaction (rate, gross KES, 0.8% fee), a settlement transaction whose `payaza_reference` is empty (Stawi's record, not a Payaza call), one confirmed `credit` payout, balance increased by the net. The exporter withdraws that balance through Payaza.

**Co-op**, after a successful collection: collection and conversion only. Status becomes `settling`. The 0.8% fee is stored, and incoming is booked for the farmers on the linked shipment by their kilos. `POST /invoices/{id}/approve-split` checks the treasurer id and PIN, rejects a second approval, rejects a shipment with no farmers, writes the settlement transaction (again with an empty `payaza_reference`), and creates one confirmed `credit` payout per farmer on that shipment. It then calls Payaza Transfers once per farmer who has a verified M-Pesa, other mobile-money, or bank destination. One person per call. That row is saved as `sent` before the call. Mock mode confirms it. Sandbox and live stay `sent` until the payout webhook. A rejected call restores the balance. A farmer with no destination keeps the credit.

**Withdrawal** (`POST /accounts/{id}/withdraw` or USSD option 3): PIN required, destination must exist and be verified, amount is a positive integer of cents, cannot exceed balance. `idempotency_key` returns the original payout on replay. USSD uses `sessionId` as that key. The withdrawal row is saved as `sent` before Payaza is called, one person per call, to M-Pesa or a Kenyan bank. Mock mode confirms immediately. Sandbox and live stay `sent` until the payout webhook. A failed Payaza call restores the balance and stores a `failed` withdrawal. A second webhook does not move the balance again. Withdrawal rows use `invoice_id` `"withdrawal"`.

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
  contribution_share,    // 0–100. The roster total may pass 100.
  kilos?                 // roster volume. The split uses shipment kilos, not this field.
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

### Shipment

A co-op lot moving to a buyer. `value` is a buyer-currency decimal, same as invoice `amount`. `quantity_kg` and each farmer `kilos` are whole kilograms. Farmer kilos must not exceed `quantity_kg`, and they must sum to it before a draft can move on. Only these farmers are paid when the linked invoice is split.

```
Shipment {
  id, reference, coop_id,
  buyer_name, product, quantity_kg, destination,
  value, currency,
  ship_date, shipped_at,             // shipped_at is set when status becomes in_transit
  status: "draft" | "preparing" | "ready" | "in_transit" | "delivered" | "completed",
  invoice_id: string | null,
  farmers: [{ account_id, kilos }],
  buyer_code,                         // unique per shipment, assigned on save
  updated_at
}
```

`buyer_code` is an 8-character code, different for every shipment in a co-op. The buyer link is always `{origin}/buyer?code={buyer_code}`. `POST /buyer/lookup` with `{ access_code }` opens that shipment. `shipment_reference` is optional and, when sent, must match the shipment that owns the code.

Creating a co-op invoice also opens a draft shipment linked to it. The quantity is the kilogram amount in the description, or 1000 kg when the description has none. It starts with no farmers.

`POST /shipments/{id}/farmers` with `{ account_id, kilos, mpesa? }` puts a co-op member on the shipment, or updates their kilos. Kilos are a positive integer. The person must already be a member. The new total cannot exceed `quantity_kg`. Optional `mpesa` is saved as their verified M-Pesa number when they do not already have one, so the later Payaza transfer has somewhere to send. The response is the shipment plus `confirmation`: the integer `share`, `net_kes_cents`, a masked `mpesa`, and `payout`. `mpesa_on_approval` means a live invoice will send that share through Payaza Transfers when the treasurer approves. `sample_balance` means the invoice is sample data, so sandbox and live Payaza are not called. `balance` means there is no verified mobile number. `awaiting_payment` means the buyer has not paid. The same call returns 201 the first time and 200 when it changes kilos. It is refused once the linked invoice split is approved. Approving the split is still what moves the money, with the treasurer PIN, one Payaza transfer per farmer.

`DELETE /shipments/{id}/farmers/{accountId}` takes that farmer off the shipment, with the same lock. If the linked invoice is `settling`, both calls rewrite incoming balances from the farmers now on the shipment.

`PATCH /shipments/{id}` with shipment fields (`buyer_name`, `product`, `quantity_kg`, `destination`, `value`, `currency`, `ship_date`) updates those details. Omitted fields stay as they are. `quantity_kg` must stay a positive whole number and cannot drop below the kilos already assigned to farmers. This is refused with 409 once `invoice_id` is set. The same route with `{ action: "advance" }` moves one stage forward. A draft moves on only when farmer kilos sum to `quantity_kg`. Advancing into `in_transit` sets `shipped_at`. Advancing from `delivered` to `completed` requires the linked invoice to be `completed`. A second advance on a completed shipment is rejected.

`DELETE /shipments/{id}` removes the shipment. It is refused when the linked invoice is no longer `pending`. Deleting a pending invoice clears `invoice_id` on any shipment that pointed at it.

`DELETE /coops/{id}/members/{accountId}` removes that farmer from the roster. Money already in their balance stays. Their `coop_id` is cleared. Shares are not rebalanced.

## Auth

Sessions are required when `NODE_ENV` is `production`, or `PAYAZA_MODE` is `sandbox` or `live`, unless `AUTH_REQUIRED=false`. `AUTH_REQUIRED=true` forces it on. Mock local dev is open.

`POST /auth/otp` with `{ phone_number }` always answers `{ sent: true }` when the phone is unknown, so the endpoint does not reveal who has an account. A known phone gets a 6-digit SMS, valid 5 minutes, 5 attempts. Outside production, mock mode and `OTP_DEV_CODES=true` also return `dev_code` so the sign-in screen can show the test code. `MASTER_LOGIN_CODE`, when set, signs in any existing phone with that one code, including in production. Empty means the shortcut is off. Production never returns `dev_code`.

`POST /auth/verify` with `{ phone_number, code }` returns `{ token, account_id, role, roles, account_types, account }`. `account_types` is `farmer`, `exporter`, and/or `coop`. A phone may hold more than one. `roles` is the same set in dashboard names: `coop` is `treasurer`. `role` is the default among those (`treasurer`, then `farmer`, then `exporter`) so older clients still land somewhere. When no admin mapping has been saved, the set is the historical single role: treasurer of a co-op, otherwise farmer when `coop_id` is set, otherwise exporter. The token is also set as an HttpOnly `stawi_session` cookie (7 days). Send `Authorization: Bearer <token>` or the cookie.

`GET /admin/phones` is a small admin page for those mappings. It stays hidden until `ADMIN_SECRET` is set. Search, add a Kenyan number, and add or remove Farmer, Exporter, and Co-op independently. The primary key on `(phone, account_type)` rejects a duplicate. Numbers are stored as `+254` plus 9 digits.

`POST /auth/logout` clears the cookie.

When auth is on, these stay public: `GET /health`, `POST /accounts`, `POST /name-enquiry`, `POST /auth/otp`, `POST /auth/verify`, `GET /invoices/{id}`, `POST /invoices/{id}/checkout-session`, `POST /webhooks/payaza`, `POST /ussd/callback`, `/dev/*`, and `/admin/*`. The admin page uses `ADMIN_SECRET`, not a user session.

Everyone else must be signed in. You can read and write your own account. A treasurer can read member accounts in their co-op, but cannot withdraw for them. Co-op routes and co-op invoices require the treasurer. A direct invoice must name the caller's own account.

## API

Errors are JSON `{ error: string }` with 400, 401, 403, 404, or 409.

```
GET  /health

POST /auth/otp                          { phone_number } -> { sent: true, dev_code? }
POST /auth/verify                       { phone_number, code } -> { token, account_id, role, roles, account_types, account }
POST /auth/logout

POST /accounts                          { full_name, phone_number, id_number, pin, destination?: { type, details, account_name }, ussd?, coop_id? }
                                        -> 201 public Account plus { token, role } and a stawi_session cookie.
                                        Signup uses that token on the next request. No pin fields.
GET  /accounts/{id}
GET  /accounts/{id}/balance             -> { balance_kes_cents, incoming_kes_cents, demo_balance_kes_cents?, demo_incoming_kes_cents? }
                                        Demo balance fields are omitted when Demo Data is off for the viewer.
GET  /accounts/{id}/settings            -> { demo_data_enabled, demo_data_visible, demo_data_default, effect }
PATCH /accounts/{id}/settings           { demo_data_enabled: true | false | null }
                                        null clears the override and follows DEMO_DATA_ENABLED.
                                        The owner is the only writer. This does not change PAYAZA_MODE.
GET  /accounts/{id}/transactions?limit  -> Payout[]  (sample payouts omitted when Demo Data is off)
POST /accounts/{id}/destinations        { type, details, account_name, bank_code? } -> 201 PayoutDestination, 409 if duplicate
DELETE /accounts/{id}/destinations/{destId} -> 204, 400 if it is the last destination
POST /accounts/{id}/withdraw            { destination_id, amount_kes_cents, pin, idempotency_key? }

POST /coops                             { name, treasurer_account_id }
GET  /coops/{id}
GET  /coops/{id}/members
POST /coops/{id}/members                { account_id, contribution_share, kilos? }
                                        409 if that account already belongs to another co-op.
PATCH /coops/{id}/members/{accountId}   { contribution_share?, kilos? }
                                        Each share stays between 0 and 100. The roster total is not required to be 100.
DELETE /coops/{id}/members/{accountId}  -> 204. 404 if they are not a member.
POST /coops/{id}/members/import/preview { csv_base64? | csv?, columns?: { name, phone, share?, kilos? } }
                                        -> { needs_mapping, headers, delimiter, rows, total_share }
                                        Row status is add, update, invite, or other_coop. other_coop is a hard stop.
                                        Caps: 1 MB and 5000 farmers.
POST /coops/{id}/members/import         { origin, rows } plus Idempotency-Key
                                        -> { added, updated, invites, failed }
                                        Re-validates, updates kilos on existing members, and builds invite links with the co-op's real name.
POST /coops/{id}/members/lookup         { phones } -> 1 to 1000 numbers. Import preview looks phones up itself and is not capped at 1000.
POST /coops/{id}/invites/sms            { recipients } -> { sent, failed, results }
                                        Up to 5000 farmers in one call, sent in chunks of 100.
                                        One summary text goes to the operator number. Farmer texts are not copied one by one.
                                        Link must be an https://…/onboarding? URL.
GET  /coops/{id}/payouts                -> Payout[] for this co-op's invoices, newest first
GET  /coops/{id}/shipments              -> Shipment[] for this co-op, latest ship date first
POST /shipments/{id}/farmers            { account_id, kilos } -> Shipment
                                        201 when the farmer is new, 200 when kilos change.
                                        400 if they are not a member, kilos are not a positive integer, or the total would exceed quantity_kg.
                                        409 once the linked invoice split is approved.
DELETE /shipments/{id}/farmers/{accountId} -> Shipment. 404 if they are not on it. Same 409 lock.
PATCH /shipments/{id}                   { buyer_name?, product?, quantity_kg?, destination?, value?, currency?, ship_date? } -> Shipment
                                        409 once an invoice is linked. quantity_kg cannot drop below assigned farmer kilos.
                                        { action: "advance" } -> Shipment
DELETE /shipments/{id}                  -> 204. 409 if the linked invoice is no longer pending.
GET  /coops/{id}/metrics                -> { invoices, total_collected_kes_cents, fee_taken_kes_cents, total_split_kes_cents, avg_payout_time, live, demo? }
                                        Top-level totals include sample invoices when Demo Data is on, and live invoices only when it is off.
                                        `live` is always live-only. `demo` is present only when Demo Data is on.

POST /name-enquiry                      { type, details } -> { account_name }
                                        Public, because signup calls it before a session exists.
                                        A matching Stawi account returns that account's full_name.
                                        An unknown number with no session returns 200 { account_name: "Pending name check" }.
                                        KES name enquiry is not in Payaza's docs. A signed-in caller gets 404 when nothing matches.
                                        POST /accounts stores full_name when destination.account_name is that placeholder.

GET  /invoices?coop_id=&account_id=
POST /invoices                          { type, account_id | coop_id, buyer_name, buyer_email, buyer_phone?, amount, currency, description?, reference?, due_at?, shipment_id? }
                                        A co-op invoice with shipment_id links that lot (same co-op, no invoice yet) and copies buyer, value, and currency onto it. 400 if the lot is not in this co-op. 409 if it already has an invoice.
                                        Without shipment_id, a co-op invoice opens a draft shipment with this invoice_id and no farmers.
GET  /invoices/{id}/receipt              -> PaymentReceipt. Public. 409 until a collection has completed. 404 if missing.
GET  /invoices/{id}                     -> { invoice, transactions, split_preview: SplitLine[] | null, payee_name, farmer_count }
                                        Public. payee_name is the co-op name or the exporter's full name.
                                        farmer_count is the member count for a co-op invoice, and null for a direct invoice.
                                        The buyer page uses these fields. It does not call GET /coops or GET /accounts.
POST /invoices/{id}/checkout-session    { currency_code? } -> { reference, checkoutUrl | null, public_key, transaction_reference, link_id | null, connection_mode: "Test" | "Live", checkout_amount, currency_code }
                                        currency_code must be a Payaza checkout currency, or EUR or GBP. 400 otherwise. Omitted uses the invoice currency.
                                        checkout_amount is the invoice converted into that currency. The buyer page opens the Payaza Web SDK with that amount, currency_code, public_key, and transaction_reference.
                                        connection_mode is Live only when PAYAZA_MODE=live. The webhook marks the invoice paid.
POST /invoices/{id}/approve-split       { treasurer_id, pin }
PATCH /invoices/{id}                   { buyer_name?, buyer_email?, amount?, currency?, description?, shipment_id? }
                                        Only while status is pending. 409 once the buyer has paid (or the invoice has left pending).
                                        Buyer, amount, and currency are copied onto the linked shipment. shipment_id moves a co-op invoice onto another free lot.
DELETE /invoices/{id}                   -> 204 when status is pending. 409 otherwise.

POST /webhooks/payaza                   Payaza collection and payout notifications. HMAC when a secret is configured.
POST /ussd/callback                     Africa's Talking. See skills/africas-talking/SKILL.md.
                                        Rejected with 401 unless ?s= or the x-ussd-secret header matches AT_CALLBACK_SECRET.

POST /dev/simulate-payment/{invoiceId}  Mock mode only. Runs the same collection path as a webhook.
GET  /dev/seed-ids                      Mock mode only. Canonical Kiambu ids. The rest of the ledger is in docs/SCAFFOLD.md.
```

`SplitLine` is `{ account_id, share, gross_kes_cents, fee_kes_cents, net_kes_cents }`.

## Channel parity

Web and USSD both read `balance_kes_cents` and the same payout list. USSD only changes presentation (for example `KES 1,200.00` instead of cents). The menu is balance, last three payouts, and withdraw-with-PIN to a verified M-Pesa or bank destination. A confirmed credit or withdrawal texts that account. The same text is copied to `+254758750620`. USSD option 2 on the paid account's phone shows that payout as done.

## Where the demo data lives

Startup seeding, phones, PIN `1234`, and the canonical invoice ids are documented in `docs/SCAFFOLD.md` under Demo seed. `backend/src/data/catalog.ts` is the dataset. `backend/src/data/seed.ts` writes it and marks every seeded row `is_demo: true`, with the ledger balance in `demo_balance_kes_cents`. The Lovable mock (`src/lib/mock.ts`) is a smaller Kiambu story and is not this API.

Demo Data is a per-account visibility switch (`PATCH /accounts/{id}/settings`), not an application mode. `DEMO_DATA_ENABLED=true|false` is the default when the account has no saved value. When it is unset, sample rows stay visible. Set it to `false` to hide them until an account turns the switch on. Turning the switch off hides sample invoices, shipments, payouts, and sample balances. It does not delete them, and it does not block live checkout, collection, split approval, or withdrawal. `PAYAZA_MODE` still decides whether money movement is simulated. `VITE_API_MODE` still decides whether the Lovable app uses its built-in mock or this API.
