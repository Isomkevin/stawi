import crypto from "crypto";
import { Request, Response, Router } from "express";
import { isMappingError, addPhoneMapping, grantAccountType, revokeAccountType, searchPhoneMappings } from "../services/phoneMappings";
import { ACCOUNT_TYPES, AccountType, PhoneMapping } from "../types";

const TYPE_LABEL: Record<AccountType, string> = {
  farmer: "Farmer",
  exporter: "Exporter",
  coop: "Co-op",
};

function adminSecret(): string {
  return (process.env.ADMIN_SECRET || "").trim();
}

function adminToken(secret: string): string {
  return crypto.createHmac("sha256", secret).update("stawi-admin-v1").digest("hex");
}

function readCookie(req: Request, name: string): string {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length === 0 || left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function adminCookie(secret: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `stawi_admin=${adminToken(secret)}; HttpOnly; Path=/admin; SameSite=Lax; Max-Age=${60 * 60 * 12}${secure}`;
}

function clearAdminCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `stawi_admin=; HttpOnly; Path=/admin; SameSite=Lax; Max-Age=0${secure}`;
}

function isAdmin(req: Request): boolean {
  const secret = adminSecret();
  if (!secret) return false;
  return safeEqual(readCookie(req, "stawi_admin"), adminToken(secret));
}

function requireAdmin(req: Request, res: Response): boolean {
  if (!adminSecret()) {
    res.status(404).json({ error: "Route not found" });
    return false;
  }
  if (!isAdmin(req)) {
    res.status(401).json({ error: "Admin sign-in required" });
    return false;
  }
  return true;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wantsJson(req: Request): boolean {
  return Boolean(req.is("application/json"));
}

function respondOk(req: Request, res: Response, query: string, notice: string, row: PhoneMapping): void {
  if (wantsJson(req)) {
    res.status(200).json(row);
    return;
  }
  redirectBack(res, query, notice);
}

function respondError(req: Request, res: Response, query: string, err: { status: number; message: string }): void {
  if (wantsJson(req)) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  redirectBack(res, query, undefined, err.message);
}
function redirectBack(res: Response, query: string, notice?: string, error?: string): void {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (notice) params.set("notice", notice);
  if (error) params.set("error", error);
  const suffix = params.toString();
  res.redirect(303, suffix ? `/admin/phones?${suffix}` : "/admin/phones");
}

function page(body: string, title = "Phone mappings"): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} — Stawi</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font: 15px/1.45 system-ui, sans-serif; background: #f4f1ea; color: #1c2416; }
    main { max-width: 960px; margin: 0 auto; padding: 28px 16px 64px; }
    h1 { font-size: 28px; margin: 0 0 6px; }
    p.lead { margin: 0 0 20px; color: #4d5744; }
    form.row, .tools { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    input[type="search"], input[type="tel"], input[type="password"] {
      min-height: 40px; padding: 0 12px; border: 1px solid #cfc6b4; border-radius: 10px; background: #fff; font: inherit;
    }
    button, .link {
      min-height: 36px; border-radius: 999px; border: 1px solid #1c2416; background: #1c2416; color: #fff;
      padding: 0 14px; font: inherit; cursor: pointer;
    }
    button.ghost { background: #fff; color: #1c2416; }
    button.warn { background: #fff; color: #8a3b24; border-color: #e2c2b6; }
    .card { background: #fff; border: 1px solid #e4dccb; border-radius: 16px; padding: 16px; margin-top: 16px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #eee6d8; vertical-align: top; }
    th { font-size: 12px; letter-spacing: 0.04em; text-transform: uppercase; color: #6b6456; }
    .types { display: flex; flex-wrap: wrap; gap: 6px; }
    .pill { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 2px 8px; background: #eef6df; }
    .muted { color: #6b6456; font-size: 13px; }
    .banner { padding: 10px 12px; border-radius: 10px; margin: 12px 0; }
    .ok { background: #e7f5d4; }
    .bad { background: #fde8e0; }
    .tag { font-size: 12px; border-radius: 999px; padding: 2px 8px; background: #efe8da; }
    .tag.multi { background: #d9ecb8; }
  </style>
</head>
<body>
  <main>
    <h1>Phone mappings</h1>
    ${body}
  </main>
</body>
</html>`;
}

function loginPage(error?: string): string {
  return page(`
    <p class="lead">Sign in to map a phone number to Farmer, Exporter, and Co-op. One number can hold more than one.</p>
    ${error ? `<p class="banner bad">${esc(error)}</p>` : ""}
    <form class="card row" method="post" action="/admin/phones/login">
      <label>Admin secret <input type="password" name="secret" autocomplete="current-password" required /></label>
      <button type="submit">Continue</button>
    </form>
  `);
}

function mappingRow(row: PhoneMapping, query: string): string {
  const label = row.account_types.map((type) => TYPE_LABEL[type]).join(" + ") || "None";
  const buttons = ACCOUNT_TYPES.map((type) => {
    const on = row.account_types.includes(type);
    const action = on ? "/admin/phones/revoke" : "/admin/phones/grant";
    return `<form method="post" action="${action}">
      <input type="hidden" name="phone_number" value="${esc(row.phone_number)}" />
      <input type="hidden" name="account_type" value="${type}" />
      <input type="hidden" name="q" value="${esc(query)}" />
      <button type="submit" class="${on ? "warn" : "ghost"}">${on ? "Remove" : "Add"} ${TYPE_LABEL[type]}</button>
    </form>`;
  }).join("");
  return `<tr>
    <td>
      <div>${esc(row.phone_number)}</div>
      <div class="muted">${esc(row.full_name || "No Stawi account yet")}${row.explicit ? "" : " · from the account"}</div>
    </td>
    <td>
      <div class="types"><span class="pill">${esc(label)}</span></div>
    </td>
    <td><span class="tag${row.multiple ? " multi" : ""}">${row.account_types.length > 1 ? "Multiple" : row.account_types.length === 1 ? "One" : "None"}</span></td>
    <td><div class="types">${buttons}</div></td>
  </tr>`;
}

function dashboard(rows: PhoneMapping[], query: string, notice?: string, error?: string): string {
  const bodyRows = rows.length
    ? rows.map((row) => mappingRow(row, query)).join("")
    : `<tr><td colspan="4" class="muted">No numbers match that search.</td></tr>`;
  return page(`
    <p class="lead">One phone number can be Farmer, Exporter, and Co-op at the same time. Adding or removing one type leaves the others in place.</p>
    ${notice ? `<p class="banner ok">${esc(notice)}</p>` : ""}
    ${error ? `<p class="banner bad">${esc(error)}</p>` : ""}
    <div class="tools">
      <form class="row" method="get" action="/admin/phones">
        <input type="search" name="q" value="${esc(query)}" placeholder="Search phone or name" />
        <button type="submit">Search</button>
      </form>
      <form class="row" method="post" action="/admin/phones">
        <input type="tel" name="phone_number" placeholder="+2547XXXXXXXX" required />
        <input type="hidden" name="q" value="${esc(query)}" />
        <button type="submit" class="ghost">Add phone</button>
      </form>
      <form method="post" action="/admin/phones/logout"><button type="submit" class="ghost">Sign out</button></form>
    </div>
    <div class="card">
      <table>
        <thead><tr><th>Phone</th><th>Account types</th><th></th><th>Map</th></tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
      <p class="muted">Showing ${rows.length} number${rows.length === 1 ? "" : "s"}. Numbers already on an account appear here before you add them.</p>
    </div>
  `);
}

async function sendDashboard(req: Request, res: Response): Promise<void> {
  const query = String(req.query.q || "");
  const notice = typeof req.query.notice === "string" ? req.query.notice : undefined;
  const error = typeof req.query.error === "string" ? req.query.error : undefined;
  const rows = await searchPhoneMappings(query);
  res.type("html").send(dashboard(rows, query, notice, error));
}

export function registerAdmin(router: Router): void {
  router.get("/admin/phones", async (req: Request, res: Response) => {
    if (!adminSecret()) {
      res.status(404).json({ error: "Route not found" });
      return;
    }
    if (!isAdmin(req)) {
      const error = typeof req.query.error === "string" ? req.query.error : undefined;
      res.type("html").send(loginPage(error));
      return;
    }
    await sendDashboard(req, res);
  });

  router.post("/admin/phones/login", (req: Request, res: Response) => {
    const secret = adminSecret();
    if (!secret) {
      res.status(404).json({ error: "Route not found" });
      return;
    }
    const given = String(req.body?.secret || "");
    if (!safeEqual(given, secret)) {
      res.type("html").status(401).send(loginPage("That secret isn't right."));
      return;
    }
    res.setHeader("Set-Cookie", adminCookie(secret));
    res.redirect(303, "/admin/phones");
  });

  router.post("/admin/phones/logout", (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie", clearAdminCookie());
    res.redirect(303, "/admin/phones");
  });

  router.post("/admin/phones", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const query = String(req.body?.q || "");
    try {
      const row = await addPhoneMapping(String(req.body?.phone_number || ""));
      respondOk(req, res, query, `Added ${row.phone_number}`, row);
    } catch (err) {
      if (!isMappingError(err)) throw err;
      respondError(req, res, query, err);
    }
  });

  router.post("/admin/phones/grant", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const query = String(req.body?.q || "");
    try {
      const row = await grantAccountType(String(req.body?.phone_number || ""), String(req.body?.account_type || ""));
      const label = TYPE_LABEL[String(req.body?.account_type) as AccountType] || "that type";
      respondOk(req, res, query, `${row.phone_number} now includes ${label}`, row);
    } catch (err) {
      if (!isMappingError(err)) throw err;
      respondError(req, res, query, err);
    }
  });

  router.post("/admin/phones/revoke", async (req: Request, res: Response) => {
    if (!requireAdmin(req, res)) return;
    const query = String(req.body?.q || "");
    try {
      const row = await revokeAccountType(String(req.body?.phone_number || ""), String(req.body?.account_type || ""));
      const label = TYPE_LABEL[String(req.body?.account_type) as AccountType] || "that type";
      respondOk(req, res, query, `Removed ${label} from ${row.phone_number}`, row);
    } catch (err) {
      if (!isMappingError(err)) throw err;
      respondError(req, res, query, err);
    }
  });
}
