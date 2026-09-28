# Stawi — Build Specification

Event: Borderless Kenya (Payaza x Hackhouse Nairobi x Africa Tech Academy)
Team: LESOM · Product: Stawi Direct + Stawi Co-op

## 1. Product overview

Stawi replaces a slow, manual, fee-heavy cross-border collection process with one transparent, automatic flow, in two shapes:

- **Stawi Direct**: a solo Kenyan exporter (agriculture, crafts, digital services) sends a Payaza checkout link instead of a bank wire request. Buyer pays in their own currency → multi-currency converts to KES → settlement pays the exporter same-day.
- **Stawi Co-op**: a Kenyan export co-op (coffee, tea, handicrafts) collects once from a buyer. Same pipe as Direct, plus one step — Payaza sub-accounts split the converted total across each farmer's contribution share and pay every farmer out same-day.

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

See `skills/stawi-domain/SKILL.md` for the full entity definitions and internal API contract. Summary:

- **Account** — a payee (solo exporter or farmer). Has a phone number, ID, payout destination (M-Pesa or bank), and a `channel_capability` flag (webapp-only vs webapp+USSD/SMS).
- **Coop** — a group of Accounts with one treasurer Account.
- **CoopMember** — links an Account to a Coop with a `contribution_share` (percentage).
- **Invoice** — a request for payment, tied either to a solo Account or to a Coop. Holds buyer info, amount, currency, status.
- **Transaction** — every step of the money's journey: collection (buyer paid), conversion (FX applied), settlement (money moved to Stawi's holding), payout (money moved to a specific Account). Each has a Payaza reference where applicable.
- **Payout** — the terminal transaction to a specific Account, with destination and status (pending/sent/confirmed).

## 4. The two flows, step by step

### Stawi Direct
1. Exporter creates an Invoice (amount, currency, buyer email) via the Farmer/Exporter Account app or Co-op Dashboard equivalent.
2. Backend creates a Payaza checkout session for that Invoice; buyer receives a link.
3. Buyer opens the Buyer Portal, pays via Payaza checkout in their own currency.
4. Payaza webhook notifies the backend of a successful collection → Transaction (collection) created.
5. Backend triggers multi-currency conversion to KES → Transaction (conversion) created.
6. Backend triggers settlement to the exporter's Account → Transaction (settlement) + Payout created.
7. Exporter sees the Payout land in their account balance/status (webapp or USSD).

### Stawi Co-op
Same as steps 1–5 above, with the Invoice tied to a Coop instead of a solo Account, then:
6. Backend fetches all CoopMembers for that Coop and their `contribution_share`.
7. Backend calls Payaza's sub-account split (see `skills/payaza/SKILL.md`) to divide the converted total across each member's Payout, proportional to share.
8. Each farmer's Payout is created and settled to their individual destination.
9. Each farmer sees their own Payout land — same UI/USSD experience as Direct, just smaller individual amounts with a shared Invoice reference.

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
- A seeded co-op with 8–10 fake farmer Accounts for the demo (contribution shares summing to 100%)
