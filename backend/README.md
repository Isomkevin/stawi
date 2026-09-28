# Stawi backend

Express + TypeScript API for Stawi Direct and Stawi Co-op: invoice -> Payaza checkout -> conversion -> credit/split -> withdraw, plus the Africa's Talking USSD/SMS channel. Deployed separately from the frontend; consumed over HTTPS.

```bash
cp .env.example .env && npm install
npm run dev            # http://localhost:4000, mock mode, seeded demo data (PIN 1234)
npm test               # unit tests
python3 scripts/e2e.py http://localhost:4000 <AT_CALLBACK_SECRET>   # end-to-end check
npm run build && npm start
```

Docs: `../docs/` (start with `SCAFFOLD.md`). API contract: `../docs/LOVABLE_PROMPT.md` §8. Payaza work: `../docs/skills/payaza/SKILL.md`. USSD/SMS: `../docs/skills/africas-talking/SKILL.md`.

Rules: only `src/services/payaza.ts` talks to Payaza; money is integer KES cents; every money-moving endpoint is idempotent; env-switchable (`PAYAZA_MODE`, `AT_ENV`).
