import { Request, Response } from "express";
import { demoDataVisible, includeInView } from "../services/demoData";
import { pipeline } from "../services/pipeline";
import { store } from "../store";

export async function handleUssdCallback(req: Request, res: Response): Promise<void> {
  // 1. Secret Validation (check query param `s` or header `x-ussd-secret`)
  const expectedSecret = process.env.AT_CALLBACK_SECRET;
  if (expectedSecret) {
    const querySecret = req.query.s as string | undefined;
    const headerSecret = req.headers["x-ussd-secret"] as string | undefined;
    if (querySecret !== expectedSecret && headerSecret !== expectedSecret) {
      res.status(401).send("Unauthorized: Invalid callback secret");
      return;
    }
  }

  // AT USSD POST fields can be in req.body (urlencoded or json)
  const sessionId = (req.body.sessionId || req.query.sessionId || "") as string;
  const phoneNumber = (req.body.phoneNumber || req.query.phoneNumber || "") as string;
  const text = (req.body.text !== undefined ? req.body.text : (req.query.text || "")) as string;

  res.setHeader("Content-Type", "text/plain");

  try {
    await renderUssdMenu(res, sessionId, phoneNumber, text);
  } catch (err) {
    console.error("[USSD] Handler error:", err);
    res.status(200).send("END Stawi is unavailable right now. Please dial again.");
  }
}

async function renderUssdMenu(res: Response, sessionId: string, phoneNumber: string, text: string): Promise<void> {
  const segments = text ? text.split("*") : [];
  const level = segments.length;

  // Root Menu
  if (level === 0 || text === "") {
    res.status(200).send("CON Welcome to Stawi\n1. My balance\n2. Transaction status\n3. Withdraw");
    return;
  }

  const rootChoice = segments[0];

  // Option 1: My balance
  if (rootChoice === "1") {
    const account = await store.getAccountByPhone(phoneNumber);
    if (!account) {
      res.status(200).send("END Stawi account not found for this phone number.");
      return;
    }

    const formatted = (account.balance_kes_cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const sampleCents = account.demo_balance_kes_cents ?? 0;
    const sample =
      demoDataVisible(account) && sampleCents > 0
        ? `\nSample: KES ${(sampleCents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : "";
    res.status(200).send(`END Your Stawi balance: KES ${formatted}${sample}`);
    return;
  }

  // Option 2: Transaction status
  if (rootChoice === "2") {
    const account = await store.getAccountByPhone(phoneNumber);
    if (!account) {
      res.status(200).send("END Stawi account not found for this phone number.");
      return;
    }

    const visible = demoDataVisible(account);
    const payouts = (await store.getPayoutsByAccount(account.id))
      .filter((payout) => includeInView(payout, visible))
      .slice(0, 3);
    if (payouts.length === 0) {
      res.status(200).send("END No recent transactions found.");
      return;
    }

    const lines = await Promise.all(payouts.map(async (p) => {
      const amt = (p.amount_kes_cents / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
      });
      const invoice = p.invoice_id !== "withdrawal" ? await store.getInvoice(p.invoice_id) : undefined;
      const ref = invoice?.reference || (p.kind === "withdrawal" ? "Withdrawal" : p.invoice_id);
      const label = p.is_demo ? `Demo ${ref}` : ref;
      return `${label} - ${p.status} - KES ${amt}`;
    }));

    res.status(200).send(`END Recent:\n${lines.join("\n")}`);
    return;
  }

  // Option 3: Withdraw
  if (rootChoice === "3") {
    // 3 -> Choose destination
    if (level === 1) {
      res.status(200).send("CON Withdraw to:\n1. M-Pesa (registered number)\n2. Bank account (registered)");
      return;
    }

    const destChoice = segments[1];
    if (destChoice !== "1" && destChoice !== "2") {
      res.status(200).send("END Invalid destination choice.");
      return;
    }

    // 3*1 or 3*2 -> Enter amount
    if (level === 2) {
      res.status(200).send("CON Enter amount (KES):");
      return;
    }

    const rawAmount = segments[2];
    const amountNum = parseFloat(rawAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      res.status(200).send("END Invalid amount entered.");
      return;
    }

    // 3*1*amt or 3*2*amt -> Enter PIN
    if (level === 3) {
      res.status(200).send("CON Enter your Stawi PIN:");
      return;
    }

    // 3*1*amt*pin -> Process withdrawal
    if (level === 4) {
      const pin = segments[3];
      const account = await store.getAccountByPhone(phoneNumber);
      if (!account) {
        res.status(200).send("END Stawi account not found for this phone number.");
        return;
      }

      const targetType = destChoice === "1" ? "mpesa" : "bank";
      const destination = account.payout_destinations.find(
        (d) => d.type === targetType && d.is_verified
      );

      if (!destination) {
        res.status(200).send(`END No verified ${targetType.toUpperCase()} destination linked to your account.`);
        return;
      }

      const amountCents = Math.round(amountNum * 100);

      // Perform withdrawal with sessionId as idempotency_key
      const result = await pipeline.withdraw(
        account.id,
        destination.id,
        amountCents,
        pin,
        sessionId
      );

      if (!result.success) {
        if (result.error === "locked") {
          res.status(200).send("END Account locked due to repeated PIN failures. Try again in 15 minutes.");
          return;
        }
        if (result.error === "wrong") {
          res.status(200).send(`END Incorrect PIN. Attempts remaining: ${result.attemptsLeft ?? 0}`);
          return;
        }
        res.status(200).send(`END Withdrawal failed: ${result.error}`);
        return;
      }

      const formatted = (amountCents / 100).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

      res.status(200).send(`END Withdrawal of KES ${formatted} to ${destination.details} initiated.`);
      return;
    }
  }

  res.status(200).send("END Invalid selection. Please dial again.");
}
