# Stawi — Build Specification

Event: Borderless Kenya (Payaza x Hackhouse Nairobi x Africa Tech Academy)
Team: LESOM · Product: Stawi Direct + Stawi Co-op

## 1. Product overview

Stawi replaces a slow, manual, fee-heavy cross-border collection process with one transparent, automatic flow, in two shapes:

- **Stawi Direct**: a solo Kenyan exporter (agriculture, crafts, digital services) sends a Payaza checkout instead of a bank wire request. Buyer pays in their own currency → Stawi converts to KES → the exporter's balance is credited, then they withdraw.
- **Stawi Co-op**: a Kenyan export co-op (coffee, tea, macadamia, flowers) collects once from a buyer. Same pipe as Direct, plus one step — Stawi splits the converted net across the farmers on that shipment, by kilos, into their Stawi balance, and Payaza pays each farmer who has a verified destination when the treasurer approves. Payaza sub-accounts are not used for farmers.

Both products share one backend, one data model, and one payment integration layer. Co-op is Direct with a split step inserted before payout.

## 2. Personas

| Persona | Role | Primary surface |
|---|---|---|
| Solo exporter | Sends invoices, receives payout | Farmer/Exporter Account app |
| Co-op treasurer | Manages farmer roster, sends invoices, tracks metrics | Co-op Dashboard |
| Farmer (co-op member) | Views balance/status, withdraws payout | Farmer/Exporter Account app (webapp + USSD/SMS) |
| International buyer | Pays the invoice | Buyer/Payer Portal |

Note: "Farmer/Exporter Account app" is one surface serving two personas (solo exporter, co-op farmer) — same account model, same screens, the only difference is whether the account is linked to a `coop_id`.

## 3. Data model (shared source of truth)

See `skills/stawi-domain/SKILL.md` for entities, the pipeline, auth, and every route. Summary:

- **Account** — a payee (solo exporter, farmer, or treasurer). Phone, national ID, M-Pesa, other mobile-money (`momo`), and/or bank destinations, `channel_capability` (`webapp` or `webapp+ussd`), a 4-digit PIN, `balance_kes_cents`, and `incoming_kes_cents`. Sample funds sit in `demo_balance_kes_cents` and are not sent through sandbox or live Payaza payouts.
- **Coop** — a named group with one treasurer Account.
- **CoopMember** — links an Account to a Coop with a `contribution_share` (a percentage from 0 to 100; the roster total may pass 100) and optional kilos. A shipment pays the farmers selected for that lot. Their kilos must add up to the shipment quantity before the draft can move on.
- **Invoice** — Direct (one account) or Co-op. Buyer, amount, currency, reference, and a status from `pending` through `completed` or `failed`.
- **Transaction** — append-only steps on an invoice: collection, conversion, settlement. Fee is integer KES cents on conversion and settlement.
- **Shipment** — a co-op lot, or a Direct exporter's own lot. The split pays the farmers listed on it, weighted by kilos. `buyer_code` opens `/buyer?code=`.
- **Payout** — money for one account. `credit` lands in the Stawi balance. On co-op approval, a verified destination is paid through Payaza in the same step. `withdrawal` sends whatever balance remains to M-Pesa, another wallet, or a bank.
- **Payment proof** — a bank-transfer receipt the buyer submits. Confirming it records the collection the same way a Payaza webhook does.

## 4. The two flows, step by step

### Stawi Direct
1. Exporter creates an Invoice (amount, currency, buyer). That also opens their shipment. Checkout is `POST /invoices/{id}/checkout-session`.
2. Buyer pays in the Buyer Portal through the Payaza Web SDK, or submits a bank-transfer proof that the exporter confirms. Payaza's webhook, a confirmed proof, or `POST /dev/simulate-payment/{id}` in mock mode records a collection.
3. Stawi converts to KES from the Frankfurter cache (`FX_FEED`, default on) and takes a 0.8% fee. `FX_FEED=off`, a failed fetch, or a missing code uses the illustrative table in `backend/src/services/money.ts`. Payaza publishes no FX endpoint.
4. Stawi credits the exporter at once: one confirmed `credit` payout, and `balance_kes_cents` increases by the net.
5. The exporter withdraws to a verified M-Pesa, other mobile-money, or bank destination with a PIN. That withdrawal is a Payaza payout.

### Stawi Co-op
Steps 1–3 are the same, with the invoice tied to a co-op and to a shipment. Then:
4. Status becomes `settling`. The net is booked to `incoming_kes_cents` for the farmers on that shipment, weighted by kilos. A roster member who is not on the shipment is not paid. Nothing is spendable yet.
5. The treasurer reviews the split and calls `POST /invoices/{id}/approve-split` with their PIN. `splitByKilos` uses largest-remainder so the lines sum exactly to the net. Stawi writes one confirmed `credit` payout per shipment farmer, moves incoming into balance, and calls Payaza once per farmer who has a verified destination. Mock confirms that transfer. Sandbox and live stay `sent` until the payout webhook. A farmer with no destination keeps the credit. A second approval is rejected.
6. Each farmer withdraws whatever remains on the web app or USSD, same endpoint, same balance.

## 5. Three surfaces

### 5a. Farmer/Exporter Account surface (webapp + USSD/SMS parity)
**Onboarding (webapp only):** name, ID, phone, payout destination (M-Pesa, other mobile money, or bank), linked coop (if any) and contribution share. The share is the roster figure. The payout uses shipment kilos.

**Ongoing use (webapp AND USSD/SMS — same account, same data):**
1. View Stawi account details / balance
2. View status of transactions (pending / converted / paid, with amount and Invoice reference)
3. Withdraw to an approved account when funds have arrived

USSD/SMS is not a separate account — it's a second read/write channel onto the exact same Account record. See `skills/africas-talking/SKILL.md` for the channel-parity menu design.

### 5b. Co-op Dashboard surface (treasurer-facing)
- **Invoicing**: create an Invoice for a shipment, see its checkout link/status
- **Roster management**: add, import, and edit farmer accounts. Each `contribution_share` stays between 0 and 100. The roster total may pass 100. It is not the invoice split.
- **Shipments**: the lot lists the farmers and their kilos. Those kilos are the split. A draft cannot advance until they sum to `quantity_kg`.
- **Metrics**: total collected, total split, per-farmer payout history, average time-to-payout, and the 0.8% fee, on the dashboard.
- **Split review**: the treasurer sees the per-farmer lines, then approves with a PIN. Approval is what sends the Payaza transfers.

### 5c. Buyer/Payer Portal surface
- Open `/pay/:invoiceId` or `/buyer?code={buyer_code}`
- Pay via the Payaza Web SDK in the currency they choose
- Or submit a bank-transfer proof (payer, reference, amount, optional receipt). The payee confirms or rejects it. Confirming records the collection.
- See payment confirmation and the receipt once a collection has completed

## 6. Revenue model (make this visible, not just described)

The fee is 0.8% of the converted gross, in integer KES cents, shown on the co-op metrics and on the invoice breakdown. It is the price on the screen, in place of a spread the exporter only sees after a wire lands short.

## 7. Tech stack

- Backend: Node, Express, TypeScript (`backend/`). Postgres when `DATABASE_URL` is set; memory otherwise.
- Frontend: the Lovable app at the repo root (TanStack Start). It calls this API. It does not call Payaza or Africa's Talking except the Payaza Web SDK on the buyer page.
- USSD and SMS: the same backend (`backend/src/ussd/`, `backend/src/services/notify.ts`).
- Payments: `backend/src/services/payaza.ts` only. FX quotes: `backend/src/services/fx.ts` (Frankfurter).

## 8. What shipped

The contract is `skills/stawi-domain/SKILL.md`. In short:

1. Direct and Co-op run on one pipeline: collection, Frankfurter (or fallback) conversion, 0.8% fee, then credit.
2. Co-op splits by shipment kilos (`splitByKilos`), after the treasurer's PIN. Payaza then transfers to each farmer with a verified destination.
3. The buyer can pay in the Payaza Web SDK or submit a bank-transfer proof the payee confirms.
4. Web and USSD read the same balance and call the same withdraw.
5. Co-op metrics show the fee. Sample rows are `is_demo` and follow the Demo Data switch.

## 9. What a live pilot still checks

- A sandbox or live Payaza checkout completes and the webhook credits the invoice. Mock mode already simulates this.
- A sandbox or live payout on split approval, and on withdrawal, reaches M-Pesa or a bank. The calls exist; `PAYAZA_MODE` selects them.
- KES checkout and the M-Pesa payout bank code (`PAYAZA_MPESA_BANK_CODE`, default `SAFKEN`) are accepted by that Payaza account.
- Africa's Talking live shortcode and sender ID, once approved.
- Whether holding a balance after the split needs a Kenyan authorisation. Farmers with a destination are already paid at approval.

## 10. Environment

See `backend/.env.example`. The ones that change behaviour:

- `PAYAZA_MODE` `mock` | `sandbox` | `live`, plus `PAYAZA_PUBLIC_KEY`, `PAYAZA_SECRET_KEY`, `PAYAZA_PIN`
- `PAYAZA_MPESA_BANK_CODE` (default `SAFKEN`), `PAYAZA_MOMO_BANK_CODE` for other wallets, `PAYAZA_BANK_CODE` for KEPSS
- `FX_FEED` (`frankfurter` or `off`), `FX_CACHE_TTL_MS` (default 6 hours)
- `AT_ENV`, `AT_USERNAME`, `AT_API_KEY`, `AT_CALLBACK_SECRET`, `AT_USSD_SERVICE_CODE`, `AT_USSD_SESSION_TTL_MS`, `AT_USSD_RATE_LIMIT`
- `DATABASE_URL`, `SEED`, `DEMO_DATA_ENABLED`, `AUTH_REQUIRED`, `MASTER_LOGIN_CODE`, `ADMIN_SECRET`
- Demo ledger: `backend/src/data/catalog.ts` (see `docs/SCAFFOLD.md`). 4 co-ops, 76 farmers, 6 exporters, PIN `1234`. `GET /dev/seed-ids` returns the Kiambu ids.
