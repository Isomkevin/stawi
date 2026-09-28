# Stawi

Cross-border export payments: one buyer payment in, every farmer paid same day.

## Areas
- `/` landing · `/pay/:invoiceId` buyer payment page
- `/login`, `/onboarding` sign-in and four-step sign-up (invite links pre-fill co-op and share)
- `/app/*` farmer app (home, activity, withdraw, profile)
- `/coop/*` co-op treasurer dashboard · `/direct/*` solo exporter dashboard
- `/demo/ussd` basic-phone simulator

## Mock vs live
- `VITE_API_MODE=mock` (default) — everything runs on in-memory demo data (`src/lib/mock.ts`). Demo code `123456`, demo PIN `1234`. A floating demo menu switches roles.
- `VITE_API_MODE=live` + `VITE_API_BASE_URL=https://…` — `src/lib/api.ts` calls the real backend. Endpoints not yet in the contract are marked `TODO(backend)`.

Money is always integer KES cents (`*_kes_cents`); the only client-side maths is the labelled split estimate on the new-invoice sheet.
