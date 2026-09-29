import crypto from "crypto";
import { NextFunction, Request, Response } from "express";
import { notify } from "./notify";
import { payaza } from "./payaza";
import { sessionAccess, SessionRole } from "./phoneMappings";
import { store } from "../store";
import { Account, AccountType } from "../types";

const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

declare global {
  namespace Express {
    interface Request {
      account?: Account;
    }
  }
}

export function authRequired(): boolean {
  if (process.env.AUTH_REQUIRED === "false") return false;
  if (process.env.AUTH_REQUIRED === "true") return true;
  if (process.env.NODE_ENV === "production") return true;
  const mode = process.env.PAYAZA_MODE;
  return mode === "sandbox" || mode === "live";
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function hashCode(phone: string, code: string): string {
  return crypto.createHash("sha256").update(`${store.normalizePhone(phone)}:${code}`).digest("hex");
}

function masterLoginCode(): string {
  return (process.env.MASTER_LOGIN_CODE || "").trim();
}

function codesMatch(entered: string, expected: string): boolean {
  const a = Buffer.from(entered);
  const b = Buffer.from(expected);
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function issueSession(account: Account): Promise<{
  token: string;
  account: Account;
  role: SessionRole;
  roles: SessionRole[];
  account_types: AccountType[];
}> {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await store.saveSession(hashToken(token), account.id, expires);
  const access = await sessionAccess(account);
  return { token, account, ...access };
}

export function requestTokens(req: Request): string[] {
  const tokens: string[] = [];
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token) tokens.push(token);
  }
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/(?:^|;\s*)stawi_session=([^;]+)/);
  if (match) {
    const token = decodeURIComponent(match[1]);
    if (token && !tokens.includes(token)) tokens.push(token);
  }
  return tokens;
}

export function readToken(req: Request): string | null {
  return requestTokens(req)[0] ?? null;
}

export async function attachAccount(req: Request): Promise<void> {
  for (const token of requestTokens(req)) {
    const account = await store.getSessionAccount(hashToken(token));
    if (account) {
      req.account = account;
      return;
    }
  }
}

export async function requestOtp(
  phone: string
): Promise<{ sent: true; dev_code?: string } | { error: string; status: number }> {
  const account = await store.getAccountByPhone(phone);
  if (!account) return { sent: true };

  const code = crypto.randomInt(100000, 1000000).toString();
  const expires = new Date(Date.now() + OTP_TTL_MS).toISOString();
  await store.saveOtp(phone, hashCode(phone, code), expires);

  const sms = await notify.sendSms(account.phone_number, `Stawi login code: ${code}. It expires in 5 minutes.`);
  const showCode = devCodesEnabled();
  if (!showCode && (sms.dryRun || !sms.success)) {
    await store.deleteOtp(phone);
    return { error: "Could not send the login code", status: 502 };
  }
  return showCode ? { sent: true, dev_code: code } : { sent: true };
}

/** Login screen can show the code. Never in production. Mock does this by default; OTP_DEV_CODES=true forces it. */
export function devCodesEnabled(): boolean {
  if (process.env.NODE_ENV === "production") return false;
  if (process.env.OTP_DEV_CODES === "false") return false;
  if (process.env.OTP_DEV_CODES === "true") return true;
  return payaza.getMode() === "mock";
}

export async function verifyOtp(
  phone: string,
  code: string
): Promise<
  | {
      token: string;
      account: Account;
      role: SessionRole;
      roles: SessionRole[];
      account_types: AccountType[];
    }
  | { error: string; status: number }
> {
  const master = masterLoginCode();
  if (master && codesMatch(code.trim(), master)) {
    const account = await store.getAccountByPhone(phone);
    if (!account) return { error: "Account not found", status: 404 };
    await store.deleteOtp(phone);
    return issueSession(account);
  }

  const row = await store.getOtp(phone);
  if (!row || new Date(row.expiresAt).getTime() <= Date.now()) {
    return { error: "Code expired. Request a new one.", status: 401 };
  }
  if (row.attempts >= MAX_OTP_ATTEMPTS) {
    await store.deleteOtp(phone);
    return { error: "Too many attempts. Request a new code.", status: 401 };
  }

  const expected = hashCode(phone, code);
  const a = Buffer.from(row.codeHash);
  const b = Buffer.from(expected);
  const matches = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!matches) {
    await store.incrementOtpAttempts(phone);
    return { error: "That code isn't right.", status: 401 };
  }

  const account = await store.getAccountByPhone(phone);
  if (!account) return { error: "Account not found", status: 404 };
  await store.deleteOtp(phone);
  return issueSession(account);
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure; SameSite=None" : "; SameSite=Lax";
  return `stawi_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}${secure}`;
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure; SameSite=None" : "; SameSite=Lax";
  return `stawi_session=; HttpOnly; Path=/; Max-Age=0${secure}`;
}

export async function ownsAccount(actor: Account, accountId: string, write: boolean): Promise<boolean> {
  if (actor.id === accountId) return true;
  if (write) return false;
  const coops = await store.getAllCoops();
  const treasurerCoop = coops.find((c) => c.treasurer_account_id === actor.id);
  if (!treasurerCoop) return false;
  const target = await store.getAccount(accountId);
  return Boolean(target && target.coop_id === treasurerCoop.id);
}

export function isPublicRoute(method: string, path: string): boolean {
  if (method === "GET" && path === "/health") return true;
  if (method === "POST" && path === "/accounts") return true;
  if (method === "POST" && path === "/name-enquiry") return true;
  if (method === "POST" && (path === "/auth/otp" || path === "/auth/verify")) return true;
  if (method === "GET" && /^\/invoices\/[^/]+$/.test(path)) return true;
  if (method === "POST" && /^\/invoices\/[^/]+\/checkout-session$/.test(path)) return true;
  if (method === "POST" && path === "/webhooks/payaza") return true;
  if (method === "POST" && path === "/ussd/callback") return true;
  if (path.startsWith("/dev/")) return true;
  if (path.startsWith("/admin")) return true;
  return false;
}

export async function enforceAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await attachAccount(req);
    if (!authRequired() || isPublicRoute(req.method, req.path)) {
      next();
      return;
    }
    if (!req.account) {
      res.status(401).json({ error: "Sign in required" });
      return;
    }

    const accountMatch = req.path.match(/^\/accounts\/([^/]+)/);
    if (accountMatch) {
      const ok = await ownsAccount(req.account, decodeURIComponent(accountMatch[1]), req.method !== "GET");
      if (!ok) {
        res.status(403).json({ error: "You can only act on your own account" });
        return;
      }
    }

    const coopMatch = req.path.match(/^\/coops\/([^/]+)/);
    if (coopMatch) {
      const coop = await store.getCoop(decodeURIComponent(coopMatch[1]));
      if (!coop || coop.treasurer_account_id !== req.account.id) {
        res.status(403).json({ error: "Only the co-op treasurer can do this" });
        return;
      }
    }

    const shipmentMatch = req.path.match(/^\/shipments\/([^/]+)(?:\/farmers(?:\/[^/]+)?)?$/);
    if (shipmentMatch && (req.method === "PATCH" || req.method === "DELETE" || req.method === "POST")) {
      const shipment = await store.getShipment(decodeURIComponent(shipmentMatch[1]));
      if (!shipment) {
        res.status(404).json({ error: "Shipment not found" });
        return;
      }
      if (shipment.account_id) {
        if (shipment.account_id !== req.account.id) {
          res.status(403).json({ error: "Only the exporter can do this" });
          return;
        }
      } else {
        const coop = await store.getCoop(shipment.coop_id);
        if (!coop || coop.treasurer_account_id !== req.account.id) {
          res.status(403).json({ error: "Only the co-op treasurer can do this" });
          return;
        }
      }
    }

    if (req.method === "POST" && req.path === "/coops" && req.body?.treasurer_account_id !== req.account.id) {
      res.status(403).json({ error: "You can only create a co-op for your own account" });
      return;
    }

    if (req.method === "POST" && req.path === "/invoices") {
      if (req.body?.type === "direct" && req.body.account_id !== req.account.id) {
        res.status(403).json({ error: "You can only invoice for your own account" });
        return;
      }
      if (req.body?.type === "coop") {
        const coop = await store.getCoop(req.body.coop_id);
        if (!coop || coop.treasurer_account_id !== req.account.id) {
          res.status(403).json({ error: "Only the co-op treasurer can invoice for the co-op" });
          return;
        }
      }
    }

    if (req.method === "GET" && req.path === "/invoices") {
      if (req.query.account_id && !(await ownsAccount(req.account, String(req.query.account_id), false))) {
        res.status(403).json({ error: "You can only view your own invoices" });
        return;
      }
      if (req.query.coop_id) {
        const coop = await store.getCoop(String(req.query.coop_id));
        if (!coop || coop.treasurer_account_id !== req.account.id) {
          res.status(403).json({ error: "Only the co-op treasurer can view these invoices" });
          return;
        }
      }
    }

    if (req.method === "DELETE" && /^\/invoices\/[^/]+$/.test(req.path)) {
      const invoiceId = decodeURIComponent(req.path.split("/")[2] || "");
      const invoice = await store.getInvoice(invoiceId);
      if (!invoice) {
        res.status(404).json({ error: "Invoice not found" });
        return;
      }
      if (invoice.type === "coop" || invoice.coop_id) {
        const coop = invoice.coop_id ? await store.getCoop(invoice.coop_id) : undefined;
        if (!coop || coop.treasurer_account_id !== req.account.id) {
          res.status(403).json({ error: "Only the co-op treasurer can delete this invoice" });
          return;
        }
      } else if (invoice.account_id !== req.account.id) {
        res.status(403).json({ error: "You can only delete your own invoice" });
        return;
      }
    }

    if (req.method === "POST" && /^\/invoices\/[^/]+\/approve-split$/.test(req.path)) {
      if (req.body?.treasurer_id && req.body.treasurer_id !== req.account.id) {
        res.status(403).json({ error: "Only the co-op treasurer can approve splits" });
        return;
      }
    }

    next();
  } catch (err) {
    next(err);
  }
}
