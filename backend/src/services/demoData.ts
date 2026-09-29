import { Account, Payout } from "../types";
import { PayazaMode } from "./payaza";

/**
 * What the Settings switch does. Returned by the API so every client shows the same meaning.
 * Demo data is a visibility preference. It is not PAYAZA_MODE and it does not relabel new payments.
 */
export const DEMO_DATA_EFFECT =
  "Shows sample records, labelled Demo, alongside live transactions. It does not switch Payaza mode, block live payments, or mark new invoices as sample. Turning it off hides sample records and keeps them stored. Live balance is what sandbox and live payouts can send. Sample balance stays separate, and it can be withdrawn only while Payaza is in mock mode.";

/** Env default when the account has no saved override. Production hides sample rows unless DEMO_DATA_ENABLED=true. */
export function demoDataDefault(): boolean {
  const raw = (process.env.DEMO_DATA_ENABLED ?? "").trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "on") return true;
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return process.env.NODE_ENV !== "production";
}

/** Saved account value wins. Null or a missing account follows the env default. */
export function demoDataVisible(account?: Account | null): boolean {
  if (account && account.demo_data_enabled != null) return account.demo_data_enabled;
  return demoDataDefault();
}

export function isDemo(record: { is_demo?: boolean } | null | undefined): boolean {
  return record?.is_demo === true;
}

export function includeInView<T extends { is_demo?: boolean }>(record: T, visible: boolean): boolean {
  return visible || !isDemo(record);
}

export function parseDemoDataEnabled(value: unknown): boolean | null | undefined {
  if (value === null) return null;
  if (value === true || value === false) return value;
  return undefined;
}

export function creditBalance(account: Account, cents: number, demo: boolean): void {
  if (demo) account.demo_balance_kes_cents = (account.demo_balance_kes_cents ?? 0) + cents;
  else account.balance_kes_cents += cents;
}

export function creditIncoming(account: Account, cents: number, demo: boolean): void {
  if (demo) account.demo_incoming_kes_cents = (account.demo_incoming_kes_cents ?? 0) + cents;
  else account.incoming_kes_cents += cents;
}

export function releaseIncoming(account: Account, cents: number, demo: boolean): void {
  if (demo) {
    account.demo_incoming_kes_cents = Math.max(0, (account.demo_incoming_kes_cents ?? 0) - cents);
  } else {
    account.incoming_kes_cents = Math.max(0, account.incoming_kes_cents - cents);
  }
}

/**
 * Live funds are spent first. Sample funds are included only in mock mode, where Payaza is not called for real.
 * A payout is sample-only when none of it came from the live balance.
 */
export function allocateWithdrawal(
  account: Account,
  amountKesCents: number,
  mode: PayazaMode
): { ok: true; fromLive: number; fromDemo: number } | { ok: false; error: string } {
  const live = account.balance_kes_cents;
  const demo = account.demo_balance_kes_cents ?? 0;
  const canUseDemo = mode === "mock";
  const available = live + (canUseDemo ? demo : 0);
  if (amountKesCents > available) {
    const shown = (canUseDemo ? available : live) / 100;
    const sampleNote = !canUseDemo && demo > 0 ? " Sample funds are not included in payouts." : "";
    return {
      ok: false,
      error: `Insufficient balance. Available: KES ${shown.toFixed(2)}.${sampleNote}`,
    };
  }
  const fromLive = Math.min(live, amountKesCents);
  return { ok: true, fromLive, fromDemo: amountKesCents - fromLive };
}

export function applyWithdrawal(account: Account, fromLive: number, fromDemo: number): void {
  account.balance_kes_cents -= fromLive;
  account.demo_balance_kes_cents = (account.demo_balance_kes_cents ?? 0) - fromDemo;
}

export function restoreWithdrawal(account: Account, payout: Payout): void {
  const fromDemo = payout.demo_portion_kes_cents ?? (payout.is_demo ? payout.amount_kes_cents : 0);
  const fromLive = payout.amount_kes_cents - fromDemo;
  account.balance_kes_cents += fromLive;
  account.demo_balance_kes_cents = (account.demo_balance_kes_cents ?? 0) + fromDemo;
}

export function withdrawalFlags(fromLive: number, fromDemo: number): Pick<Payout, "is_demo" | "demo_portion_kes_cents"> {
  return {
    is_demo: fromLive === 0 && fromDemo > 0,
    demo_portion_kes_cents: fromDemo,
  };
}
