# Stawi

**One rail. Every exporter paid — solo or co-op — when the buyer pays.**

A buyer in Hamburg, Brooklyn, or Rotterdam pays one invoice in their own currency. [Payaza](https://docs.payaza.africa) collects it, or the buyer reports a bank transfer and the payee confirms it. Stawi converts the amount to Kenya shillings at a live quote, shows a **0.8%** fee, and credits the person who grew, made, or shipped the goods. A solo exporter is one credit. A co-op pays the farmers on that shipment, by the kilos they delivered, after the treasurer approves the split.

Built by **Team LESOM** for **Borderless Kenya** — Payaza × Hackhouse Nairobi × Africa Tech Academy. This is challenge 03, SME and exporter collections, on the World → Nairobi corridor: foreign currency in, KES out to M-Pesa or a Kenyan bank.

The solution narrative is the [Stawi pitch deck](https://docs.google.com/presentation/d/1ote7WmeoA1HOXjvWGCRkdG5-R_5Rlk8-IGpiP8WbDok/edit?usp=sharing). This repository is the build behind those slides.

## Who feels this every week

**Solo exporter.** Agriculture, crafts, digital services. They send a wire instruction, wait days, and learn the fee when the shillings arrive short.

**Export co-op.** Coffee, tea, macadamia, flowers. The buyer pays the co-op once. A treasurer then works out dozens of shares by hand and pays farmers in cash, over more days.

Both jobs run on one pipeline. Direct is that pipeline. Co-op adds a split the treasurer can read before any farmer can spend it.

```
Buyer pays in USD, EUR, GBP, or another checkout currency
        │
        ├─ Payaza checkout
        └─ Bank-transfer proof, confirmed by the payee
        │
        ▼
KES cents + 0.8% fee           Frankfurter quote, or the fallback table
        │
        ├─ Direct ───────────── exporter balance, immediately
        │
        └─ Co-op ────────────── incoming, until the treasurer's PIN
                                    │
                                    ▼
                    split by kilos on that shipment
                                    │
                                    ▼
              Payaza transfer to each farmer who has
              a verified M-Pesa, other wallet, or bank
                                    │
                                    ▼
              anything left is withdrawn later, same rail
```

The farmer sees that balance on the web app and on USSD. Both channels call the same withdraw.

## How this meets the scorecard

| Criterion | What is in the repo |
|---|---|
| **Problem fit** | Both shapes of the exporter, on one model. The demo ledger is 4 Kenyan co-ops, 76 farmers, and 6 solo exporters, with invoices in USD, EUR, and GBP. |
| **Payaza** | Checkout, KES account enquiry, webhook classification, and payout live in one file, `backend/src/services/payaza.ts`. Nothing else calls Payaza. Underpayment does not settle an invoice. |
| **Feasibility** | Direct finishes when checkout clears. Co-op is that flow plus one approval. Postgres, a Render blueprint, idempotent webhooks and withdrawals, PIN lockout, and a 17-check end-to-end script are already here. A pilot is the next real invoice. |
| **User experience** | The buyer opens a shipment code, pays in the Payaza widget, or uploads a bank-transfer proof. The treasurer approves the kilo split. The farmer checks a balance and withdraws, on a smartphone or a basic phone. The fee is a line on the co-op metrics. |
| **Presentation** | Open a completed Kiambu split, approve one that is still waiting, then show the same shillings on the farmer app and on USSD. |

## What Payaza does, and what Stawi owns

**Checkout.** The buyer page opens the Payaza Web SDK with the amount in the currency they chose (`POST /invoices/:id/checkout-session`). The Payaza webhook marks the invoice paid. A buyer who paid by bank transfer instead opens `/buyer?code={buyer_code}` and submits a proof. Confirming that proof runs the same collection path.

**Multi-currency.** The invoice is priced in the buyer's currency. Stawi books integer KES cents from a cached [Frankfurter](https://api.frankfurter.dev/v2/rates) quote (`FX_FEED`, on by default) and stores that rate on the conversion. If the feed is off, the fetch fails, or the code is missing, the fallback table in `backend/src/services/money.ts` is used (USD 129, EUR 142, GBP 168, KES 1, and the other checkout currencies). Payaza collects in the invoice currency and pays out in KES. Payaza does not publish an FX endpoint. Seeded invoices keep the historical rate written on them.

**Settlement.** Approving a co-op split calls Payaza once per farmer who has a verified M-Pesa (`SAFKEN`), other mobile-money wallet, or bank destination. Mock mode confirms at once. Sandbox and live stay `sent` until the payout webhook. A farmer with no destination keeps the credit. A later withdrawal of whatever remains is a second Payaza payout, authorised by the farmer's PIN. Repeating either request does not pay twice.

**The co-op split is Stawi's ledger.** Payaza sub-accounts are for internal business units, so each farmer is a Stawi account. `splitByKilos` uses largest-remainder on the farmers attached to that shipment, so gross, fee, and net are integer cents and the lines sum exactly to the invoice. A roster `contribution_share` is not the payout. Checkout split ratios step in 10% increments, which is coarser than a farmer's kilos, and the treasurer sees every line before it becomes spendable. Until they enter their PIN, the money sits in `incoming_kes_cents`. A second approval is rejected.

## Walk the ledger

Non-production startup seeds this dataset. Every PIN is `1234`. The mock frontend sign-in code is `123456`. `GET /dev/seed-ids` returns the canonical ids while `PAYAZA_MODE=mock`. Seeded rows are sample data (`is_demo`). The Demo Data switch hides them and does not change `PAYAZA_MODE`. Completed co-op invoices are already split by the kilos on their shipment.

| Open | You will see |
|---|---|
| Kiambu treasurer David Kamau, `+254711000000` | Kiambu Highlands Coffee. `inv_coop_hamburg_101` is USD 12,400 from Hanseatic Coffee Roasters, completed and split. `inv_coop_berlin_102` is USD 8,500, waiting on approval. |
| Farmer Wanjiku Mwangi, `+254712000001` | That co-op's balance, on `/app` and on USSD. |
| Grace Wanjiru, Wanjiru Crafts, `+254722000001` | Direct. `inv_direct_ny_201` is USD 3,200 from Brooklyn Artisan Goods, already credited. |

The rest of the seed is Kericho tea (28 farmers), Meru macadamia (22), Naivasha flowers (16), and five more solo exporters. Full ids are in `docs/SCAFFOLD.md`.

### Open the demo with this

A Kenyan exporter does not have a payments problem. They have a waiting problem. The buyer has already paid. The shillings are stuck in a wire, or in a treasurer's notebook.

Stawi is one Payaza rail with two products. Direct: one exporter, one invoice, credited when checkout clears. Co-op: the same invoice, then a split by the kilos on that shipment, which the treasurer approves. Each farmer with a verified destination is paid through Payaza at that moment. Anyone still holding a balance withdraws to M-Pesa from a smartphone or from USSD. The fee is 0.8%, on the screen. The rate on the invoice is the Frankfurter quote, with a published fallback if that feed is down.

The ask is a pilot with one Payaza export merchant — a solo seller on Direct, or a co-op on the split — sending their next invoice through this pipe.

## Run it

**Frontend**, mock data, no keys:

```bash
npm install
npm run dev
```

`VITE_API_MODE=mock` is the default. Sign in with `123456`. Withdraw and approve splits with PIN `1234`. The demo menu switches treasurer, farmer, and exporter.

**Backend**, the money:

```bash
cd backend
cp .env.example .env   # Windows: copy .env.example .env
npm install
npm run dev            # .env.example sets PORT=4100 and AT_CALLBACK_SECRET=s3cret
npm test
python scripts/e2e.py http://localhost:4100 s3cret
```

To use the API from the app, set `VITE_API_MODE=live` and `VITE_API_BASE_URL=http://localhost:4100`.

| Route | Who it is for |
|---|---|
| `/` | The product |
| `/pay/:invoiceId` | The buyer, Payaza checkout |
| `/buyer?code=` | The buyer, shipment lookup and a bank-transfer proof |
| `/login`, `/onboarding` | Sign-in and sign-up. An invite link pre-fills the co-op and the share |
| `/app` | Farmer: home, activity, withdraw, profile |
| `/coop` | Treasurer: invoices, members, shipments, payouts, the fee |
| `/direct` | Solo exporter |
| `/demo/ussd` | The basic-phone menu: balance, recent payouts, withdraw |

Amounts on the API are integer KES cents (`*_kes_cents`). The labelled estimate on the new-invoice sheet is the only calculation that runs in the browser.

`PAYAZA_MODE=sandbox` or `live` requires Payaza keys and turns session auth on (`POST /auth/otp`, then `POST /auth/verify`). `MASTER_LOGIN_CODE`, when set, signs in any existing account with that one code; leave it empty before real users. Production will not boot in mock mode. `render.yaml` is the backend blueprint: Node bound to `0.0.0.0:$PORT`, Postgres, `SEED=false`.

## The edge of the prototype

- Checkout and payout are real Payaza calls when `PAYAZA_MODE` is `sandbox` or `live`. Mock mode simulates them so the demo runs with no keys. The webhook handler already distinguishes a full collection, an underpayment, and a payout result.
- The conversion rate is a Frankfurter quote, cached for six hours (`FX_CACHE_TTL_MS`). `FX_FEED=off` keeps the illustrative table. Payaza's published API collects and pays out; it does not document an FX quote for this corridor.
- Holding a balance after the split may need a Kenyan authorisation. The approve step already pays farmers who have a verified destination. What remains can be withdrawn later.
- USSD and SMS talk to Africa's Talking. Sandbox works against the callback secret. A live shortcode and sender ID are an application. The menu already uses the same balance and the same `withdraw` as the web app.
- Set `DATABASE_URL` for Postgres (`db/schema.sql` applies on startup, and a balance change is one transaction). With no database URL the process keeps the ledger in memory and reseeds when it restarts.

## Where to read next

| Path | What it is |
|---|---|
| `backend/src/services/payaza.ts` | The only Payaza client |
| `backend/src/services/pipeline.ts` | Collection, conversion, credit or approve-split, withdraw |
| `backend/src/services/money.ts` | Cents, the 0.8% fee, `splitByKilos` |
| `backend/src/services/fx.ts` | Frankfurter cache and the fallback table |
| `backend/src/ussd/menu.ts` | Balance, last payouts, withdraw and PIN |
| `backend/src/data/catalog.ts` | The demo ledger |
| `docs/SCAFFOLD.md` | Runbook, auth, storage, the full seed |
| `docs/skills/stawi-domain/SKILL.md` | Data model and HTTP contract |
| `docs/skills/payaza/SKILL.md` | Checkout, payout, webhooks, and why farmers stay on Stawi's ledger |
| `docs/skills/africas-talking/SKILL.md` | USSD and SMS |
