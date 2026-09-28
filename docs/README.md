# Stawi — Build Docs Index

**Stawi is two products on one rail:**
- **Stawi Direct** — one exporter, one buyer. Checkout → multi-currency → settlement. Guaranteed baseline.
- **Stawi Co-op** — one co-op, many farmers. Same pipe, +1 step: sub-accounts split the settlement across farmer shares. Stretch build.

This folder is the full context set for building Stawi end-to-end with AI coding agents (Lovable, Claude Code, Cursor, Codex). Hand each agent the files relevant to what it's building — don't dump the whole folder into every prompt; point each agent at its own slice plus `00-BUILD-SPEC.md` for shared context.

## Files

| File | What it's for | Give it to |
|---|---|---|
| `00-BUILD-SPEC.md` | Master spec: personas, data model, both flows, three surfaces, build order, acceptance criteria | Every agent, first |
| `skills/stawi-domain/SKILL.md` | Stawi's own internal API contract + shared account/channel-parity model | Whichever agent builds the backend — this is the source of truth every other surface must match |
| `skills/payaza/SKILL.md` | Payaza checkout / multi-currency / settlement / sub-accounts integration patterns | Backend agent, and whichever agent wires up payment calls |
| `skills/africas-talking/SKILL.md` | USSD + SMS integration for the farmer 2G channel | Backend agent building the USSD webhook + SMS notifications |

## Recommended split across agents

- **Backend/API agent (Claude Code or Cursor):** `00-BUILD-SPEC.md` + `skills/stawi-domain/SKILL.md` + `skills/payaza/SKILL.md` + `skills/africas-talking/SKILL.md`. Build the internal API first — everything else depends on it.
- **Farmer/exporter webapp (Lovable):** `00-BUILD-SPEC.md` (Farmer/Exporter Account Surface section) + `skills/stawi-domain/SKILL.md` (API contract section only). It talks to the backend's REST API — it does not call Payaza or Africa's Talking directly.
- **Co-op dashboard (Lovable or Cursor):** same as above, but the Co-op Dashboard Surface section.
- **Buyer/payer portal (Lovable):** same pattern, Buyer Portal Surface section — this is the only frontend surface that embeds the Payaza checkout widget directly (see `skills/payaza/SKILL.md` → Web Checkout).
- **USSD/SMS layer (Codex or Cursor, small isolated service):** `skills/africas-talking/SKILL.md` only, plus the API contract from `skills/stawi-domain/SKILL.md`. This is a thin adapter — it should call the same internal API the webapp calls, never Payaza directly.

## The one rule that keeps every agent in sync

**One account, one identity, two channels.** A farmer's balance, transaction history, and withdrawal options must be byte-for-byte the same whether read from the webapp or from a USSD session. That's only possible if every surface reads and writes through the single internal API defined in `skills/stawi-domain/SKILL.md` — no surface should keep its own copy of account state. If an agent starts building a local mock of account data instead of calling the shared API, stop it and point it back here.

## Known unknowns — verify these on Build Day before building on top of them

Payaza's public docs are Nigeria/NGN-centric in places. Before either payment agent writes code against these, get written confirmation from Payaza's engineers (on hand at Build Day) on:
1. Exact sub-account creation + split request/response schema (this is Stawi Co-op's one differentiating feature — verify first)
2. Whether KES-denominated checkout/multi-currency is live in sandbox today, or only NGN
3. Mobile money collection coverage for the corridor you're demoing (Kenya confirmed; Rwanda not confirmed as of last check)

Don't let an agent hallucinate a plausible-looking endpoint for these — get the real schema from Payaza's Postman collection/sandbox docs first, then feed it back into `skills/payaza/SKILL.md` as a correction.
