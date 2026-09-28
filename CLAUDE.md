# Stawi — instructions for AI coding agents (backend work)

Scope: this file governs `backend/` and `docs/`. **Never edit the Lovable frontend (repo root `src/` etc.)** — it is generated and edited in Lovable; GitHub sync is two-way and overlapping edits conflict.

Read first: `docs/README.md`, `docs/00-BUILD-SPEC.md`, `docs/SCAFFOLD.md`, then the skill for your task:

- `docs/skills/stawi-domain/SKILL.md` — data model + API contract
- `docs/skills/payaza/SKILL.md` — checkout, conversion, settlement, sub-accounts
- `docs/skills/africas-talking/SKILL.md` — USSD + SMS (sandbox and live)

Rules

1. Stawi is two products on one rail: **Direct** (one exporter) and **Co-op** (split to many farmers). Same pipeline; Co-op adds the split step.
2. One account, two channels. Web and USSD read/write through the same services. Never duplicate account state.
3. Only `backend/src/services/payaza.ts` talks to Payaza; only backend code talks to Africa's Talking. The frontend never does.
4. Money is integer KES cents. Never floats. Splits use largest-remainder so shares sum exactly.
5. Money-moving endpoints are idempotent and PIN-protected where a user initiates them.
6. Don't invent Payaza endpoints. Unknowns are TODOs in `payaza.ts`; resolve from Payaza's sandbox docs, then update the skill file.
7. Env-switchable everywhere (`PAYAZA_MODE`, `AT_ENV`). No hardcoded sandbox values.
8. Contract changes: update `backend/src/types.ts` and `docs/LOVABLE_PROMPT.md` §8 together, and tell the frontend owner.
9. Run `npm run typecheck && npm test` and `scripts/e2e.py` before finishing.
