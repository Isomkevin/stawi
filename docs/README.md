# Stawi — Build Docs Index

**Stawi is two products on one rail:**
- **Stawi Direct** — one exporter. Checkout, convert to KES, credit their balance, then they withdraw.
- **Stawi Co-op** — same pipe, plus a treasurer-approved split by the kilos on that shipment. Payaza then pays each farmer who has a verified destination. A farmer with no destination keeps the credit and withdraws the same way as Direct. Farmers are Stawi accounts, not Payaza sub-accounts.

This folder is the full context set for building Stawi end-to-end with AI coding agents (Lovable, Claude Code, Cursor, Codex). Hand each agent the files relevant to what it's building — don't dump the whole folder into every prompt; point each agent at its own slice plus `00-BUILD-SPEC.md` for shared context.

## Files

| File | What it's for | Give it to |
|---|---|---|
| `00-BUILD-SPEC.md` | Product spec: personas, both flows as shipped, surfaces | Every agent, first |
| `SCAFFOLD.md` | Repo layout, how to run, how money/auth/storage/USSD work, and the demo seed | Anyone running or changing the backend |
| `skills/stawi-domain/SKILL.md` | Data model, pipeline, auth rules, and the HTTP contract. If it disagrees with `backend/`, the code wins and this file should be fixed | Every surface |
| `skills/payaza/SKILL.md` | Payaza checkout / multi-currency / settlement / sub-accounts integration patterns | Backend agent, and whichever agent wires up payment calls |
| `skills/africas-talking/SKILL.md` | USSD + SMS integration for the farmer 2G channel | Backend agent building the USSD webhook + SMS notifications |

## Recommended split across agents

- **Backend/API agent (Claude Code or Cursor):** `00-BUILD-SPEC.md` + `skills/stawi-domain/SKILL.md` + `skills/payaza/SKILL.md` + `skills/africas-talking/SKILL.md`. Build the internal API first — everything else depends on it.
- **Farmer/exporter webapp (Lovable):** `00-BUILD-SPEC.md` (Farmer/Exporter Account Surface section) + `skills/stawi-domain/SKILL.md` (API contract section only). It talks to the backend's REST API — it does not call Payaza or Africa's Talking directly.
- **Co-op dashboard (Lovable or Cursor):** same as above, but the Co-op Dashboard Surface section.
- **Buyer/payer portal (Lovable):** Buyer Portal Surface section. This is the frontend surface that opens the Payaza Web SDK, and the one that accepts a bank-transfer proof (`/buyer?code=`). See `skills/payaza/SKILL.md` and the payment-proof routes in `skills/stawi-domain/SKILL.md`.
- **USSD/SMS** lives in the same backend (`backend/src/ussd/handler.ts`), not a second service. `skills/africas-talking/SKILL.md` plus the domain contract. It reads the same accounts as the web app and never calls Payaza itself.

## The one rule that keeps every agent in sync

**One account, one identity, two channels.** A farmer's balance, transaction history, and withdrawal options must be byte-for-byte the same whether read from the webapp or from a USSD session. That's only possible if every surface reads and writes through the single internal API defined in `skills/stawi-domain/SKILL.md` — no surface should keep its own copy of account state. If an agent starts building a local mock of account data instead of calling the shared API, stop it and point it back here.

## Decisions already in the code

Payaza's public docs are Nigeria/NGN-centric in places. These choices are shipped:

1. **Ledger split, then one Payaza transfer per farmer.** Sub-accounts are for internal business units. Stawi splits by shipment kilos and pays a verified M-Pesa, other wallet, or bank destination when the treasurer approves, and again when someone withdraws a remaining balance. See `skills/payaza/SKILL.md` and `skills/stawi-domain/SKILL.md`.
2. **FX is Frankfurter, not Payaza.** Payaza has no documented FX endpoint. `FX_FEED` (default `frankfurter`) caches a v2 quote. A failed fetch or `FX_FEED=off` records the illustrative table (USD 129, EUR 142, GBP 168, KES 1, plus the other checkout rates in `money.ts`).
3. **Still confirm on a live Payaza account.** KES checkout and the M-Pesa payout bank code (`PAYAZA_MPESA_BANK_CODE`, default `SAFKEN`) before calling a live payment successful. Kenya collection is the intended corridor.

Don't invent a Payaza endpoint. Mark it TODO in `backend/src/services/payaza.ts`, confirm it against Payaza's sandbox docs, then update `skills/payaza/SKILL.md`.
