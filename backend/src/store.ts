// In-memory store so the whole product runs with zero setup.
// TODO: swap for Postgres (schema in db/schema.sql) behind this same interface.
import type { Account, Coop, CoopMember, Invoice, Payout, Transaction } from "./types.js";

export const db = {
  accounts: new Map<string, Account>(),
  coops: new Map<string, Coop>(),
  members: [] as CoopMember[],
  invoices: new Map<string, Invoice>(),
  transactions: [] as Transaction[],
  payouts: [] as Payout[],
};

export const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}`;
export const now = () => new Date().toISOString();

export const accountByPhone = (phone: string) =>
  [...db.accounts.values()].find((a) => a.phone_number.replace(/\D/g, "").endsWith(phone.replace(/\D/g, "").slice(-9)));
