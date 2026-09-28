# Stawi — cross-border export payments platform

A polished, demo-ready web app with four areas on one design system: a public landing page, a public buyer payment page, a farmer/exporter account app, and dashboards for co-ops and solo exporters — plus a feature-phone (USSD) simulator.

All screens run on realistic built-in demo data by default, so everything works immediately. A single typed data layer can be switched to a real backend later without touching screens.

## Look and feel

- Dark, calm, premium: deep forest ink `#16241B`, charcoal surfaces `#2B342E`, cream canvas `#F7F8F5`.
- Lime `#A8FC84` reserved for primary actions, live/success states and hero numbers. Sage `#6B8F71` secondary, amber `#D9A441` for pending/caution, terracotta `#C8553D` for errors.
- Fraunces (display serif) for headlines and money figures; Inter for UI, tabular numerals for all amounts.
- 16–20px radii, soft layered shadows, faint grain/gradient on dark surfaces, a low-contrast woven-textile / farmland-contour SVG motif on hero areas and empty states.
- Motion: staggered card entrances, count-up balances, an animated payment-flow diagram, micro-interactions, skeletons instead of blank screens. Respects reduced-motion.
- WCAG AA contrast, visible focus rings, 44px tap targets, plain language. English by default with a Swahili toggle for the farmer app.

## Screens

**Landing (`/`)** — dark hero "One payment in. Every farmer paid, same day.", two paths (exporter / co-op), animated flow diagram, problem, how it works, any-phone section, transparent pricing, CTA, footer.

**Buyer payment page (`/pay/:invoiceId`)** — public, single column: who is being paid with a verified badge, amount in buyer currency, itemised breakdown (goods, fee, FX rate, KES equivalent), "what happens next" strip, secure pay button, and states for unpaid / processing / paid (receipt + live payout tracker) / expired / failed. Co-op invoices show "your payment reaches N farmers directly".

**Login + onboarding** — phone + one-time code (demo code 123456), then a four-step wizard: who you are, where money goes (with account-name check), set a 4-digit PIN, choose channels (app and optional basic-phone access). Invite links pre-fill co-op name and share.

**Farmer/exporter app (`/app`)** — mobile-first with bottom tabs. Home: big balance with available vs incoming, latest payout stepper, incoming list, phone-access badge. Activity: grouped list with status chips and a detail drawer showing the full timeline and fees. Withdraw: destination → amount (25/50/all chips) → review → PIN keypad → success, with wrong-PIN, lockout, insufficient-funds and failure handling. Profile: details, payout destinations, PIN, language, channels, support.

**Co-op dashboard (`/coop`)** — sidebar layout. Overview: KPI row with sparklines, collections area chart, payouts-per-farmer bars, shares donut, "needs your attention" panel, activity feed, transparent fee-vs-bank-spread card. Invoices: filterable table plus a new-invoice sheet with live split preview, then payment link with copy/share and QR. Invoice detail: payment timeline, split review table with 100% validation, approve & release behind a PIN. Members: roster, share editor with total meter, CSV import, invites. Payouts history with CSV export. Settings.

**Direct dashboard (`/direct`)** — lighter sibling: KPI row, quick-invoice card, invoice list and detail with timeline, no split panel.

**USSD simulator (`/demo/ussd`)** — feature-phone frame with green-on-dark LCD, real menu tree (balance, transaction status, withdraw with PIN), keypad, session counter, and a side panel showing the raw request/response. Reads the same data as the app, clearly labelled as a sandbox simulation.

## Build order

1. Design system, tokens, fonts, textile motif, shared components (money text, status chip, timeline, flow diagram, KPI card, empty state, PIN pad, skeletons, checkout wrapper, QR, copy-link, phone frame).
2. Data layer: types, typed client, demo adapter with the Kiambu Highlands Coffee Co-op dataset (10 farmers, four invoices in different states, Wanjiru Crafts with two invoices, USD→KES ≈ 129, 0.8% fee).
3. Landing + buyer payment page.
4. Login, onboarding, farmer app.
5. Co-op dashboard, then direct dashboard.
6. USSD simulator, role switcher for reviewers, polish pass on every empty/loading/error state.

## Technical notes

- This project runs on TanStack Start with file-based routing, so routes live in `src/routes/` (`pay.$invoiceId.tsx`, `app.home.tsx`, `coop.invoices.$id.tsx`, etc.) with TanStack Router links and layout routes, instead of React Router. Each public route gets its own page title and social metadata.
- TanStack Query for all reads/mutations; Recharts for charts; Framer Motion for animation; react-hook-form + zod for forms; lucide-react icons.
- `src/lib/types.ts` mirrors the contract exactly (`*_kes_cents` integers; buyer-currency `amount` as decimal). `src/lib/api.ts` exposes one method per endpoint, with `// TODO(backend): add to contract` markers for destination management, OTP login, invite links and co-op payout lists.
- `VITE_API_MODE=mock|live` and `VITE_API_BASE_URL` select the demo adapter or a real backend; mock is the default. No payment-provider or telco calls from the browser; checkout goes through a `PayazaCheckout` wrapper that simulates success/failure/cancel in mock mode.
- Money never computed client-side except the clearly labelled split *preview*; formatting via `Intl.NumberFormat` (`KES 12,400.00`).
- Session token in memory, role guards on protected routes, PINs never persisted. Floating dev menu in mock mode to switch between farmer, treasurer, exporter and buyer views.
- Strict TypeScript, no `any` on API types, folder layout `src/features/{farmer,coop,direct,buyer,ussd}` + `src/lib/{api,mock,format,i18n}`, and a README covering mock vs live mode.
