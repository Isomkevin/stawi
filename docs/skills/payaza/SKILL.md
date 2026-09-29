---
name: payaza
description: Integration patterns for Payaza auth, hosted checkout, payment links, mobile money (M-Pesa) collection, webhooks, multi-currency, transfers/payouts (single and bulk), split settlements, and sub-accounts. Use whenever writing code that creates a payment link, collects a payment, verifies a webhook, converts currency, settles funds, or splits a payout across multiple recipients for Stawi.
---

# Payaza integration

Payaza is the payment infrastructure Stawi is built on. Products that matter for Stawi:

| Product | Used by | Role |
|---|---|---|
| Checkout (Web SDK) / Payment Links | Direct + Co-op | Collects the buyer's payment in their own currency |
| Mobile money collections (KES) | Optional | Collects from a Kenyan M-Pesa/Airtel wallet |
| Multi-currency | Direct + Co-op | Converts the buyer's currency into KES ⚠️ not documented, see §7 |
| Transfers (payouts) | Direct + Co-op | Pays KES out to a bank or M-Pesa account; supports **bulk payouts with many beneficiaries in one call** |
| Split settlements | Co-op (option) | Splits a checkout payment across beneficiary accounts at settlement time |
| Sub-accounts | **Not for Stawi farmers** | Internal business units only, see §9 |

**Source of truth:** https://docs.payaza.africa (last checked 28 Sep 2026). Machine-readable: `https://docs.payaza.africa/llms.txt` (page index) and `https://docs.payaza.africa/openapi.json` (exact schemas, fetch this before coding an endpoint). Payaza engineers on Build Day are the tiebreaker where the docs are silent or contradict each other.

**Legend:** items marked ⚠️ **CONFIRM** are unconfirmed or inconsistent in the docs. Ask engineers before depending on them.

## Doc links

- Getting started: https://docs.payaza.africa/guides/getting-started
- Authentication: https://docs.payaza.africa/guides/authentication
- Test cards: https://docs.payaza.africa/guides/testcards
- Web checkout: https://docs.payaza.africa/guides/webcheckoutguide (SDK reference: https://docs.payaza.africa/api-reference/libraries/websdk)
- Payment links: https://docs.payaza.africa/guides/payment-links
- Mobile money: https://docs.payaza.africa/guides/momo-collections
- Virtual accounts (NGN only, not used by Stawi): https://docs.payaza.africa/guides/virtual-accounts
- Transfers: https://docs.payaza.africa/guides/transfers (API ref: https://docs.payaza.africa/api-reference/transfers/initiate-a-transfer)
- Split settlements: https://docs.payaza.africa/guides/split-settlements
- Sub-accounts: https://docs.payaza.africa/guides/sub-accounts
- Webhooks: https://docs.payaza.africa/guides/webhooks
- Errors: https://docs.payaza.africa/guides/errors
- Support: support@payaza.africa / integrationsupport@payaza.africa. Community on Discord and Slack (links on the docs home page). When asking for help, post team name, goal, endpoint, and error message. **Never share API keys.**

## 1. Auth and environments

One platform, one base URL, one dashboard (https://business.payaza.africa).

```
Base URL:       https://api.payaza.africa/live/     (the /live/ segment is fixed; it does NOT change for test)
Authorization:  Payaza <base64(PUBLIC API KEY)>     (prefix is "Payaza", NOT "Bearer"; key MUST be Base64-encoded)
X-TenantID:     test | live                         (selects environment)
X-ProductID:    app                                 (only for the Momo/XOF/ZAR/SLE collections API)
Content-Type:   application/json
```

Test vs live is decided by two things only: the key (generated in Test Mode vs Live Mode at **Settings → Developers → Generate Keys**) and `X-TenantID`. Mismatching them returns `Authentication failed`. Test requests need no KYB; live requires KYB approval.

Required headers vary by API:

| API | X-TenantID | X-ProductID |
|---|---|---|
| Card collections, Virtual accounts, Apple/Google Pay, Refunds | not required | not required |
| Momo / XOF / ZAR / SLE collections | `test`/`live` | `app` |
| Transfers, Sub-accounts, Account enquiry, Split settlements | `test`/`live` | not required |
| Payment links | not shown in docs; send `X-TenantID` anyway ⚠️ **CONFIRM** | not required |

Keys seen in the docs: public keys look like `PZ78-PKTEST-…` (test); a **secret** key (looks like `PZ78-SKLIVE-…`) is used only for HMAC signing (webhook verification and the optional signed-transfer header, see §4 and §8). It is not Base64-encoded when used for HMAC.

```
PAYAZA_PUBLIC_KEY   → raw key goes in the Web SDK `merchant_key`; Base64 of it goes in the Authorization header for REST calls
PAYAZA_SECRET_KEY   → backend only: HMAC for webhook verification + signed transfers
PAYAZA_PIN          → backend only: 6-digit transaction PIN, required on every payout
PAYAZA_TENANT       → "test" during Build Day
```

**Security note.** The same public key drives the Web SDK (client-side, raw) and REST calls (Base64). Payaza's docs say never to expose your API key in client code, yet the SDK requires it, so treat the SDK use as the one sanctioned exception. Every REST call, especially payouts, stays on the backend. Payouts are additionally gated by PIN, live IP whitelisting, and the optional signature header (§8). Recommended: ask Payaza to enable the signature header so a leaked public key alone cannot move money.

```js
// server-side helper
const b64 = (s) => Buffer.from(s).toString("base64");
export const payazaHeaders = (extra = {}) => ({
  Authorization: `Payaza ${b64(process.env.PAYAZA_PUBLIC_KEY)}`,
  "X-TenantID": process.env.PAYAZA_TENANT || "test",
  "Content-Type": "application/json",
  ...extra, // e.g. { "X-ProductID": "app" } for momo collections
});
export const PAYAZA = "https://api.payaza.africa/live";
```

Smoke test (returns account details, balances, and `payazaAccountReference` per currency):
`GET /payaza-account/api/v1/mainaccounts` with the headers above.

## 2. Collecting the buyer's payment

Two options for the Buyer Portal. Whichever you use, **the webhook is the source of truth**, not the client callback.

### 2a. Checkout Web SDK (hosted modal)

Handles cards, bank transfer (NGN virtual account), and mobile money in one modal. Note the CDN host is **checkout-v2**, and `connection_mode` is the string `"Test"` or `"Live"` (not a `PayazaCheckout.TEST_CONNECTION_MODE` constant).

```html
<script defer src="https://checkout-v2.payaza.africa/js/v1/bundle.js"></script>
<script>
function payInvoice(inv, buyer) {
  const checkout = PayazaCheckout.setup({
    merchant_key: "<PAYAZA_PUBLIC_KEY>",      // raw, NOT Base64
    connection_mode: "Test",                  // "Live" for real money; must match the key's environment
    checkout_amount: Number(checkoutAmount),  // invoice amount converted into currency_code; must be a number, not a string
    currency_code: chosenCurrency,            // Payaza checkout/collections: USD, NGN, GHS, KES, UGX, TZS, ZAR, XOF, ZMW, LRD, CDF, XAF. Stawi also allows EUR and GBP.
    email_address: buyer.email,
    first_name: buyer.firstName,
    last_name: buyer.lastName,
    phone_number: buyer.phone,                // see phone note below
    transaction_reference: `${inv.id}-${inv.attempt}`, // UNIQUE PER ATTEMPT (see below)
    additional_details: { invoice_id: inv.id },        // echoed back in the callback
    // Co-op only, optional: split_accounts: [{ code: "SSA_...", ratio: 5 }, ...] (see §6)
  });
  checkout.setCallback((res) => { /* store res.data.payaza_reference against the collection Transaction */ });
  checkout.setOnClose(() => { /* user closed the modal */ });
  checkout.showPopup();
}
</script>
```

Also available as npm `payaza-web-sdk` (`new PayazaCheckout({... callback, onClose })`). Optional params: `country_code` (CIV/BEN only), `biller_name`, `virtual_account_configuration.expires_in_minutes` (15–480, default 30), `subscription.plan_id`.

Rules that differ from a naive integration:
- **`transaction_reference` must be unique per payment attempt.** Reusing it errors. So do not use the bare Invoice id: use `${invoiceId}-${attempt}` (or a UUID) and keep an attempts table mapping reference → Invoice. Also pass `additional_details.invoice_id`.
- Callback success shape: `{ type: "success", status: 201, data: { payaza_reference, transaction_reference, transaction_fee, transaction_total_amount, currency, customer } }`. Store `payaza_reference` immediately, but the client callback can be intercepted, so never mark an Invoice paid from it.
- Errors surface in the callback as `{ type: "error", status: 400|401, data: { message, errors[] } }` (invalid merchant key, environment mismatch, validation).
- Phone format ⚠️ **CONFIRM**: the docs disagree. The API reference says international format with `+` (`+254712345678`), while its own prose says no `+`. Try `+254…` first, then `254…`.

### 2b. Payment links (no frontend)

Good fit for Stawi invoices: generate one link per Invoice and send it to the buyer. Uses the Base64 public key (headers as §1).

```
POST /payment-link/merchant/create-payment-link
{
  "payment_link_name": "INV-1042",        // unique per account; becomes the URL slug /pay/inv-1042
  "payment_description": "Stawi invoice INV-1042",
  "has_fixed_amount": true,
  "payment_amount": 2500,
  "country_code": "KEN",                  // ISO alpha-3
  "currency_code": "USD",                 // ⚠️ CONFIRM buyer currencies enabled for your account
  "collect_customer_first_and_last_name": true,
  "collect_customer_email": true,
  "collect_customer_phone_number": true,
  "redirect_url": "https://stawi.example/paid",
  "fee_bearer_type": "Business"           // "Business" absorbs the fee; "Customer" adds it on top
}
```

Response: `data.id` (this is `link_id`, **save it**) and `data.link` (permanent shareable URL). Other endpoints, all under `/payment-link/merchant/`: `update-payment-link?link_id=` (PATCH; name cannot change), `deactivate-payment-link?link_id=`, `activate-payment-link?link_id=`, `fetch-payment-links?page=&size=&search=`, `fetch-payment-link-transactions?link_id=&page=`. Transaction statuses: `Completed`, `Failed`, `Initialized`. Fees show up as `transaction_fee_amount` vs `transaction_payable_amount`, which is useful for the Co-op Dashboard's transparent-fee display. Store `link_id` on the Invoice, since the payment-link transactions carry Payaza references, not yours ⚠️ **CONFIRM** how to correlate a webhook back to the link.

### 2c. Mobile money collection (KES)

For collecting from a Kenyan wallet directly. Supported: Kenya (Safaricom M-Pesa, Airtel), Uganda, Tanzania, Ghana, and more; Rwanda is not listed. **Collections outside Nigeria are available on request only** (email support@payaza.africa).

```
POST /subsidiary/collections/v1/process-collection
Headers: Authorization, X-TenantID, X-ProductID: app
{
  "amount": 200,
  "customer_number": "254712345678",     // 12 digits, country code + number, no "+"
  "transaction_reference": "<unique>",
  "transaction_description": "Stawi INV-1042",
  "customer_bank_code": "SAFKEN",        // M-Pesa; Airtel's code is in Payaza's momo codes sheet (linked in the momo guide)
  "currency_code": "KES",
  "country_code": "KE",
  "customer_email": "...", "customer_first_name": "...", "customer_last_name": "...",
  "customer_phone_number": "254712345678"
}
```

- `response_code: "09"` / `PENDING` is the **expected success** response: the USSD prompt was sent. It does not mean paid.
- Confirm via webhook or `GET /subsidiary/collections/v1/check-status?transaction_reference=...&country_code=KE` (same headers). Codes: `00` success, `06`/`96` failed, `09` pending. Statuses: `Initialized` → `Completed`.
- Collections are **not retried**; on failure or timeout create a new `transaction_reference`.
- Mismatched bank code and network can fail silently. The docs' own KES sample oddly uses a `233…` number, so use `254…`.
- There is a "Test Account Funding" endpoint for sandbox collections (see `llms.txt`).

### 2d. Test cards (sandbox only, `Test` mode / `X-TenantID: test`)

| Card | Number | 3DS | CVV |
|---|---|---|---|
| Visa | `4508750015741019` | yes | `100` |
| Mastercard | `5123450000000008` | yes | `100` |
| Mastercard | `5111111111111118` | no | `100` |

The **expiry date picks the outcome**: `01/39` approved, `05/39` declined, `04/27` expired card, `08/28` timed out, `01/37` acquirer system error, `02/37` unspecified failure, `05/37` unknown error.

## 3. Webhooks (server-side confirmation)

Configure separate URLs for Live and Test at **Settings → Developers → Webhooks** (per transaction type). Must be a public HTTPS `POST` endpoint. Payaza sends webhooks for **collections** and **payouts**, including failures.

**Verify every webhook** using the `x-payaza-signature` header: HMAC-SHA512 of the payload with your **secret key** (not Base64), output Base64. Compare and process only on match. Webhooks also carry an auth header with the Base64 public key. Hash the **raw request bytes**, not a re-serialized object.

```js
import crypto from "crypto";
export function verifyPayaza(rawBody, sigHeader, secret) {
  const computed = crypto.createHmac("sha512", secret).update(rawBody, "utf8").digest("base64");
  const a = Buffer.from(computed), b = Buffer.from(sigHeader || "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Express: app.post("/webhooks/payaza", express.raw({ type: "*/*" }), handler)
```

Handler order:
1. Verify the signature. If it fails, respond 401 and stop.
2. Respond `200` immediately, then process asynchronously (recommended practice; not stated in the docs, but slow handlers invite retries and duplicates).
3. **Idempotency:** dedupe on `transaction_reference` (Payaza's own guidance) before creating any Transaction.
4. Match to the Invoice: for Checkout and Virtual Account collections the payload's **`merchant_reference`** is *your* reference; `transaction_reference` may be Payaza's (e.g. `P-C-20260221-…`). So look the Invoice up via `merchant_reference` ⚠️ **CONFIRM** for momo and payment-link events. Fallback: `GET /merchant-collection/transfer_notification_controller/merchant/transaction-query?merchant_reference=<yours>` returns `Initialized | Completed | Failed`.
5. Check `amount_validation` (`EXACT | UNDERPAYMENT | OVERPAYMENT`) and `request_amount` vs `amount_received` before marking paid.
6. Create/update the collection Transaction to `completed`, then trigger conversion and settlement (§7, §8).

Collection payload fields to use: `transaction_reference`, `merchant_reference`, `transaction_status` (`Funds Received` | `Transaction Failed`), `status` (`Completed` | `Failed`), `status_reason`, `amount_received`, `transaction_fee`, `request_amount`, `amount_validation`, `currency_code`, `channel` (e.g. `KENYA_COLLECTIONS`, `Card`, `VirtualAccount`), `customer{}`.

Payout payload fields: `transaction_reference`, `transaction_status` (`NIP_SUCCESS` | `NIP_FAILURE`), `is_reversed`, `response_code`/`response_message`, `amount_received`, `transaction_fee`, `sent_to{}`.

Fallback when a webhook does not arrive: query status by reference (collections: `check-status` / merchant-reference query; payouts: §8 step 4).

## 4. Where the secret key is used

The secret key (never Base64-encoded, backend only) has exactly two jobs: **verifying inbound webhooks** (`x-payaza-signature`, §3) and **signing outbound payout requests** (`X-Payaza-Signature`, optional, §8). Everything else uses the Base64 public key. Neither the secret key nor the PIN ever appears in frontend code.

## 5. Payaza accounts and balances

Your Payaza account holds **one account per currency**, each with its own `payazaAccountReference`. Payouts draw from the account matching the payout currency, and that account must be **funded**.

`GET /payaza-account/api/v1/mainaccounts/merchant/enquiry/main` (headers §1) → array of `{ payazaAccountReference, currency, accountBalance, status, postNoDebit, virtualAccounts[] }`. Pick the entry whose `currency` matches. If `postNoDebit: true`, payouts are blocked (see §8 go-live).

## 6. Split payout for Stawi Co-op: decision ladder

The Co-op flow must divide one collection across farmers by `contribution_share`. Payaza offers three workable paths. **Prefer them in this order:**

### Option A (recommended): one bulk payout with many beneficiaries

The Transfers endpoint accepts a `payout_beneficiaries[]` array, so a single settlement call can pay every farmer their own KES amount. Each beneficiary carries its own `transaction_reference`; the response returns a `batch_reference`. This gives exact, arbitrary per-farmer amounts, one PIN-authorised call, and one `payout` Transaction per farmer.

Constraint: `payout_amount` must equal the sum of all `credit_amount` values (otherwise `Payout amount is less than total credit amount`). Allocate with integer arithmetic so rounding never breaks the sum:

```js
// totalMinor: integer (e.g. cents). shares: [{ id, share }] where share sums to 1.
export function allocate(totalMinor, shares) {
  const rows = shares.map(s => ({ ...s, exact: totalMinor * s.share, amt: Math.floor(totalMinor * s.share) }));
  let rem = totalMinor - rows.reduce((a, r) => a + r.amt, 0);
  [...rows].sort((a, b) => (b.exact - b.amt) - (a.exact - a.amt)).slice(0, rem).forEach(r => r.amt += 1);
  return rows; // sum(rows.amt) === totalMinor
}
```
⚠️ **CONFIRM** whether KES payouts accept decimals or whole shillings only (allocate in whole KES if unsure), and whether webhooks and status queries are per beneficiary `transaction_reference` (assumed) or per batch.

### Option B: Split Settlements at checkout

Payaza can route the remainder of a checkout payment to beneficiary accounts automatically at settlement.
1. `POST /settlement/settlement/merchant/split-account` (headers §1, `X-TenantID`) with `{ account_no, account_name, bank_code, name, email, currency, country, split_type: "PERCENTAGE"|"FLAT", split_value }`. Returns `data.code` (`SSA_...`, **save it**; used in checkout) and `data.id` (integer; used for update/delete). One split account per beneficiary; create once, reuse.
2. Pass `split_accounts: [{ code }]` in the Checkout SDK.
3. Other endpoints: `GET .../split-account?page=&size=`, `PUT .../merchant/split-account/{id}` (set `active:false` to disable), `DELETE .../split-account/{id}`.

**Gotcha: `split_value` is what YOU (the Payaza account owner) keep; the beneficiary receives the remainder.** To give a beneficiary 10%, set `split_value: 90`.

Checkout SDK reference adds `ratio` per split account: an integer where `1` = 10%, and **the ratios must sum to exactly 10**. That means 10% granularity, so exact `contribution_share` values will not fit. The split-settlements guide only shows `code` (no `ratio`), and the SDK page's TypeScript example contains smart quotes, so ⚠️ **CONFIRM** semantics with engineers. Also ⚠️ **CONFIRM** that split accounts work for **KES and M-Pesa** beneficiaries: the docs describe them with bank accounts, NGN, and `NGA`.

### Option C (fallback): per-farmer payout loop

Backend computes each farmer's amount from `contribution_share` and fires one payout call per farmer. Functionally identical for the demo and satisfies the "use of Payaza infrastructure" criterion. Use when Option A is not accepted for KES. Use a unique `transaction_reference` per call so a retry never pays twice.

## 7. Multi-currency conversion ⚠️ CONFIRM

The public docs and the `llms.txt` index contain **no FX or conversion endpoint**. What is documented: accounts are per currency, and payouts are made from the account in the payout currency. So how a buyer's USD (or other) collection becomes KES available for payout, at what rate, and whether it is automatic or a separate step, must come from engineers. Ask before building the Direct settlement step.

Regardless of mechanism, the Transaction record Stawi keeps should log: source currency, source amount, converted currency (KES), converted amount, rate applied, and fee. This feeds the Co-op Dashboard's transparent-fee display.

## 8. Settlement / payout (Stawi Direct, and Co-op Option A)

Flow: (1) optional account-name check, (2) get the KES `payazaAccountReference`, (3) initiate transfer, (4) confirm via webhook or status query.

**Name enquiry is documented for Nigeria (NGN) and Ghana (GHS) only.** There is no documented name enquiry for Kenyan M-Pesa or KES bank accounts, so do not assume onboarding can verify a farmer's or exporter's M-Pesa name via Payaza. ⚠️ **CONFIRM** with engineers; if it is missing, verify at onboarding another way (e.g. user confirms name and number, plus a small test payout). Where it is supported: `POST /payaza-account/api/v1/mainaccounts/merchant/provider/enquiry` with `{ "service_payload": { "currency", "bank_code", "account_number" } }`; always show the resolved name and require confirmation.

```
POST /payout-receptor/payout
Headers: Authorization, X-TenantID, Content-Type
{
  "transaction_type": "mobile_money",     // KES: "mobile_money" (wallet) or "kepss" (bank)
  "service_payload": {
    "payout_amount": 12000,               // = sum of credit_amount
    "transaction_pin": 123456,            // 6-digit integer, from env
    "account_reference": "<KES payazaAccountReference>",
    "currency": "KES",
    "country": "KEN",
    "payout_beneficiaries": [
      {
        "credit_amount": 12000,
        "account_number": "254712345678", // mobile_money: 12 digits (254...); kepss: 10 digits
        "account_name": "Full Name",
        "bank_code": "<from Bank Codes API / sheet>",
        "narration": "Stawi payout",       // <= 25 chars, no special characters
        "transaction_reference": "PAYOUT-INV1042-01", // unique, minimum 10 chars
        "sender": { "sender_name": "...", "sender_phone_number": "...", "sender_address": "...", "sender_id": "" }
      }
    ]
  }
}
```
The KES field values above follow the transfers docs and the XAF mobile-money example. A KES-specific example and the M-Pesa `bank_code` are not shown ⚠️ **CONFIRM** (Bank Codes API: `/api-reference/transfers/bank-codes`).

Responses: single → `response_content.response_status: "TRANSACTION_INITIATED"` (`transaction_status: "09"` = pending). Bulk → `response_content.batch_reference` with `response_code: "09"`. Payouts are **not retried automatically**; your app owns retry logic, and a retry needs a **new** reference unless it is a true duplicate you want rejected.

**Status:** `GET /payaza-account/api/v1/mainaccounts/transaction/status?transaction_reference=<yours>`. Statuses: `TRANSACTION_INITIATED`, `NIP_SUCCESS` (delivered), `NIP_PENDING`, `NIP_FAILURE`, `ESCROW_SUCCESS` (debited, awaiting bank, reversible).

**Signed transfers (optional, needs activation by support):** compute `HMAC-SHA512(secretKey, exactRawJsonBody)` → Base64 and send it as the `X-Payaza-Signature` header alongside the normal `Authorization`. The hashed string must be byte-identical to the body sent (whitespace differences give `Invalid Signature`).

**Go-live checklist for payouts (live only; none of this applies in test):**
- KYB approved; live key generated.
- Server IP(s) whitelisted at Settings → Developers → IP Whitelisting.
- Transaction PIN set (Settings → Profile → Security). 6 digits, no repeated (`111111`), sequential (`123456`), or repeating-pattern (`121212`) digits.
- After setting or resetting the PIN, email support@payaza.africa from the Super Admin address to lift the **PND (Post No Debit)** restriction.
- Cross-border payouts outside Nigeria are **not enabled by default**; email support to activate KES payouts.
- The KES account is funded.

Log each payout as a `settlement` Transaction and then a `payout` Transaction per recipient against the Account.

## 9. Sub-accounts: do NOT use per farmer

The earlier plan to create a Payaza sub-account per CoopMember is **not allowed by Payaza's docs**. Sub-accounts are strictly for **internal business units** (finance, admin, cost centers). Onboarding external customers, clients, or third-party merchants as sub-accounts violates compliance rules and may lead to account suspension. Farmers are external parties, so use Option A or C in §6.

(If Stawi ever needs an internal sub-account: `POST /payaza-account/api/v1/subaccounts/merchant` with `{ mainAccountPayazaReference, name, currency, country }`, and `GET .../subaccounts/merchant/enquiry/{payazaSubAccountReference}`. Store the returned reference immediately.) One inconsistency: the OpenAPI intro text still describes sub-accounts "for your customers", but the guide's compliance language governs. ⚠️ **CONFIRM** if in doubt.

## 10. Errors and pitfalls

| Symptom | Cause / fix |
|---|---|
| `Authentication failed` | Missing header; raw (un-encoded) key; `Bearer` instead of `Payaza`; test key with `X-TenantID: live` (or reverse); key regenerated |
| SDK: "merchant key is not valid" / "Business Profile Credentials does not match connection mode" | Wrong key, or `connection_mode` does not match the key's environment |
| SDK: "'checkout_amount' must be numeric" | Passed a string; use `Number(...)` |
| Duplicate reference (`X03` on payouts; "authentication outcome already associated" on cards) | Reused `transaction_reference`. Generate a fresh one per attempt |
| `Payout amount is less than total credit amount` | `payout_amount` ≠ sum of `credit_amount` |
| `Insufficient Balance` | Fund the payout-currency account |
| `Invalid transaction pin` | Wrong PIN |
| `Bank code is not correct` (`X02`) | Wrong `bank_code`; check the Bank Codes API |
| Payouts blocked | `postNoDebit: true` (PND not lifted) or IP not whitelisted (live) |
| Collection stuck `09` | Normal for pending; wait for webhook or poll status |
| Split account `code 96` | Percentage outside 0–100, or duplicate split account for that bank account |

General rules: unique reference per attempt (UUID or timestamp-prefixed), Base64 for REST but raw for the Web SDK, match key environment to `X-TenantID`, and email support@payaza.africa with the `transaction_reference` and full error body when stuck.

## 11. Sandbox testing

Use Test mode throughout Build Day: test key, `X-TenantID: test`, `connection_mode: "Test"`. Test payments and payouts are not processed or settled; IP whitelisting is not enforced. Use the test cards in §2d. Sandbox helpers: Fund Test Virtual Account (NGN) and momo Test Account Funding. Switch to live keys only if engineers confirm it is needed for Demo Day and safe with small real amounts.

## 12. Ask Payaza engineers on Build Day

1. How does buyer-currency → KES conversion work (automatic or explicit call, rate source, fee), and where does the converted KES land?
2. Is the KES payout account enabled and fundable in sandbox, and are cross-border/KES payouts activated for our account?
3. Correct `bank_code` and payload for a KES **M-Pesa** payout; are decimals allowed?
4. Does a bulk payout (multiple `payout_beneficiaries`) fire webhooks and status per beneficiary reference or per batch?
5. Do split accounts and checkout `split_accounts[].ratio` support KES/M-Pesa beneficiaries, and is `ratio` (sum = 10) the intended contract?
6. Is there any name-enquiry for M-Pesa/KES accounts?
7. Which reference does each webhook type put in `transaction_reference` vs `merchant_reference` (checkout, payment link, momo)?
8. Can the signed-transfer header (`X-Payaza-Signature`) be activated for our account?
9. Which buyer currencies (KES, USD, others) are enabled for Checkout and Payment Links, and does the SDK `phone_number` want `+`?
10. Where do we generate the secret key used for HMAC (webhook and signed transfers)?
