import { store } from "../store";
import { ACCOUNT_TYPES, Account, AccountType, PhoneMapping } from "../types";
import { PhoneError, requireKenyanPhone } from "./phone";

export class MappingError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = "MappingError";
  }
}

export type SessionRole = "farmer" | "exporter" | "treasurer";

function parseAccountType(value: string): AccountType {
  if ((ACCOUNT_TYPES as readonly string[]).includes(value)) return value as AccountType;
  throw new MappingError("Account type must be farmer, exporter, or coop", 400);
}

export async function derivedAccountTypes(account: Account): Promise<AccountType[]> {
  const coops = await store.getAllCoops();
  if (coops.some((coop) => coop.treasurer_account_id === account.id)) return ["coop"];
  if (account.coop_id) return ["farmer"];
  return ["exporter"];
}

export function toSessionRoles(types: AccountType[]): SessionRole[] {
  const roles: SessionRole[] = [];
  if (types.includes("farmer")) roles.push("farmer");
  if (types.includes("exporter")) roles.push("exporter");
  if (types.includes("coop")) roles.push("treasurer");
  return roles;
}

/** Older clients still receive one role. Treasurer, then farmer, then exporter. */
export function primaryRole(roles: SessionRole[]): SessionRole {
  if (roles.includes("treasurer")) return "treasurer";
  if (roles.includes("farmer")) return "farmer";
  if (roles.includes("exporter")) return "exporter";
  return "exporter";
}

async function currentTypes(phone: string): Promise<AccountType[]> {
  const explicit = await store.getExplicitAccountTypes(phone);
  if (explicit) return explicit;
  const account = await store.getAccountByPhone(phone);
  if (!account) return [];
  return derivedAccountTypes(account);
}

async function viewFor(phone: string): Promise<PhoneMapping> {
  const normalized = store.normalizePhone(phone);
  const account = await store.getAccountByPhone(normalized);
  const explicit = await store.getExplicitAccountTypes(normalized);
  const account_types = explicit ?? (account ? await derivedAccountTypes(account) : []);
  return {
    phone_number: normalized,
    account_id: account?.id ?? null,
    full_name: account?.full_name ?? null,
    account_types,
    explicit: explicit !== null,
    multiple: account_types.length > 1,
  };
}

function matchesQuery(row: PhoneMapping, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (row.full_name?.toLowerCase().includes(q)) return true;
  const qDigits = q.replace(/\D/g, "");
  if (!qDigits) return row.phone_number.toLowerCase().includes(q);
  const phoneDigits = row.phone_number.replace(/\D/g, "");
  const national = qDigits.startsWith("0")
    ? qDigits.slice(1)
    : qDigits.startsWith("254")
      ? qDigits.slice(3)
      : qDigits;
  return phoneDigits.includes(qDigits) || (national.length >= 9 && phoneDigits.endsWith(national));
}

export async function searchPhoneMappings(query: string): Promise<PhoneMapping[]> {
  const accounts = await store.getAllAccounts();
  const explicitRows = await store.listExplicitAccountTypes();
  const explicitByPhone = new Map(explicitRows.map((row) => [row.phone_number, row.account_types]));
  const coops = await store.getAllCoops();
  const byPhone = new Map<string, PhoneMapping>();

  for (const account of accounts) {
    const phone = store.normalizePhone(account.phone_number);
    const saved = explicitByPhone.get(phone);
    const account_types =
      saved ??
      (coops.some((coop) => coop.treasurer_account_id === account.id)
        ? (["coop"] as AccountType[])
        : account.coop_id
          ? (["farmer"] as AccountType[])
          : (["exporter"] as AccountType[]));
    byPhone.set(phone, {
      phone_number: phone,
      account_id: account.id,
      full_name: account.full_name,
      account_types,
      explicit: saved !== undefined,
      multiple: account_types.length > 1,
    });
  }

  for (const row of explicitRows) {
    if (byPhone.has(row.phone_number)) continue;
    byPhone.set(row.phone_number, {
      phone_number: row.phone_number,
      account_id: null,
      full_name: null,
      account_types: row.account_types,
      explicit: true,
      multiple: row.account_types.length > 1,
    });
  }

  return Array.from(byPhone.values())
    .filter((row) => matchesQuery(row, query))
    .sort((a, b) => a.phone_number.localeCompare(b.phone_number))
    .slice(0, 200);
}

export async function addPhoneMapping(raw: string): Promise<PhoneMapping> {
  const phone = requireKenyanPhone(raw);
  const existing = await store.getExplicitAccountTypes(phone);
  const account = await store.getAccountByPhone(phone);
  if (existing || account) {
    throw new MappingError("This phone number is already listed", 409);
  }
  await store.saveExplicitAccountTypes(phone, []);
  return viewFor(phone);
}

export async function grantAccountType(raw: string, type: string): Promise<PhoneMapping> {
  const phone = requireKenyanPhone(raw);
  const accountType = parseAccountType(type);
  const current = await currentTypes(phone);
  if (current.includes(accountType)) {
    throw new MappingError("This number is already mapped to that account type", 409);
  }
  await store.withTransaction(async () => {
    await store.saveExplicitAccountTypes(phone, [...current, accountType]);
  });
  return viewFor(phone);
}

export async function revokeAccountType(raw: string, type: string): Promise<PhoneMapping> {
  const phone = requireKenyanPhone(raw);
  const accountType = parseAccountType(type);
  const current = await currentTypes(phone);
  if (!current.includes(accountType)) {
    throw new MappingError("This number is not mapped to that account type", 404);
  }
  await store.withTransaction(async () => {
    await store.saveExplicitAccountTypes(
      phone,
      current.filter((item) => item !== accountType)
    );
  });
  return viewFor(phone);
}

export async function sessionAccess(account: Account): Promise<{
  role: SessionRole;
  roles: SessionRole[];
  account_types: AccountType[];
}> {
  const explicit = await store.getExplicitAccountTypes(account.phone_number);
  const account_types = explicit ?? (await derivedAccountTypes(account));
  const roles = toSessionRoles(account_types);
  const fallback = toSessionRoles(await derivedAccountTypes(account));
  return {
    account_types,
    roles,
    role: roles.length ? primaryRole(roles) : primaryRole(fallback),
  };
}

export function isMappingError(err: unknown): err is MappingError | PhoneError {
  return err instanceof MappingError || err instanceof PhoneError;
}
