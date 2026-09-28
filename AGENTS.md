<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Lovable (frontend)

Leave the block above unchanged. Lovable may rewrite the text between `LOVABLE:BEGIN` and `LOVABLE:END`.

- Protected areas (/app, /coop, /direct) wrap their layout in RoleGate; in mock mode it auto-signs in the demo role so every screen is reviewable.
- Invoice UI shared between co-op and direct dashboards lives in src/features/shared (table, new-invoice sheet, detail view) to avoid drift.
- All reads go through queryOptions in src/lib/queries.ts so keys stay consistent across screens.
- Lovable edits the frontend only. Do not edit `backend/` or `docs/`.

## Other coding agents (backend and docs)

This section is the shared brief for Cursor, Claude Code, and Codex. The same text is in `CLAUDE.md` and `.cursorrules`. Lovable should ignore it.

Scope: `backend/` and `docs/`. Do not edit the Lovable frontend (repo root `src/` and the rest of the Lovable app). GitHub sync is two-way and overlapping edits conflict.

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
