# Stawi — repository layout and how the pieces connect

**Frontend = the Lovable project at the repo root (as generated). Backend = the `backend/` folder, deployed separately. They talk only over HTTPS.**

```
<your-lovable-repo>/
├─ src/ public/ index.html package.json ...   Lovable frontend (unchanged; edit via Lovable)
├─ backend/                                    Express + TypeScript API — its own package.json, deployed on its own
│  ├─ src/services/money.ts                    toKesCents, feeCents, splitByShares (largest-remainder, exact sums) + tests
│  ├─ src/services/pipeline.ts                 collection -> conversion -> credit (Direct) | approve split (Co-op); withdraw()
│  ├─ src/services/payaza.ts                   THE ONLY file that talks to Payaza. mock works; sandbox/live are marked TODO
│  ├─ src/services/notify.ts                   Africa's Talking SMS (best-effort; dry-run without a key)
│  ├─ src/services/pin.ts                      bcrypt PIN, 5 attempts then 15 min lockout
│  ├─ src/ussd/handler.ts                      USSD menu (balance / status / withdraw + PIN), secret-checked callback
│  ├─ src/routes/index.ts                      REST API (the contract in docs/LOVABLE_PROMPT.md §8)
│  ├─ src/types.ts                             Domain types (money = integer cents) — mirror in the frontend
│  ├─ src/store.ts, src/data/seed.ts           In-memory store; seeds a 10-farmer co-op + solo exporter (PIN 1234)
│  ├─ db/schema.sql                            Postgres schema for the store swap
│  ├─ scripts/e2e.py                           17-check end-to-end verification
│  ├─ Dockerfile, .env.example
├─ render.yaml                                 One-click Render blueprint for backend/ (optional)
├─ docs/                                       Specs, skills, Lovable prompt (this folder)
└─ AGENTS.md / CLAUDE.md / .cursorrules        Rules for coding agents (backend work)
```

## Connect them
1. **Deploy `backend/`** (Render blueprint, Railway, or Fly — root directory `backend`). Set env vars from `backend/.env.example`. Health check: `GET /health`.
2. **Allow your frontend**: add its origin to `CORS_ORIGIN` (comma-separated; `*.lovable.app` style wildcards work).
3. **Point the frontend at it**: in Lovable set `VITE_API_MODE=live` and `VITE_API_BASE_URL=https://<your-api-domain>` (no trailing slash).
4. **Register callbacks with the deployed URL**: Africa's Talking USSD -> `https://<api>/ussd/callback?s=<AT_CALLBACK_SECRET>`; Payaza webhook -> `https://<api>/webhooks/payaza`.

Backend changes happen in `backend/` (Claude Code / Cursor / Codex). Frontend changes happen in Lovable. **Tell Lovable never to touch `backend/`, and never edit frontend files from the backend agent** — GitHub sync is two-way and overlapping edits cause conflicts.

## Run the backend locally (mock mode, no keys)
```bash
cd backend && cp .env.example .env && npm install
PORT=4100 AT_CALLBACK_SECRET=s3cret npm run dev          # terminal 1 (seeds demo data, PIN 1234)
python3 scripts/e2e.py http://localhost:4100 s3cret        # terminal 2 -> ALL PASSED
npm test                                                   # unit tests
```
Simulate a buyer paying in mock mode: `POST /dev/simulate-payment/:invoiceId`, then for co-op invoices `POST /invoices/:id/approve-split`. `GET /dev/seed-ids` returns the seeded co-op/treasurer/exporter IDs. Those `/dev/*` routes exist only when `PAYAZA_MODE=mock`.

## Verified vs still yours to do
Verified (production build, `node dist`): exact-sum splits, Direct and Co-op flows, treasurer-PIN split approval, double-approve rejection, idempotent webhooks and withdrawals, overdraw rejection, USSD menu + PIN handling, callback-secret rejection, clean JSON errors, CORS allow/deny. The Dockerfile has **not** been built or run (no Docker in the build environment) — test it before relying on it.

Not done, on purpose and clearly marked:
1. **Payaza FX conversion** has no documented endpoint. Stawi records an illustrative rate on the conversion transaction. Payment links, KES payouts, webhook HMAC, and KES account enquiry follow `docs/skills/payaza/SKILL.md`. Do not create a Payaza sub-account per farmer.
2. **Auth is on for production and for Payaza sandbox/live.** `POST /auth/otp` then `POST /auth/verify` with the SMS code. The Lovable login screen still uses a hardcoded demo code and must be pointed at these endpoints (see `docs/LOVABLE_PROMPT.md`). Set `SEED=false` outside demos.
3. **Persistence.** Set `DATABASE_URL`. The API applies `db/schema.sql` on startup and keeps balance changes and payout rows in one database transaction. Without `DATABASE_URL` the process uses memory and resets on restart.
4. **M-Pesa name enquiry** is not in Payaza's docs (NGN and GHS only). Destinations can be added and removed; the account holder confirms the name. Invite links are still open.
5. **Africa's Talking live**: shortcode + sender-ID approvals (start now; lead times), permanent HTTPS callback, IP allowlist.
6. **Licensing**: holding farmer balances before withdrawal may require authorisation in Kenya. Confirm with Payaza and a Kenyan fintech lawyer; a safer design if unclear is paying out directly at split time.
