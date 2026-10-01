import { demoDataVisible, includeInView } from "../services/demoData";
import { formatKes } from "../services/money";
import { pipeline } from "../services/pipeline";
import { store } from "../store";
import { Account } from "../types";

export type UssdScreen = {
  state: string;
  body: string;
  accountId: string | null;
};

const ROOT_MENU = "CON Welcome to Stawi\n1. My balance\n2. Transaction status\n3. Withdraw\n0. Exit";

function screen(state: string, body: string, accountId: string | null): UssdScreen {
  return { state, body, accountId };
}

/** Whole shillings only. `1000` becomes 100000 cents. */
function shillingsToCents(raw: string): number | null {
  if (!/^[1-9]\d{0,7}$/.test(raw)) return null;
  const shillings = Number(raw);
  if (!Number.isSafeInteger(shillings) || shillings <= 0) return null;
  const cents = shillings * 100;
  if (!Number.isSafeInteger(cents)) return null;
  return cents;
}

function withdrawalFailure(error: string | undefined, attemptsLeft?: number): UssdScreen {
  if (error === "locked") {
    return screen("withdraw_failed", "END Account locked. Try again in 15 minutes.", null);
  }
  if (error === "wrong") {
    return screen("withdraw_failed", `END Incorrect PIN. Attempts remaining: ${attemptsLeft ?? 0}`, null);
  }
  if (typeof error === "string" && error.toLowerCase().includes("insufficient")) {
    return screen("withdraw_failed", "END Not enough balance.", null);
  }
  return screen("withdraw_failed", "END Could not send the money. Try again.", null);
}

async function balanceScreen(account: Account): Promise<UssdScreen> {
  const formatted = formatKes(account.balance_kes_cents);
  const sampleCents = account.demo_balance_kes_cents ?? 0;
  const sample = demoDataVisible(account) && sampleCents > 0 ? `\nSample: KES ${formatKes(sampleCents)}` : "";
  return screen("balance", `END Your Stawi balance: KES ${formatted}${sample}`, account.id);
}

async function statusScreen(account: Account): Promise<UssdScreen> {
  const visible = demoDataVisible(account);
  const payouts = (await store.getPayoutsByAccount(account.id))
    .filter((payout) => includeInView(payout, visible))
    .slice(0, 3);
  if (payouts.length === 0) {
    return screen("status", "END No recent transactions found.", account.id);
  }

  const lines = await Promise.all(
    payouts.map(async (payout) => {
      const invoice = payout.invoice_id !== "withdrawal" ? await store.getInvoice(payout.invoice_id) : undefined;
      const ref = invoice?.reference || (payout.kind === "withdrawal" ? "Withdrawal" : payout.invoice_id);
      const label = payout.is_demo ? `Demo ${ref}` : ref;
      const statusWord = payout.status === "confirmed" ? "done" : payout.status;
      return `${label} - ${statusWord} - KES ${formatKes(payout.amount_kes_cents)}`;
    })
  );
  const headline = payouts[0]?.status === "confirmed" ? "Transaction done" : "Recent";
  return screen("status", `END ${headline}:\n${lines.join("\n")}`, account.id);
}

async function withdrawScreen(account: Account, segments: string[], sessionId: string): Promise<UssdScreen> {
  if (segments.length === 1) {
    return screen(
      "withdraw_destination",
      "CON Withdraw to:\n1. M-Pesa (registered number)\n2. Bank account (registered)",
      account.id
    );
  }

  const destChoice = segments[1];
  if (destChoice !== "1" && destChoice !== "2") {
    return screen("invalid", "END Invalid destination choice.", account.id);
  }
  const targetType = destChoice === "1" ? "mpesa" : "bank";

  if (segments.length === 2) {
    return screen("withdraw_amount", "CON Enter amount (KES):", account.id);
  }

  const amountCents = shillingsToCents(segments[2]);
  if (amountCents === null) {
    return screen("invalid", "END Invalid amount entered.", account.id);
  }

  if (segments.length === 3) {
    return screen("withdraw_pin", "CON Enter your Stawi PIN:", account.id);
  }

  if (segments.length !== 4) {
    return screen("invalid", "END Invalid selection. Please dial again.", account.id);
  }

  if (!/^\d{4}$/.test(segments[3])) {
    return screen("invalid", "END Enter a 4-digit PIN.", account.id);
  }

  const destination = account.payout_destinations.find((item) => item.type === targetType && item.is_verified);
  if (!destination) {
    const label = targetType === "mpesa" ? "M-Pesa" : "bank";
    return screen("withdraw_failed", `END No verified ${label} destination linked to your account.`, account.id);
  }

  const result = await pipeline.withdraw(account.id, destination.id, amountCents, segments[3], sessionId);
  if (!result.success) {
    const failed = withdrawalFailure(result.error, result.attemptsLeft);
    return { ...failed, accountId: account.id };
  }

  return screen(
    "withdraw_done",
    `END Withdrawal of KES ${formatKes(amountCents)} to ${destination.details} initiated.`,
    account.id
  );
}

/**
 * Africa's Talking sends the full *-joined path on every step.
 * The screen is a function of that path plus the account on this phone.
 */
export async function ussdScreen(input: { sessionId: string; phone: string; text: string }): Promise<UssdScreen> {
  const account = await store.getAccountByPhone(input.phone);
  if (!account) {
    return screen("unknown", "END No Stawi account for this number. Register on the Stawi app.", null);
  }
  if (account.channel_capability !== "webapp+ussd") {
    return screen("ussd_off", "END USSD is off for this account. Turn it on in the Stawi app.", account.id);
  }

  const segments = input.text ? input.text.split("*") : [];
  if (segments.length === 0) {
    return screen("root", ROOT_MENU, account.id);
  }

  const choice = segments[0];
  if (choice === "0" && segments.length === 1) {
    return screen("exit", "END Goodbye.", account.id);
  }
  if (choice === "1" && segments.length === 1) {
    return balanceScreen(account);
  }
  if (choice === "2" && segments.length === 1) {
    return statusScreen(account);
  }
  if (choice === "3") {
    return withdrawScreen(account, segments, input.sessionId);
  }
  return screen("invalid", "END Invalid selection. Please dial again.", account.id);
}
