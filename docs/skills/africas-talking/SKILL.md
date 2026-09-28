---
name: africas-talking
description: USSD and SMS integration patterns for Stawi's farmer 2G channel, sandbox and production. Use when building the USSD webhook handler, session state machine, SMS notifications, or the shortcode/go-live process for Kenyan networks.
---

# Africa's Talking integration (USSD + SMS)

This is the adapter that gives a farmer the same account access — balance, transaction status, withdraw — on a feature phone that a smartphone user gets on the webapp. It is a **channel**, not a separate product: every action here reads/writes through Stawi's own internal API (see `skills/stawi-domain/SKILL.md`), never a local copy of the data.

## Environments: sandbox vs live

Africa's Talking runs two fully separate environments. Build and test on sandbox, then flip config — not code — to go live. **Design the integration environment-switchable from the first line written**, so going live is an env-var change plus the approvals below.

| | Sandbox | Live (production) |
|---|---|---|
| `AT_USERNAME` | literal `sandbox` | your real AT app username |
| `AT_API_KEY` | sandbox key from dashboard | live key (generated fresh for the live app; may take a short while to become active) |
| API base | `https://api.sandbox.africastalking.com` | `https://api.africastalking.com` |
| USSD | Simulator only, no real phone | Real dial on Safaricom / Airtel / Telkom |
| SMS | Simulator inbox only | Real delivery to real phones, billed per message |
| Cost | Free | USSD shortcode fee + per-session/per-SMS charges (SMS is under KES 1 each) |

```
AT_ENV=sandbox            # or "live"
AT_USERNAME=sandbox       # or your live app username
AT_API_KEY=<key for the matching environment>
AT_CALLBACK_SECRET=<shared secret>
AT_USSD_CALLBACK_URL=https://<host>/ussd/callback?s=<AT_CALLBACK_SECRET>
AT_SENDER_ID=STAWI        # live only, after approval (see below)
AT_USSD_SERVICE_CODE=*384*1#   # placeholder; live value is whatever AT/telcos assign you
```

Wire the SDK from these variables and nothing else:

```javascript
const AfricasTalking = require('africastalking')({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME,
});
```

The SDK targets sandbox or live automatically based on the username, so **never hardcode `sandbox` in code** — read it from env. Add a startup log line printing `AT_ENV` so nobody accidentally ships sandbox credentials to a live deploy (or vice versa).

## Setup (sandbox first)

1. Create an Africa's Talking account, use the **Sandbox** app for all Build Day work (no charges, safe to break things).
2. In the sandbox dashboard, go to USSD → create a channel, register a callback URL (use ngrok for local dev: `https://<your-ngrok-id>.ngrok.io/ussd/callback`).
3. Note the sandbox `apiKey` from the dashboard. For sandbox, `username` is always the literal string `sandbox`.

## Going live (production) — start these on day one, they have lead time

Code is the easy part of going live. The gating items are **approvals with lead times**, so kick them off immediately, in parallel with building on sandbox:

1. **Create a live app** on the Africa's Talking dashboard and generate its own API key. Top up the account Stash (card top-up is available under Billing) — live USSD sessions and SMS draw from it.
2. **Apply for a USSD shortcode.** A shortcode is required for live USSD, and telco approval sits behind it. Options:
   - **Shared shortcode** (a menu like `*384*XXXX#` under AT's shared code): fastest, cheaper, but you get an extension not a vanity code.
   - **Dedicated shortcode** (e.g. `*123#`-style): better branding, but slower and pricier. Dedicated services in Kenya have typically taken from a couple of days to several weeks depending on the network, and cost varies by Safaricom / Airtel / Telkom. Confirm current timelines and fees with AT support (`techsupport@africastalking.com` / `sales@africastalking.com`) rather than trusting any number written here.
   - Apply per network. You can go live on the network(s) that approve first; farmers on other networks simply can't dial in yet.
3. **Register an SMS Sender ID or shortcode** for notifications. In Kenya, live SMS without a registered sender/shortcode commonly fails (you'll see a `userInBlacklist`-style rejection, especially on Safaricom). Register `STAWI` as an alphanumeric sender ID or use a shortcode, and expect an approval step.
4. **Point the live USSD channel's callback URL** at a permanent HTTPS endpoint (not ngrok). It must be publicly reachable, fast (USSD sessions time out in seconds), and always answer `200`.
5. **Compliance basics.** USSD and SMS in Kenya fall under the Communications Authority's framework; Africa's Talking handles most of the carrier-side compliance, but you still own consent and data handling. Only message farmers who registered on Stawi, include an opt-out line on promotional SMS (transactional payout alerts are fine), and never put full account numbers or PINs in SMS or USSD screens.
6. **Security hardening before real money moves** (this is the part that bites when USSD goes live):
   - **Identify the caller by `phoneNumber` from the gateway**, which the network supplies and the user can't spoof, but treat it as identification, not authentication. **Require a Stawi PIN** for withdrawals over USSD (set during webapp onboarding, hashed server-side, rate-limited with lockout after a few bad attempts). Never withdraw on phone-number identity alone.
   - **Validate the callback source.** The handler rejects the request with 401 unless `?s=` matches `AT_CALLBACK_SECRET` or the `x-ussd-secret` header does. Register the callback URL with that query string. An IP allowlist can sit in front of the same endpoint.
   - **Idempotency on withdrawals.** USSD gateways can retry; key each withdrawal on `sessionId` + amount + destination so a retry can't double-pay.
   - **Approved destinations only.** USSD withdraw may only target destinations verified at webapp onboarding (account name enquiry passed) — never accept a free-typed number over USSD.
   - **Session timeout handling.** If a session dies mid-withdrawal, the operation must be either fully committed or fully abandoned; no half-states.
7. **Stage the rollout.** Go live with a handful of real farmers on one network first, watch the logs and delivery reports, then widen. Keep the sandbox environment alive as a permanent staging target.

**Honest status line for the demo:** until the shortcode and sender ID are approved, present USSD as "live in sandbox, shortcode application submitted" — the same transparent framing that has worked for Stawi throughout this hackathon. Never claim a live shortcode you don't have.

Note (as of early 2026, per developer reports): during demos, Airtel and Telkom lines have sometimes received messages without a shortcode while Safaricom was strict about it. That's anecdotal and can change — don't build a launch plan on it, and verify with AT support.

## How USSD sessions work

Africa's Talking's gateway POSTs to your callback URL on every step of a USSD session (dial, then each menu selection). Your handler responds each time; the gateway relays your response back to the phone as the next screen.

**Incoming POST fields:**
| Field | Meaning |
|---|---|
| `sessionId` | Unique per USSD session — use this as your state key |
| `phoneNumber` | The farmer's number — match against Stawi's Account.phone |
| `serviceCode` | The USSD short code dialed |
| `text` | Everything the user has entered this session, `*`-separated per menu level |

**`text` parsing:** Africa's Talking appends the user's latest input to `text`, separated by `*`, on every request. Split on `*` to get the navigation path so far. The count of segments tells you the menu depth.

```
First request:  text = ""              → show root menu
User picks "1": text = "1"             → show sub-menu for option 1
User picks "2": text = "1*2"           → show sub-menu for option 1 → option 2
```

**Response format** — prefix your response text with:
- `CON ` — session continues, gateway shows this text and waits for more input
- `END ` — session terminates, gateway shows this text and closes

```
res.send("CON Welcome to Stawi\n1. My balance\n2. Transaction status\n3. Withdraw");
// ...later, on a terminal action...
res.send("END Withdrawal of KES 1,200 to M-Pesa initiated.");
```

Always respond `200` to the callback even on internal errors — return a graceful `END` message instead of letting the request hang or 500, or the farmer sees a dropped session.

## Stawi's USSD menu tree (mirrors the webapp's three actions)

```
Root (text = "")
  CON Welcome to Stawi
  1. My balance
  2. Transaction status
  3. Withdraw

Option 1 (text = "1")
  → call GET /accounts/{id}/balance on Stawi's internal API (looked up by phoneNumber)
  END Your Stawi balance: KES {amount}

Option 2 (text = "2")
  → call GET /accounts/{id}/transactions?limit=3
  END Recent: {invoice_ref} - {status} - KES {amount} ...

Option 3 (text = "3")
  CON Withdraw to:
  1. M-Pesa (registered number)
  2. Bank account (registered)
  → on selection ("3*1" or "3*2"):
  CON Enter amount (KES):
  → on amount ("3*1*1200"):
  CON Enter your Stawi PIN:
  → on PIN ("3*1*1200*1234"):
  → verify PIN server-side (rate-limited, lockout after repeated failures)
  → call POST /accounts/{id}/withdraw { destination, amount, idempotency_key: sessionId }
  END Withdrawal of KES {amount} to {destination} initiated.
```

The PIN step is mandatory in live. In sandbox demos it can be stubbed with a fixed test PIN, but build the step in from the start so live needs no menu redesign.

Session state (which menu level, which account) should be looked up fresh from `sessionId` + `phoneNumber` on every request — don't assume in-memory continuity across requests unless you're running a single persistent process; for a hackathon build, a simple `Map<sessionId, state>` in the same process as your USSD handler is fine, but a Redis-backed store is the production-correct pattern if there's time.

## SMS (notifications, not the primary interaction channel)

Use SMS for push notifications the farmer doesn't have to dial in for — e.g., "Your Stawi payout of KES 1,200 has landed" the moment a Payout Transaction completes. This is a good, low-effort addition once USSD read/withdraw works.

```javascript
const AfricasTalking = require('africastalking')({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME, // 'sandbox' in sandbox, your app username in live
});
const sms = AfricasTalking.SMS;

await sms.send({
  to: [farmerPhoneNumber], // international format, e.g. +2547XXXXXXXX
  message: `Stawi: your payout of KES ${amount} has landed in your ${destination} account.`,
  // Live only: approved alphanumeric sender ID or shortcode. Omit in sandbox.
  ...(process.env.AT_ENV === 'live' && { from: process.env.AT_SENDER_ID }),
});
```

Also handle delivery: check the `SMSMessageData.Recipients[].status` in the response, log failures, and don't let an SMS failure roll back or block a payout — notifications are best-effort, the Payout record is the truth.

## Demoing this honestly

Africa's Talking's sandbox dashboard includes a **built-in USSD simulator** — a web tool that mimics dialing the short code from a real phone, letting you step through the exact menu flow live without a telco integration or a real SIM. Use this for the demo. Present it plainly: *"this is a real, running USSD session against our sandbox — not a mockup"* — that's an honest, verifiable claim, and it's the same kind of transparency that scored well with judges on the corridor-coverage framing earlier in this project.
