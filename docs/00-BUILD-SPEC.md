# Stawi — Build Specification

Event: Borderless Kenya (Payaza x Hackhouse Nairobi x Africa Tech Academy)
Team: LESOM · Product: Stawi Direct + Stawi Co-op

## 1. Product overview

Stawi replaces a slow, manual, fee-heavy cross-border collection process with one transparent, automatic flow, in two shapes:

- **Stawi Direct**: a solo Kenyan exporter (agriculture, crafts, digital services) sends a Payaza checkout link instead of a bank wire request. Buyer pays in their own currency → multi-currency converts to KES → settlement pays the exporter same-day.
- **Stawi Co-op**: a Kenyan export co-op (coffee, tea, macadamia, flowers) collects once from a buyer. Same pipe as Direct, plus one step — Stawi splits the converted net across each farmer's contribution share into their Stawi balance. The farmer withdraws to M-Pesa or a bank. Payaza sub-accounts are not used for farmers.

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

- **Account** — a payee (solo exporter, farmer, or treasurer). Phone, national ID, M-Pesa and/or bank destinations, `channel_capability` (`webapp` or `webapp+ussd`), a 4-digit PIN, `balance_kes_cents`, and `incoming_kes_cents`.
- **Coop** — a named group with one treasurer Account.
- **CoopMember** — links an Account to a Coop with a `contribution_share` (percentage, summing to 100) and optional kilos.
- **Invoice** — Direct (one account) or Co-op. Buyer, amount, currency, reference, and a status from `pending` through `completed` or `failed`.
- **Transaction** — append-only steps on an invoice: collection, conversion, settlement. Fee is integer KES cents on conversion and settlement.
- **Payout** — money for one account. `credit` lands in the Stawi balance. `withdrawal` sends that balance to M-Pesa or a bank.

## 4. The two flows, step by step

### Stawi Direct
1. Exporter creates an Invoice (amount, currency, buyer) and the backend opens a Payaza checkout session.
2. Buyer pays in the Buyer Portal. Payaza's webhook (or `POST /dev/simulate-payment/{id}` in mock mode) records a collection.
3. Stawi converts to KES at its illustrative rate and takes a 0.8% fee. There is no documented Payaza FX endpoint.
4. Stawi settles immediately: one credit payout, and the exporter's `balance_kes_cents` increases by the net.
5. The exporter withdraws to a verified M-Pesa or bank destination with a PIN. That withdrawal is the Payaza payout.

### Stawi Co-op
Steps 1–3 are the same, with the invoice tied to a co-op. Then:
4. Status becomes `settling`. Each member's net share is added to `incoming_kes_cents`. Nothing is spendable yet.
5. The treasurer reviews the split and calls `POST /invoices/{id}/approve-split` with their PIN. Stawi allocates with largest-remainder so the lines sum exactly to the net, writes one credit payout per member, and moves incoming into balance.
6. Each farmer withdraws on the web app or USSD, same endpoint, same balance. A second approval is rejected.

## 5. Three surfaces

### 5a. Farmer/Exporter Account surface (webapp + USSD/SMS parity)
**Onboarding (webapp only):** name, ID, phone, payout destination (M-Pesa/bank), linked coop (if any) and contribution share.

**Ongoing use (webapp AND USSD/SMS — same account, same data):**
1. View Stawi account details / balance
2. View status of transactions (pending / converted / paid, with amount and Invoice reference)
3. Withdraw to an approved account when funds have arrived

USSD/SMS is not a separate account — it's a second read/write channel onto the exact same Account record. See `skills/africas-talking/SKILL.md` for the channel-parity menu design.

### 5b. Co-op Dashboard surface (treasurer-facing)
- **Invoicing**: create an Invoice for a shipment, see its checkout link/status
- **Roster management**: add/edit farmer Accounts, payout destinations, contribution shares (must sum to 100% per active Invoice — validate this)
- **Metrics**: total collected, total split, per-farmer payout history, average time-to-payout, fee taken (make the fee visible here — it's the revenue-model answer)
- **Split review**: treasurer sees the calculated per-farmer split before it fires (a manual approve step, not silent automation) — this is a trust feature worth calling out to judges

### 5c. Buyer/Payer Portal surface
- View the invoice (amount, currency, what it's for)
- Pay via embedded Payaza checkout widget
- See payment confirmation
- (stretch, optional) confirm goods received, gating payout release

## 6. Revenue model (make this visible, not just described)

A transparent transaction fee on the converted amount (illustrative: 0.5–1%), framed as replacing — not adding to — the hidden spread the exporter/co-op already loses to banks/intermediaries today. Show this fee line item explicitly in the Co-op Dashboard metrics and in the Invoice breakdown, so judges can see pricing is real and disclosed, not hidden.

## 7. Tech stack (flexible — adjust to what the team already knows fastest)

- Backend/internal API: Node (Express/Fastify) or Python (FastAPI) — whichever the team is fastest in
- Database: Postgres (or SQLite for the hackathon if time-constrained — schema is the same)
- Frontend (Farmer app, Co-op Dashboard, Buyer Portal): React/Next.js, built via Lovable where possible
- USSD/SMS adapter: thin Node/Python service, calls the internal API, never Payaza directly
- Payments: Payaza sandbox (see `skills/payaza/SKILL.md`)
- 2G channel: Africa's Talking sandbox (see `skills/africas-talking/SKILL.md`)

## 8. Build order for today

1. **Internal API first** — Account, Invoice, Transaction, Payout models + CRUD, before any UI. Every surface depends on this.
2. **Stawi Direct end-to-end, live** — one exporter, one buyer, real Payaza sandbox checkout → conversion → settlement call. This is the guaranteed baseline — do not move on until this actually works with real API calls.
3. **Buyer Portal + Co-op Dashboard (thin versions)** — enough UI to demo the Direct flow live.
4. **Stawi Co-op stretch** — sub-account split, farmer roster, per-farmer payout. Layer this on top of the working Direct pipe.
5. **USSD/SMS channel parity** — wire the same three farmer actions (balance, status, withdraw) into a USSD menu via Africa's Talking's sandbox simulator. Label this clearly as a live sandbox simulation in the demo, not a real telco integration.
6. **Metrics + fee display on Co-op Dashboard** — answers the revenue-model question directly.
7. Polish only after all of the above genuinely work — a rough UI with real API calls beats a polished UI with fake data.

## 9. Acceptance criteria (what "done enough to demo" looks like)

- [ ] A real Payaza sandbox checkout link can be created and paid
- [ ] A real conversion + settlement call completes and is visible in Transaction history
- [ ] At least one real sub-account split payout completes (Co-op stretch)
- [ ] Farmer can see balance + transaction status on webapp
- [ ] Farmer can see the same balance + transaction status via a USSD sandbox session (even if only 1–2 of the 3 actions are wired)
- [ ] Co-op Dashboard shows the fee/revenue line item explicitly
- [ ] Buyer Portal takes a real payment via embedded checkout

## 10. Environment / config checklist

- `PAYAZA_PUBLIC_KEY`, `PAYAZA_SECRET_KEY` (sandbox) — from Payaza engineers on Build Day
- `PAYAZA_WEBHOOK_URL` — publicly reachable (ngrok for local dev)
- `AT_USERNAME=sandbox`, `AT_API_KEY` — from Africa's Talking dashboard
- `AT_USSD_CALLBACK_URL` — registered in the AT sandbox app's USSD channel settings
- Database connection string
- Demo ledger from `backend/src/data/catalog.ts` (see `docs/SCAFFOLD.md`, Demo seed): 4 co-ops, 76 farmers, 6 exporters, PIN `1234`. Each co-op's contribution shares sum to 100%. `GET /dev/seed-ids` still returns the original Kiambu 10.
