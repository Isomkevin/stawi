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
│  ├─ src/store.ts, src/data/seed.ts           In-memory store. seed.ts writes the demo ledger; catalog.ts is the deterministic dataset
│  ├─ src/data/catalog.ts                      4 co-ops, 76 farmers, 6 exporters, 78 invoices (PIN 1234)
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
PORT=4100 AT_CALLBACK_SECRET=s3cret npm run dev          # terminal 1 (seeds the demo ledger, PIN 1234)
python3 scripts/e2e.py http://localhost:4100 s3cret        # terminal 2 -> ALL PASSED
npm test                                                   # unit tests
```
Simulate a buyer paying in mock mode: `POST /dev/simulate-payment/:invoiceId`, then for co-op invoices `POST /invoices/:id/approve-split`. `GET /dev/seed-ids` returns the Kiambu co-op, its treasurer, the Wanjiru exporter, the 10 Kiambu farmer ids, and the five canonical invoice ids. Those `/dev/*` routes exist only when `PAYAZA_MODE=mock`.

The contract, entities, and route list are `docs/skills/stawi-domain/SKILL.md`. Payaza calls are `docs/skills/payaza/SKILL.md`. USSD and SMS are `docs/skills/africas-talking/SKILL.md`.

## How the backend works

**Money.** KES is integer cents. A paid invoice is converted at an illustrative rate, then a 0.8% fee is taken. Direct credits the exporter at once. Co-op waits in `settling` until the treasurer approves; `splitByShares` gives each member a net that sums exactly to the invoice net. That credit is the Stawi balance. A withdrawal, with PIN, sends balance to a verified M-Pesa (`SAFKEN`) or bank destination through Payaza. Farmers are not Payaza sub-accounts.

**Auth.** Off in local mock. On in production and when `PAYAZA_MODE` is `sandbox` or `live`. `POST /auth/otp` then `POST /auth/verify`. Send `Authorization: Bearer <token>` or the `stawi_session` cookie. If `MASTER_LOGIN_CODE` is set, that one code signs in any existing account; a texted code still works. Leave it empty before real users. A treasurer can read their members and manage that co-op. They cannot withdraw on a member's behalf. Buyer invoice view, checkout, webhooks, account creation, and USSD stay public.

**PIN.** 4 digits, bcrypt. Five failures lock the account for 15 minutes. Web and USSD call the same `withdraw`.

**Storage.** No `DATABASE_URL`: in-memory, empty on restart, then seeded. With `DATABASE_URL`: `db/schema.sql` is applied on startup and balance changes run in one database transaction. `SEED=false` in production (`render.yaml`). Reseed only when `acc_treasurer` is absent.

**USSD.** `POST /ussd/callback` must include `?s=<AT_CALLBACK_SECRET>` or the `x-ussd-secret` header. The menu is balance, the last three payouts, and withdraw. The phone number selects the account. The session id is the withdrawal idempotency key. SMS (login codes and payout alerts) is dry-run when `AT_API_KEY` is unset.

**Checks.** `npm run typecheck` and `npm test` in `backend/`. `python scripts/e2e.py http://localhost:4100 s3cret` runs the 17 live checks against a running mock server.

## Demo seed

`backend/src/data/catalog.ts` is the dataset. `backend/src/data/seed.ts` writes it through the store and `splitByShares`, so every co-op's shares sum to 100 and every completed invoice's credit payouts sum to its net. Money is integer KES cents. The fee on settled invoices is 0.8%. Historical FX stored on those invoices is USD 129, EUR 140.5, GBP 168.2. Every seeded account uses PIN `1234`.

The ledger is 4 co-ops, 76 farmers, 4 treasurers, 6 exporters (86 accounts), and 78 invoices over about nine months. Statuses cover `pending`, `paid`, `converting`, `settling`, `completed`, and `failed`. Completed co-op invoices are split to members. Settling invoices sit in `incoming_kes_cents` until a treasurer approves the split. A slice of farmers and every exporter also have withdrawals (`confirmed`, `sent`, `pending`, or `failed`). Kipkemoi Kosgei (`acc_kericho_8`) has an unverified M-Pesa destination and a failed withdrawal. Balances are the ledger: confirmed credits minus confirmed and sent withdrawals. They are not the old hand-set KES 18,450 figure.

| Who | Id | Phone | Signs in as |
|---|---|---|---|
| Kiambu Highlands Coffee Co-op | `coop_kiambu` | treasurer David Kamau `+254711000000` | `acc_treasurer` |
| Kiambu farmers (10) | `acc_farmer_1` … `acc_farmer_10` | `+254712000001` … `+254712000010` | farmer 1 is Wanjiku Mwangi |
| Kericho Gold Tea Growers (28 farmers) | `coop_kericho` | treasurer Chebet Langat `+254713000000` | `acc_treasurer_kericho` |
| Meru Macadamia Union (22 farmers) | `coop_meru` | treasurer Muriuki Mwenda `+254714000000` | `acc_treasurer_meru` |
| Naivasha Floriculture Co-op (16 farmers) | `coop_naivasha` | treasurer Naomi Wairimu `+254715000000` | `acc_treasurer_naivasha` |
| Wanjiru Crafts | `acc_exporter` | Grace Wanjiru `+254722000001` | solo exporter |
| Kitui Highlands Honey | `acc_exporter_honey` | Nzisa Mutua `+254722000002` | solo exporter |
| Ole Nkai Leather | `acc_exporter_leather` | Sankale Ole Nkai `+254722000003` | solo exporter |
| Mugo Avocado Exports | `acc_exporter_avocado` | Wangari Mugo `+254722000004` | solo exporter |
| Taita Sisal Works | `acc_exporter_sisal` | Hamisi Juma `+254722000005` | solo exporter |
| Lamu Spice House | `acc_exporter_spices` | Amina Yusuf `+254722000006` | solo exporter |

Canonical invoices, also returned by `GET /dev/seed-ids`:

| Id | Product | Status | Amount |
|---|---|---|---|
| `inv_coop_hamburg_101` | Kiambu | completed, split | USD 12,400, Hanseatic Coffee Roasters |
| `inv_coop_berlin_102` | Kiambu | settling, awaiting split | USD 8,500, The Barn Berlin |
| `inv_coop_rotterdam_103` | Kiambu | pending | USD 15,000, Rotterdam Commodity Traders |
| `inv_direct_ny_201` | Wanjiru Crafts | completed | USD 3,200, Brooklyn Artisan Goods |
| `inv_2413` | Wanjiru Crafts | pending | EUR 1,800, Covent Garden Fair Trade |

Other co-op and exporter invoices use references such as `KRC-001`, `MRU-001`, `NVS-001`, `HNY-001`. Each account has an M-Pesa destination (`SAFKEN`) and a bank destination (KCB `01`, Equity `68`, Co-operative `11`, or NCBA `07`). A few bank destinations are unverified.

Seeding runs on startup when `SEED=true`, or when `NODE_ENV` is not `production` and `SEED` is not `false`. It runs only if `acc_treasurer` is missing. An in-memory server loads this on every fresh start. A Postgres database that already has that row is left as-is; empty it before expecting the new ledger. `SEED=false` starts empty. Production (`render.yaml`) sets `SEED=false`.

Seeded rows are sample data (`is_demo: true`). Their balances are `demo_balance_kes_cents`, not the live withdrawable balance. `DEMO_DATA_ENABLED` is the default visibility (on outside production, off in production). Each account can override it with `PATCH /accounts/{id}/settings`. That switch hides or shows sample rows. It does not delete them, and it does not change `PAYAZA_MODE`. Live invoices created through `POST /invoices` stay live. Sample invoices are not sent to Payaza when the mode is sandbox or live. An older database that was seeded before this flag is tagged on the next startup, and sample funds already sitting in the live balance are moved into the sample balance.

The Lovable mock in `src/lib/mock.ts` is a smaller Kiambu story for `VITE_API_MODE=mock`. It shares the canonical ids above. The live API (`VITE_API_MODE=live`) returns this ledger instead.

Co-op shipments are part of that ledger. Each co-op invoice has one shipment whose stage follows the invoice (`completed` invoices are closed shipments, `settling` invoices are delivered and waiting on the split, `pending` invoices are ready to ship). Each co-op also has a draft with no farmers and a preparing lot with no invoice. Farmer kilos on a shipment sum to its quantity. `GET /coops/{id}/shipments` lists them. `PATCH /shipments/{id}` with `{ action: "advance" }` moves a shipment one stage. Closing a delivered shipment requires the linked invoice to be `completed`. If a database was seeded before shipments existed, the next non-production startup adds them when Kiambu has none.

## Verified vs still yours to do
Verified (production build, `node dist`): exact-sum splits, Direct and Co-op flows, treasurer-PIN split approval, double-approve rejection, idempotent webhooks and withdrawals, overdraw rejection, USSD menu + PIN handling, callback-secret rejection, clean JSON errors, CORS allow/deny. The Dockerfile has **not** been built or run (no Docker in the build environment) — test it before relying on it.

Not done, on purpose and clearly marked:
1. **Payaza FX conversion** has no documented endpoint. Stawi records an illustrative rate on the conversion transaction. Payment links, KES payouts, webhook HMAC, and KES account enquiry follow `docs/skills/payaza/SKILL.md`. Do not create a Payaza sub-account per farmer.
2. **Auth is on for production and for Payaza sandbox/live.** `POST /auth/otp` then `POST /auth/verify` with the SMS code. The Lovable login screen still uses a hardcoded demo code and must be pointed at these endpoints (see `docs/LOVABLE_PROMPT.md`). Set `SEED=false` outside demos.
3. **Persistence.** Set `DATABASE_URL`. The API applies `db/schema.sql` on startup and keeps balance changes and payout rows in one database transaction. Without `DATABASE_URL` the process uses memory and resets on restart.
4. **M-Pesa name enquiry** is not in Payaza's docs (NGN and GHS only). Destinations can be added and removed; the account holder confirms the name. Invite links are still open.
5. **Africa's Talking live**: shortcode + sender-ID approvals (start now; lead times), permanent HTTPS callback, IP allowlist.
6. **Licensing**: holding farmer balances before withdrawal may require authorisation in Kenya. Confirm with Payaza and a Kenyan fintech lawyer; a safer design if unclear is paying out directly at split time.
