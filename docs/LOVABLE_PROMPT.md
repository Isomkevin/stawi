# Lovable prompt — Stawi frontend (paste everything below the line)

Tip: paste in one go as the first prompt. Then follow up with the "Phase prompts" at the bottom one at a time to refine. If Lovable truncates, send Sections 1–4 first, then 5–9.

---

## 1. What you're building

Build **Stawi**, a cross-border export payments platform for East African exporters and co-operatives, as a polished production-grade web app. Stawi is **two products on one rail**:

- **Stawi Direct** — a solo exporter sends a payment link to an international buyer; the buyer pays in their own currency; the exporter is paid in KES the same day.
- **Stawi Co-op** — a co-op collects one payment from a buyer, and Stawi automatically splits it across every farmer by contribution share and pays each one the same day.

Frontend only. Every screen talks to a REST API through a single typed client (`src/lib/api.ts`). **Do not call Payaza or Africa's Talking from the frontend, and do not store account state locally.** Ship with a **mock adapter** that returns realistic data matching the API contract in Section 8, switchable via `VITE_API_MODE=mock|live` and `VITE_API_BASE_URL`. Default to mock so every screen works immediately.

Stack: React + TypeScript + Vite, Tailwind, shadcn/ui, React Router, TanStack Query, Recharts, Framer Motion, lucide-react, react-hook-form + zod.

## 2. Design direction (this matters as much as the functionality)

The product handles people's money and livelihoods, so it must feel **trustworthy, calm and premium**, while being **visually stimulating**, not a generic fintech template. Think: refined editorial fintech with African warmth. Confident typography, generous whitespace, subtle depth, purposeful motion.

**Palette (CSS variables, light + dark theme, dark is the hero for landing/portal)**
- Ink / deep forest: `#16241B`
- Charcoal surface: `#2B342E`
- Stawi lime (primary accent, used sparingly for key actions and success): `#A8FC84`
- Sage (secondary): `#6B8F71`
- Cream canvas: `#F7F8F5`
- Warm amber (pending/roadmap/caution): `#D9A441`
- Error: soft terracotta `#C8553D`
- Use lime only for the primary CTA, live/success states and key numbers, never as large flat backgrounds behind body text.

**Typography**
- Display: a characterful serif (Fraunces or Instrument Serif) for headlines and big money figures.
- UI/body: Inter or DM Sans. Tabular numerals for all amounts.
- Big, confident numbers: balances and totals are the heroes of their screens.

**Look and feel**
- Cards with soft borders, 16–20px radius, layered subtle shadows; dark surfaces with a faint grain/gradient mesh; thin lime hairlines as accents.
- A subtle abstract motif drawn from woven textile / farmland contour lines (SVG pattern) as background texture on hero areas and empty states. Tasteful, low contrast.
- Motion with Framer Motion: staggered card entrances, number count-up on balances, animated flow diagram when a payment progresses, smooth route transitions. Respect `prefers-reduced-motion`.
- Micro-interactions on every button, toggle and status change. Skeleton loaders, never blank screens.
- Iconography: lucide-react, consistent 1.75 stroke.
- Fully responsive. Farmer app is **mobile-first**; co-op dashboard is **desktop-first but usable on tablet**; buyer portal works everywhere.
- Accessibility: WCAG AA contrast, visible focus rings, large tap targets (min 44px), plain-language labels. Many farmers are first-time app users: keep language simple, avoid jargon, use icons plus text.
- English by default with an i18n structure ready for Swahili (`en.json`, `sw.json`, all strings via `t()`), plus a language toggle. Provide Swahili for the farmer app strings.
- Currency formatting via `Intl.NumberFormat`; KES as `KES 12,400.00`.

## 3. App structure and routes

One app, four areas, role-aware navigation.

```
/                         Marketing landing (public)
/pay/:invoiceId           Buyer payment portal (public, no login)
/login                    Phone + OTP (mock OTP 123456), role select in mock mode
/onboarding               Farmer/exporter onboarding wizard

/app                      Farmer/Exporter account app (mobile-first)
  /app/home               Balance, latest payout, quick actions
  /app/transactions       Transaction list + detail drawer
  /app/withdraw           Withdraw flow (PIN protected)
  /app/profile            Details, payout destinations, PIN, language, channels

/coop                     Co-op treasurer dashboard (desktop-first)
  /coop/overview          Metrics + charts + activity
  /coop/invoices          Invoice list, create invoice
  /coop/invoices/:id      Invoice detail + split review + approve
  /coop/members           Farmer roster, shares, onboarding status
  /coop/payouts           Payout history
  /coop/settings          Fees, co-op profile

/direct                   Solo exporter dashboard (desktop + mobile)
  /direct/overview        Metrics, quick invoice
  /direct/invoices        List + create
  /direct/invoices/:id    Detail + timeline

/demo/ussd                USSD simulator (phone frame) for demos
```

## 4. Screens in detail

### 4.1 Landing (`/`)
Dark hero with the headline **"One payment in. Every farmer paid, same day."** Two clear paths: "I'm an exporter" (Stawi Direct) and "We're a co-op" (Stawi Co-op). Animated flow diagram: Buyer pays → Checkout → Converts to KES → Splits → Farmers paid, nodes lighting up in sequence. Sections: the problem (5–10 days, manual splits, hidden FX), how it works (two tracks), works on any phone (smartphone or feature phone via USSD), transparent pricing (fee shown plainly), CTA. Footer with "Powered by Payaza rails". Beautiful, not crowded.

### 4.2 Buyer portal (`/pay/:invoiceId`) — public, the most important trust screen
Dark, calm, single-column, zero clutter. Shows: who is being paid (co-op or exporter name with a verified badge), invoice description, amount in the buyer's currency, itemised breakdown (goods amount, Stawi fee, FX rate and converted KES equivalent, total), a plain "what happens next" strip (You pay → Converted → Farmers paid same day). Prominent "Pay securely" button opens the Payaza checkout widget via a `PayazaCheckout` wrapper component (mock mode simulates a popup with success/failure/cancel). States: unpaid, processing (animated), paid (confetti-free elegant success with receipt download and a live "payout progress" tracker), expired, failed with retry. Include a short trust footer (encryption, Payaza, refund contact). For co-op invoices, show a subtle "Your payment reaches N farmers directly" line with a small animated dot-cluster.

### 4.3 Onboarding wizard (`/onboarding`)
4 steps, one clear question per screen, progress bar, large inputs, back/next, autosave:
1. Who are you: name, phone, ID number
2. Where should money go: M-Pesa number or bank account; name enquiry check shows the resolved account name with a green tick (mock resolves a name) so the user confirms it is theirs
3. Set a 4-digit Stawi PIN (explain it protects withdrawals, also used on USSD); confirm entry
4. Choose channels: webapp always on; toggle "Also use on my basic phone (USSD/SMS)" with a short explanation and the dial code shown; consent checkbox for SMS alerts
Finish with a warm welcome screen. Co-op members arrive via an invite link (`/onboarding?invite=CODE`) that pre-fills co-op name and their contribution share (read-only).

### 4.4 Farmer/Exporter app (`/app`)
Mobile-first with bottom tab bar (Home, Activity, Withdraw, Profile); desktop shows a centred phone-width layout with a side rail.

**Home**: large balance card (count-up, KES, tabular figures), "Available" vs "Incoming" split, primary button Withdraw. Below: "Latest payout" card with the co-op/buyer name and status stepper. A gentle "Coming your way" list of incoming payouts tied to invoices in progress. Channel badge showing "Phone access: ON (USSD)" with the dial code and a link to Profile.

**Activity**: chronological list grouped by day; each row: invoice reference, counterparty, amount, status chip (Pending, Converting, Paid, Failed). Tap opens a drawer with the full timeline (Collected → Converted at rate X → Split → Sent to M-Pesa) with timestamps and amounts, fee shown transparently. Filters and search.

**Withdraw**: step flow — choose approved destination (only verified ones listed) → amount with quick chips (25% / 50% / All) and available-balance guard → review (fee if any, destination name) → PIN entry on a custom numeric keypad → success animation and receipt. Handle wrong-PIN, lockout ("Too many attempts, try again in 15 minutes"), insufficient funds, and failure states clearly and kindly.

**Profile**: account details, payout destinations (add/verify/remove), change PIN, language toggle (EN/SW), channels (USSD/SMS toggles), notification preferences, help/support.

### 4.5 Co-op dashboard (`/coop`) — the treasurer's control room
Left sidebar, top bar with co-op name, quick "New invoice" button, notification bell, profile menu.

**Overview**: KPI row (Total collected, Paid out to farmers, Fees paid, Avg time-to-payout, Farmers paid this month) with sparklines; area chart of collections over time; bar chart of payouts per farmer; donut of contribution shares; "Needs your attention" panel (invoices awaiting split approval, farmers missing payout details, failed payouts); recent activity feed. Transparent fee card: "You paid KES X in fees vs an estimated KES Y typically lost to bank spreads", labelled as an estimate with an editable assumption.

**Invoices**: table with status chips, search, filters (status, date, buyer), sorting; "New invoice" side sheet: buyer name/email/phone, currency, amount, description, shipment reference, due date, contribution basis (uses roster shares or per-shipment kilos, editable). Live preview of the split table as they type. On create, show the payment link with copy/share (WhatsApp, email) and a QR code.

**Invoice detail**: header with status and buyer; horizontal payment timeline (Created → Sent → Paid → Converted → Split approved → Paid out); **Split review panel**: table of each farmer, share %, kilos (optional), gross KES, fee, net KES, destination masked, status; validation that shares sum to 100% with a clear warning; **Approve & release** button opens a confirm dialog and PIN step; after approval, rows update live with per-farmer status. Buyer payment details, FX rate applied, fee breakdown, downloadable PDF-style receipt view.

**Members**: roster table with avatar initials, name, phone, share %, payout destination status (Verified / Missing / Pending), onboarding status (Invited / Active), 2G access on/off. Add member dialog and CSV bulk import (drag-and-drop, preview with row errors, confirm). Share editor with a live "total = 100%" meter. Send invite via SMS/WhatsApp link.

**Payouts**: full history with per-farmer filter, export CSV.

**Settings**: co-op profile, fee display, approval rules (require treasurer PIN), notification settings.

### 4.6 Direct dashboard (`/direct`)
A lighter sibling of the co-op dashboard for a solo exporter: KPI row (Collected, Paid to you, Fees, Avg time to payout), quick-invoice card on top ("Amount, currency, buyer email → Create link"), invoice list, invoice detail with timeline. Same visual language, no split panel. Show a subtle prompt "Are you part of a co-op? Switch to Stawi Co-op".

### 4.7 USSD simulator (`/demo/ussd`)
A realistic phone frame (feature-phone style, dark bezel, monochrome green-on-dark LCD look) rendering the exact USSD menus: Welcome to Stawi → 1 My balance, 2 Transaction status, 3 Withdraw (choose destination → amount → PIN → confirmation). Keypad input and a text field; shows CON/END semantics and a session counter; a side panel displays the raw request/response (`sessionId`, `phoneNumber`, `text`, response) for technical audiences. It reads the same mock/live API as the app so balances match the webapp exactly, reinforcing "one account, two channels." Add a toggle "Sandbox simulation" label so it is never presented as a live telco session unless configured.

## 5. Shared components to build first
`AppShell`, `Sidebar`, `BottomTabs`, `MoneyText` (tabular, count-up), `StatusChip`, `Timeline`, `FlowDiagram` (animated), `SplitTable`, `KpiCard`, `EmptyState` (with textile motif), `PinPad`, `PayazaCheckout` (wrapper: mock + real widget loader), `CopyLink`, `QrCode`, `PhoneFrameUSSD`, `ConfirmDialog`, `LanguageToggle`, `Skeletons`.

## 6. States and quality bar
Every screen needs loading (skeletons), empty (illustrated, with a next action), error (friendly, retry) and success states. Optimistic UI where safe; never optimistic for money movement. All amounts derive from API responses; never compute payouts client-side except for the *preview* split, clearly labelled "Preview" until approved. Form validation with zod and helpful inline messages. Toasts for confirmations. Keyboard accessible dialogs.

## 7. Auth and roles (frontend behaviour)
Roles: `farmer`, `exporter`, `treasurer`, `buyer` (no login). After login route by role. Route guards. In mock mode a role switcher in a floating dev menu lets reviewers jump between farmer, treasurer, exporter and buyer views instantly. Persist the session token in memory plus httpOnly cookie expectation in live mode; do not store PINs anywhere.

## 8. API contract (implement client + mock against exactly this)

**Money rule: every money field from the API is an integer number of KES cents (`*_kes_cents`). Format with `amount / 100`; never use floats for money. Buyer-currency invoice `amount` is a plain decimal in that currency.** The backend types live in `backend/src/types.ts`; mirror them exactly in `src/lib/types.ts`.

```ts
type PayoutDestination = { id: string; type: "mpesa" | "bank"; details: string; account_name: string; is_verified: boolean; bank_code?: string };
type Account = { id: string; full_name: string; phone_number: string; id_number: string; payout_destinations: PayoutDestination[];
  coop_id: string | null; channel_capability: "webapp" | "webapp+ussd"; balance_kes_cents: number; incoming_kes_cents: number }; // pin_hash is never returned
type Coop = { id: string; name: string; treasurer_account_id: string };
type CoopMember = { coop_id: string; account_id: string; full_name?: string; contribution_share: number; kilos?: number };
type Invoice = { id: string; type: "direct" | "coop"; account_id: string | null; coop_id: string | null;
  buyer_name: string; buyer_email: string; buyer_phone?: string; amount: number; currency: string; description: string; reference: string;
  status: "pending" | "paid" | "converting" | "settling" | "completed" | "failed"; split_approved: boolean;
  fx_rate: number | null; fee_kes_cents: number | null; kes_total_cents: number | null; // kes_total = net after fee
  payaza_checkout_reference: string | null; payaza_link_id?: string | null; created_at: string; due_at: string | null };
type Transaction = { id: string; invoice_id: string; type: "collection" | "conversion" | "settlement" | "payout";
  status: "pending" | "completed" | "failed"; amount: number; currency: string; fx_rate: number | null; fee_kes_cents: number | null; created_at: string };
type Payout = { id: string; invoice_id: string; account_id: string; kind: "credit" | "withdrawal"; // credit = split landed in Stawi balance
  amount_kes_cents: number; destination_id: string | null; status: "pending" | "sent" | "confirmed" | "failed"; created_at: string; payaza_reference?: string | null };
type SplitLine = { account_id: string; share: number; gross_kes_cents: number; fee_kes_cents: number; net_kes_cents: number };
type Shipment = { id: string; reference: string; coop_id: string; buyer_name: string; product: string; quantity_kg: number;
  destination: string; value: number; currency: string; ship_date: string; shipped_at: string | null;
  status: "draft" | "preparing" | "ready" | "in_transit" | "delivered" | "completed";
  invoice_id: string | null; farmers: { account_id: string; kilos: number }[]; updated_at: string };
```

Endpoints (client methods mirror these 1:1):
```
POST /auth/otp                         { phone_number } -> { sent: true, dev_code? }  (texts a 6-digit code; mock mode and OTP_DEV_CODES=true also return dev_code outside production)
POST /auth/verify                      { phone_number, code } -> { token, account_id, role, account }  (a server MASTER_LOGIN_CODE, when set, also signs in any existing account; the login page does not change)
POST /auth/logout                      clears the session cookie
Authorization: Bearer <token> is required on every route except health, account creation, name enquiry, OTP, buyer invoice view, checkout, Payaza webhooks, and USSD, whenever the API is in production or PAYAZA_MODE is sandbox/live.
POST /accounts                          body: { full_name, phone_number, id_number, pin(4 digits), destination:{type,details,account_name}, ussd:boolean, coop_id? }
GET  /accounts/{id}                     GET /accounts/{id}/balance -> { balance_kes_cents, incoming_kes_cents }
GET  /accounts/{id}/transactions?limit  -> Payout[] (credits and withdrawals, newest first)
POST /accounts/{id}/withdraw            { destination_id, amount_kes_cents, pin, idempotency_key }  403 { error:"wrong"|"locked", attemptsLeft? }
POST /coops                             POST /coops/{id}/members { account_id, contribution_share, kilos? }
GET  /coops/{id}/members                GET /coops/{id}/metrics -> { invoices, total_collected_kes_cents, fee_taken_kes_cents, total_split_kes_cents }
GET  /invoices?coop_id=&account_id=     POST /invoices { type, account_id|coop_id, buyer_name, buyer_email, amount, currency, description, reference? }
GET  /invoices/{id}                     -> { invoice, transactions, split_preview: SplitLine[] | null }
POST /invoices/{id}/checkout-session    -> { reference, checkoutUrl|null, public_key, transaction_reference, link_id|null }  (open the Payaza widget client-side with public_key and transaction_reference)
POST /invoices/{id}/approve-split       { treasurer_id, pin } -> { success, invoice, payouts }
POST /dev/simulate-payment/{invoiceId}  -> { success, invoice, transactions, payouts } (mock backend only)
GET  /coops/{id}                        GET /coops/{id}/payouts -> Payout[] (members' payouts for this co-op's invoices, newest first)
GET  /coops/{id}/shipments              -> Shipment[]
PATCH /shipments/{id}                   { action: "advance" } -> Shipment
DELETE /shipments/{id}                  -> 204  409 if the linked invoice is no longer pending
DELETE /invoices/{id}                   -> 204  409 unless the invoice is still pending
DELETE /coops/{id}/members/{accountId}  -> 204
PATCH /coops/{id}/members/{accountId}   { contribution_share } -> CoopMember
POST /name-enquiry                      { type, details } -> { account_name }
                                        Public. A known Stawi account returns full_name.
                                        An unknown number before sign-in returns account_name "Pending name check" (no KES carrier lookup). Treat that as "use the name the person typed", not as a verified carrier name.
                                        A signed-in caller gets 404 if unknown.
POST /accounts/{id}/destinations        { type, details, account_name, bank_code? } -> PayoutDestination  409 duplicate
DELETE /accounts/{id}/destinations/{destId} -> 204  400 if it is the last one
```
Canonical demo ids exist in both the frontend mock and the backend seed: coop_kiambu, acc_treasurer, acc_exporter, acc_farmer_1..10, buyer invoice inv_2413. The live backend ledger is larger; see `docs/SCAFFOLD.md` (Demo seed). `GET /dev/seed-ids` returns only those Kiambu ids.
Errors are JSON `{ error: string }` with 400/401/403/404. The narrative for pipeline, auth, and money is `docs/skills/stawi-domain/SKILL.md`. Anything the UI needs that is not in the list above, mark in `src/lib/api.ts` under `// TODO(backend): add to contract` and add it to that skill in the same change.

## 9. Mock data (make the demo feel real)
This section is the in-app mock (`VITE_API_MODE=mock` only). Keep it small so every screen is reviewable without the API.

Co-op: "Kiambu Highlands Coffee Co-op", 10 farmers with plausible Kenyan names and shares summing to 100%. Invoices: one paid and split (USD 12,400 from a buyer in Hamburg), one awaiting split approval, one pending payment, one failed payout for a farmer missing details. Solo exporter: "Wanjiru Crafts" with two USD/EUR invoices. Realistic FX (USD→KES ≈ 129), fee 0.8%. Farmer balance KES 18,450.00 (stored as 1845000 cents) with a recent payout.

When `VITE_API_MODE=live`, ignore this mock and read the backend. That ledger is 4 co-ops (Kiambu, Kericho tea, Meru macadamia, Naivasha flowers), 76 farmers, and 6 exporters, with the same canonical ids and PIN `1234`. Balances there come from payout history, so they will not match KES 18,450. Details, phones, and invoice ids: `docs/SCAFFOLD.md` (Demo seed).

## 10. Deliverables and conventions
- Clean folder structure: `src/pages`, `src/components`, `src/features/{farmer,coop,direct,buyer,ussd}`, `src/lib/{api,mock,format,i18n}`, `src/hooks`.
- Strict TypeScript, no `any` on API types, env-driven config, no secrets in code.
- A `README.md` describing mock vs live mode and how to point at the backend.
- Beautiful first, then correct everywhere; do not ship any screen that looks like an unstyled scaffold.

---

# Phase prompts (send after the master prompt, one at a time)

**Phase 1 — Foundations:** "Set up the design system: tokens, fonts, dark/light themes, the shared components list in Section 5, the AppShell and routing. Show a style guide page at `/styleguide` with every component and state."

**Phase 2 — Buyer portal + landing:** "Build the landing page and the buyer payment portal with all states, the animated FlowDiagram and the PayazaCheckout wrapper (mock and live loader)."

**Phase 3 — Farmer app + onboarding:** "Build onboarding and the full farmer app (Home, Activity, Withdraw with PinPad, Profile) with Swahili translations."

**Phase 4 — Co-op dashboard:** "Build the co-op dashboard: Overview charts, Invoices with the create sheet, Invoice detail with the split review and approve flow, Members with CSV import, Payouts, Settings."

**Phase 5 — Direct + USSD simulator:** "Build the Direct dashboard and the USSD simulator with the request/response inspector, wired to the same mock API."

**Phase 6 — Polish pass:** "Audit every screen for loading/empty/error states, motion, contrast, tap targets, responsive breakpoints and copy clarity. Fix anything that looks generic. Then wire `VITE_API_MODE=live` and list every endpoint the backend must implement."
