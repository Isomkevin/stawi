import { Router, Request, Response } from "express";
import { SEED_IDS } from "../data/seed";
import { feeCents, toKesCents } from "../services/money";
import { clearSessionCookie, enforceAuth, hashToken, issueSession, requestOtp, requestTokens, sessionCookie, verifyOtp } from "../services/auth";
import { classifyPayazaWebhook, payaza } from "../services/payaza";
import { hashPin } from "../services/pin";
import { pipeline } from "../services/pipeline";
import { addShipmentFarmer, advanceShipment, openShipmentForInvoice, removeShipmentFarmer } from "../services/shipments";
import { store } from "../store";
import { Account, CoopMetrics, CoopMetricsBucket, CoopMember, DemoDataSettings, Invoice, PublicAccount, UNRESOLVED_ACCOUNT_NAME } from "../types";
import { DEMO_DATA_EFFECT, demoDataDefault, demoDataVisible, includeInView, isDemo, parseDemoDataEnabled } from "../services/demoData";
import { handleUssdCallback } from "../ussd/handler";
import { registerAdmin } from "./admin";

export const apiRouter = Router();
registerAdmin(apiRouter);

apiRouter.use(enforceAuth);

function getParam(param: string | string[] | undefined): string {
  if (Array.isArray(param)) return param[0] || "";
  return param || "";
}

/** Seller label for the public pay page. Does not include member phones or account numbers. */
async function publicPayee(invoice: Invoice): Promise<{ payee_name: string; farmer_count: number | null }> {
  if (invoice.type === "coop" && invoice.coop_id) {
    const coop = await store.getCoop(invoice.coop_id);
    const members = await store.getCoopMembers(invoice.coop_id);
    return { payee_name: coop?.name || "Stawi seller", farmer_count: members.length };
  }
  if (invoice.account_id) {
    const account = await store.getAccount(invoice.account_id);
    return { payee_name: account?.full_name || "Stawi seller", farmer_count: null };
  }
  return { payee_name: "Stawi seller", farmer_count: null };
}

function toPublicAccount(account: Account, viewer?: Account): PublicAccount {
  const visible = demoDataVisible(viewer ?? account);
  const {
    pin_hash,
    pin_failed_attempts,
    pin_locked_until,
    demo_balance_kes_cents,
    demo_incoming_kes_cents,
    ...rest
  } = account;
  const base: PublicAccount = {
    ...rest,
    is_demo: account.is_demo === true,
    demo_data_enabled: account.demo_data_enabled ?? null,
    demo_data_visible: demoDataVisible(account),
  };
  if (!visible) return base;
  return {
    ...base,
    demo_balance_kes_cents: demo_balance_kes_cents ?? 0,
    demo_incoming_kes_cents: demo_incoming_kes_cents ?? 0,
  };
}

function seesDemo(req: Request): boolean {
  return demoDataVisible(req.account);
}

function demoSettings(account: Account): DemoDataSettings {
  return {
    demo_data_enabled: account.demo_data_enabled ?? null,
    demo_data_visible: demoDataVisible(account),
    demo_data_default: demoDataDefault(),
    effect: DEMO_DATA_EFFECT,
  };
}

function metricsBucket(invoices: Invoice[]): CoopMetricsBucket {
  let total_collected_kes_cents = 0;
  let fee_taken_kes_cents = 0;
  let total_split_kes_cents = 0;
  for (const inv of invoices) {
    if (inv.status === "completed" || inv.status === "settling") {
      total_collected_kes_cents += (inv.kes_total_cents || 0) + (inv.fee_kes_cents || 0);
      fee_taken_kes_cents += inv.fee_kes_cents || 0;
      if (inv.split_approved) total_split_kes_cents += inv.kes_total_cents || 0;
    }
  }
  return {
    invoices: invoices.length,
    total_collected_kes_cents,
    fee_taken_kes_cents,
    total_split_kes_cents,
  };
}

function presentMetrics(invoices: Invoice[], visible: boolean): CoopMetrics {
  const live = metricsBucket(invoices.filter((invoice) => !isDemo(invoice)));
  const demo = metricsBucket(invoices.filter((invoice) => isDemo(invoice)));
  const shown = visible
    ? {
        invoices: live.invoices + demo.invoices,
        total_collected_kes_cents: live.total_collected_kes_cents + demo.total_collected_kes_cents,
        fee_taken_kes_cents: live.fee_taken_kes_cents + demo.fee_taken_kes_cents,
        total_split_kes_cents: live.total_split_kes_cents + demo.total_split_kes_cents,
      }
    : live;
  return {
    ...shown,
    avg_payout_time: "Same day (< 2 hrs)",
    live,
    ...(visible ? { demo } : {}),
  };
}

// -------------------------------------------------------------
// Health
// -------------------------------------------------------------
apiRouter.get("/health", async (req: Request, res: Response) => {
  res.status(200).json({ status: "ok" });
});

apiRouter.post("/auth/otp", async (req: Request, res: Response) => {
  const phone = req.body?.phone_number;
  if (!phone) {
    res.status(400).json({ error: "Missing phone_number" });
    return;
  }
  const result = await requestOtp(String(phone));
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(200).json(result);
});

apiRouter.post("/auth/verify", async (req: Request, res: Response) => {
  const phone = req.body?.phone_number;
  const code = req.body?.code;
  if (!phone || !code) {
    res.status(400).json({ error: "Missing phone_number or code" });
    return;
  }
  const result = await verifyOtp(String(phone), String(code));
  if ("error" in result) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.setHeader("Set-Cookie", sessionCookie(result.token));
  res.status(200).json({
    token: result.token,
    account_id: result.account.id,
    role: result.role,
    roles: result.roles,
    account_types: result.account_types,
    account: toPublicAccount(result.account),
  });
});

apiRouter.post("/auth/logout", async (req: Request, res: Response) => {
  for (const token of requestTokens(req)) await store.deleteSession(hashToken(token));
  res.setHeader("Set-Cookie", clearSessionCookie());
  res.status(204).end();
});

// -------------------------------------------------------------
// Accounts
// -------------------------------------------------------------
apiRouter.post("/accounts", async (req: Request, res: Response) => {
  try {
    const {
      full_name,
      phone_number,
      id_number,
      pin,
      destination,
      ussd,
      coop_id,
    } = req.body;

    if (!full_name || !phone_number || !id_number || !pin) {
      res.status(400).json({ error: "Missing required fields (full_name, phone_number, id_number, pin)" });
      return;
    }

    if (!/^\d{4}$/.test(String(pin))) {
      res.status(400).json({ error: "PIN must be exactly 4 digits" });
      return;
    }

    const pin_hash = await hashPin(String(pin));
    const accountId = `acc_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    const destinations = destination
      ? [
          {
            id: `dest_${Date.now()}`,
            type: destination.type || "mpesa",
            details: destination.details || phone_number,
            account_name:
              destination.account_name && destination.account_name !== UNRESOLVED_ACCOUNT_NAME
                ? destination.account_name
                : full_name,
            is_verified: true,
          },
        ]
      : [];

    const newAccount: Account = {
      id: accountId,
      full_name,
      phone_number,
      id_number,
      payout_destinations: destinations,
      coop_id: coop_id || null,
      channel_capability: ussd ? "webapp+ussd" : "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 0,
      demo_balance_kes_cents: 0,
      demo_incoming_kes_cents: 0,
      is_demo: false,
      demo_data_enabled: null,
      pin_hash,
      pin_failed_attempts: 0,
      pin_locked_until: null,
    };

    await store.saveAccount(newAccount);
    const session = await issueSession(newAccount);
    res.setHeader("Set-Cookie", sessionCookie(session.token));
    res.status(201).json({
      ...toPublicAccount(newAccount),
      token: session.token,
      role: session.role,
      roles: session.roles,
      account_types: session.account_types,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

apiRouter.get("/accounts/:id", async (req: Request, res: Response) => {
  const account = await store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.status(200).json(toPublicAccount(account));
});

apiRouter.get("/accounts/:id/balance", async (req: Request, res: Response) => {
  const account = await store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const visible = demoDataVisible(req.account ?? account);
  res.status(200).json({
    balance_kes_cents: account.balance_kes_cents,
    incoming_kes_cents: account.incoming_kes_cents,
    ...(visible
      ? {
          demo_balance_kes_cents: account.demo_balance_kes_cents ?? 0,
          demo_incoming_kes_cents: account.demo_incoming_kes_cents ?? 0,
        }
      : {}),
  });
});

apiRouter.get("/accounts/:id/settings", async (req: Request, res: Response) => {
  const account = await store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  res.status(200).json(demoSettings(account));
});

apiRouter.patch("/accounts/:id/settings", async (req: Request, res: Response) => {
  const account = await store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(req.body ?? {}, "demo_data_enabled")) {
    res.status(400).json({ error: "Missing demo_data_enabled" });
    return;
  }
  const next = parseDemoDataEnabled(req.body.demo_data_enabled);
  if (next === undefined) {
    res.status(400).json({ error: "demo_data_enabled must be true, false, or null" });
    return;
  }
  account.demo_data_enabled = next;
  await store.saveAccount(account);
  res.status(200).json(demoSettings(account));
});

apiRouter.get("/accounts/:id/transactions", async (req: Request, res: Response) => {
  const account = await store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
  const visible = seesDemo(req);
  const payouts = (await store.getPayoutsByAccount(account.id)).filter((payout) => includeInView(payout, visible));
  res.status(200).json(limit && limit > 0 ? payouts.slice(0, limit) : payouts);
});

apiRouter.post("/accounts/:id/destinations", async (req: Request, res: Response) => {
  const account = await store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const { type, details, account_name, bank_code } = req.body ?? {};
  if ((type !== "mpesa" && type !== "momo" && type !== "bank") || !details || !account_name) {
    res.status(400).json({ error: "Missing type, details or account_name" });
    return;
  }
  const clean = String(details).replace(/\s/g, "");
  const mobile = type === "mpesa" || type === "momo";
  const valid = mobile ? /^\+?\d{9,13}$/.test(clean) : /^\d{6,20}$/.test(clean);
  if (!valid) {
    res.status(400).json({ error: mobile ? "Invalid mobile money number" : "Invalid bank account number" });
    return;
  }
  const normalized = mobile ? store.normalizePhone(clean) : clean;
  if (account.payout_destinations.some((d) => d.type === type && d.details === normalized)) {
    res.status(409).json({ error: "Destination already added" });
    return;
  }
  const destination = {
    id: `dest_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`,
    type,
    details: normalized,
    account_name: String(account_name).slice(0, 255),
    // Payaza name enquiry is documented for NGN and GHS only, not KES/M-Pesa.
    is_verified: true,
    ...(bank_code ? { bank_code: String(bank_code) } : {}),
  } as const;
  account.payout_destinations.push({ ...destination });
  await store.saveAccount(account);
  res.status(201).json(destination);
});

apiRouter.delete("/accounts/:id/destinations/:destId", async (req: Request, res: Response) => {
  const account = await store.getAccount(getParam(req.params.id));
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const destId = getParam(req.params.destId);
  if (!account.payout_destinations.some((d) => d.id === destId)) {
    res.status(404).json({ error: "Destination not found" });
    return;
  }
  if (account.payout_destinations.length <= 1) {
    res.status(400).json({ error: "Keep at least one payout destination" });
    return;
  }
  account.payout_destinations = account.payout_destinations.filter((d) => d.id !== destId);
  await store.saveAccount(account);
  res.status(204).end();
});

apiRouter.post("/accounts/:id/withdraw", async (req: Request, res: Response) => {
  try {
    const { destination_id, amount_kes_cents, pin, idempotency_key } = req.body;
    if (!destination_id || amount_kes_cents === undefined || !pin) {
      res.status(400).json({ error: "Missing required fields (destination_id, amount_kes_cents, pin)" });
      return;
    }

    const result = await pipeline.withdraw(
      getParam(req.params.id),
      destination_id,
      parseInt(amount_kes_cents, 10),
      String(pin),
      idempotency_key
    );

    if (!result.success) {
      if (result.error === "wrong" || result.error === "locked") {
        res.status(403).json({
          error: result.error,
          attemptsLeft: result.attemptsLeft,
          lockedUntil: result.lockedUntil,
        });
        return;
      }
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(200).json(result.payout);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------
// Co-ops
// -------------------------------------------------------------
apiRouter.post("/coops", async (req: Request, res: Response) => {
  const { name, treasurer_account_id } = req.body;
  if (!name || !treasurer_account_id) {
    res.status(400).json({ error: "Missing name or treasurer_account_id" });
    return;
  }

  const treasurer = await store.getAccount(treasurer_account_id);
  if (!treasurer) {
    res.status(400).json({ error: "Treasurer account does not exist" });
    return;
  }

  const coopId = `coop_${Date.now()}`;
  const coop = await store.saveCoop({
    id: coopId,
    name,
    treasurer_account_id,
  });

  treasurer.coop_id = coopId;
  await store.saveAccount(treasurer);

  res.status(201).json(coop);
});

apiRouter.get("/coops/:id", async (req: Request, res: Response) => {
  const coop = await store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }
  res.status(200).json(coop);
});

apiRouter.get("/coops/:id/members", async (req: Request, res: Response) => {
  const coop = await store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }
  const members = await store.getCoopMembers(getParam(req.params.id));
  if (seesDemo(req)) {
    res.status(200).json(members);
    return;
  }
  const visible = [];
  for (const member of members) {
    const account = await store.getAccount(member.account_id);
    if (account?.is_demo) continue;
    visible.push(member);
  }
  res.status(200).json(visible);
});

apiRouter.post("/coops/:id/members", async (req: Request, res: Response) => {
  const coop = await store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }

  const { account_id, contribution_share, kilos } = req.body;
  if (!account_id || contribution_share === undefined) {
    res.status(400).json({ error: "Missing account_id or contribution_share" });
    return;
  }

  const account = await store.getAccount(account_id);
  if (!account) {
    res.status(400).json({ error: "Account does not exist" });
    return;
  }

  account.coop_id = coop.id;
  await store.saveAccount(account);

  const member: CoopMember = {
    coop_id: coop.id,
    account_id,
    full_name: account.full_name,
    contribution_share: Number(contribution_share),
    kilos: kilos !== undefined ? Number(kilos) : undefined,
  };

  await store.addCoopMember(member);
  res.status(201).json(member);
});

apiRouter.patch("/coops/:id/members/:accountId", async (req: Request, res: Response) => {
  const coopId = getParam(req.params.id);
  const accountId = getParam(req.params.accountId);
  const members = await store.getCoopMembers(coopId);
  const existing = members.find((m) => m.account_id === accountId);
  if (!existing) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  const share = Number(req.body?.contribution_share);
  if (!Number.isFinite(share) || share < 0 || share > 100) {
    res.status(400).json({ error: "contribution_share must be between 0 and 100" });
    return;
  }
  const updated: CoopMember = { ...existing, contribution_share: share };
  await store.addCoopMember(updated);
  res.status(200).json(updated);
});

apiRouter.delete("/coops/:id/members/:accountId", async (req: Request, res: Response) => {
  const coop = await store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }
  const removed = await store.removeCoopMember(coop.id, getParam(req.params.accountId));
  if (!removed) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  res.status(204).send();
});

apiRouter.delete("/coops/:id/members/:accountId", async (req: Request, res: Response) => {
  const coop = await store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }
  const removed = await store.removeCoopMember(coop.id, getParam(req.params.accountId));
  if (!removed) {
    res.status(404).json({ error: "Member not found" });
    return;
  }
  res.status(204).send();
});

apiRouter.get("/coops/:id/shipments", async (req: Request, res: Response) => {
  const coop = await store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }
  const visible = seesDemo(req);
  const shipments = (await store.listShipments(coop.id)).filter((shipment) => includeInView(shipment, visible));
  res.status(200).json(shipments);
});

// A Direct exporter's own shipments. Older direct invoices get a shipment on first read.
apiRouter.get("/accounts/:id/shipments", async (req: Request, res: Response) => {
  const accountId = getParam(req.params.id);
  const account = await store.getAccount(accountId);
  if (!account) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const invoices = await store.getInvoices({ account_id: accountId });
  for (const invoice of invoices) {
    if (invoice.type !== "direct") continue;
    if (await store.getShipmentByInvoice(invoice.id)) continue;
    await openShipmentForInvoice(invoice);
  }
  const visible = seesDemo(req);
  const shipments = (await store.listAccountShipments(accountId)).filter((shipment) => includeInView(shipment, visible));
  res.status(200).json(shipments);
});

// Finds which CSV phones already have a Stawi account. Response carries names only, no ID numbers or balances.
apiRouter.post("/coops/:id/members/lookup", async (req: Request, res: Response) => {
  const coopId = getParam(req.params.id);
  const phones = req.body?.phones;
  if (!Array.isArray(phones) || phones.length === 0 || phones.length > 1000) {
    res.status(400).json({ error: "phones must be a list of 1 to 1000 numbers" });
    return;
  }
  const members = await store.getCoopMembers(coopId);
  const memberIds = new Set(members.map((m) => m.account_id));
  const results = [];
  for (const raw of phones) {
    const phone = typeof raw === "string" ? store.normalizePhone(raw.slice(0, 32)) : "";
    const account = phone ? await store.getAccountByPhone(phone) : undefined;
    results.push({
      phone_number: phone,
      account_id: account?.id ?? null,
      full_name: account?.full_name ?? null,
      already_member: account ? memberIds.has(account.id) : false,
      other_coop: Boolean(account?.coop_id && account.coop_id !== coopId),
    });
  }
  res.status(200).json(results);
});

// Texts invite links to farmers. Links must point at this app's onboarding page.
apiRouter.post("/coops/:id/invites/sms", async (req: Request, res: Response) => {
  const coop = await store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }
  const recipients = req.body?.recipients;
  if (!Array.isArray(recipients) || recipients.length === 0 || recipients.length > 500) {
    res.status(400).json({ error: "recipients must be a list of 1 to 500 farmers" });
    return;
  }
  const { notify } = await import("../services/notify");
  const { isKenyanPhone } = await import("../services/phone");
  const results = [];
  for (const r of recipients) {
    const phone = typeof r?.phone_number === "string" ? store.normalizePhone(r.phone_number) : "";
    const name = typeof r?.full_name === "string" ? r.full_name.trim().slice(0, 60) : "";
    const link = typeof r?.link === "string" ? r.link.trim() : "";
    if (!isKenyanPhone(phone)) {
      results.push({ phone_number: phone, sent: false, error: "Not a Kenyan phone number" });
      continue;
    }
    if (!/^https:\/\/[^\s]+\/onboarding\?/.test(link) || link.length > 600) {
      results.push({ phone_number: phone, sent: false, error: "Invite link is not valid" });
      continue;
    }
    const greeting = name ? `Hi ${name.split(" ")[0]}, ` : "";
    const message = `${greeting}${coop.name} invites you to Stawi to get paid for your deliveries on M-Pesa. Join here: ${link}`;
    try {
      const sent = await notify.sendSms(phone, message);
      results.push({ phone_number: phone, sent: sent.success, error: sent.success ? undefined : sent.error || "Text failed" });
    } catch (err) {
      results.push({ phone_number: phone, sent: false, error: err instanceof Error ? err.message : "Text failed" });
    }
  }
  res.status(200).json({ sent: results.filter((r) => r.sent).length, failed: results.filter((r) => !r.sent).length, results });
});

apiRouter.patch("/shipments/:id", async (req: Request, res: Response) => {
  if (req.body?.action !== "advance") {
    res.status(400).json({ error: "action must be advance" });
    return;
  }
  const result = await advanceShipment(getParam(req.params.id));
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.status(200).json(result.shipment);
});

apiRouter.post("/shipments/:id/farmers", async (req: Request, res: Response) => {
  const accountId = req.body?.account_id;
  const kilos = Number(req.body?.kilos);
  if (!accountId || !Number.isInteger(kilos) || kilos <= 0) {
    res.status(400).json({ error: "account_id and a whole number of kilos are required" });
    return;
  }
  const result = await addShipmentFarmer(getParam(req.params.id), String(accountId), kilos);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  await refreshIncomingIfSettling(result.shipment);
  res.status(result.created ? 201 : 200).json(result.shipment);
});

apiRouter.delete("/shipments/:id/farmers/:accountId", async (req: Request, res: Response) => {
  const result = await removeShipmentFarmer(getParam(req.params.id), getParam(req.params.accountId));
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  await refreshIncomingIfSettling(result.shipment);
  res.status(200).json(result.shipment);
});

async function refreshIncomingIfSettling(shipment: { coop_id: string; invoice_id: string | null }): Promise<void> {
  if (!shipment.invoice_id) return;
  const invoice = await store.getInvoice(shipment.invoice_id);
  if (invoice?.status === "settling") await pipeline.refreshCoopIncoming(shipment.coop_id);
}

apiRouter.delete("/shipments/:id", async (req: Request, res: Response) => {
  const shipment = await store.getShipment(getParam(req.params.id));
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  if (shipment.invoice_id) {
    const invoice = await store.getInvoice(shipment.invoice_id);
    if (invoice && invoice.status !== "pending") {
      res.status(409).json({ error: "Shipments with a paid invoice can't be deleted" });
      return;
    }
  }
  await store.deleteShipment(shipment.id);
  res.status(204).send();
});

apiRouter.delete("/shipments/:id", async (req: Request, res: Response) => {
  const shipment = await store.getShipment(getParam(req.params.id));
  if (!shipment) {
    res.status(404).json({ error: "Shipment not found" });
    return;
  }
  if (shipment.invoice_id) {
    const invoice = await store.getInvoice(shipment.invoice_id);
    if (invoice && invoice.status !== "pending") {
      res.status(409).json({ error: "Shipments with a paid invoice can't be deleted" });
      return;
    }
  }
  await store.deleteShipment(shipment.id);
  res.status(204).send();
});

apiRouter.get("/coops/:id/payouts", async (req: Request, res: Response) => {
  const coop = await store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }
  const visible = seesDemo(req);
  const invoices = (await store.getInvoices({ coop_id: coop.id })).filter((invoice) => includeInView(invoice, visible));
  const invoiceIds = new Set(invoices.map((i) => i.id));
  const members = await store.getCoopMembers(coop.id);
  const groups = await Promise.all(members.map((m) => store.getPayoutsByAccount(m.account_id)));
  const payouts = groups
    .flat()
    .filter((p) => invoiceIds.has(p.invoice_id) && includeInView(p, visible))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  res.status(200).json(payouts);
});

// Local name check. Payaza's name enquiry is documented for NGN and GHS only.
apiRouter.post("/name-enquiry", async (req: Request, res: Response) => {
  const { type, details } = req.body ?? {};
  if ((type !== "mpesa" && type !== "momo" && type !== "bank") || !details) {
    res.status(400).json({ error: "Missing type or details" });
    return;
  }
  const accounts = await store.getAllAccounts();
  const match =
    type === "mpesa" || type === "momo"
      ? await store.getAccountByPhone(String(details))
      : accounts.find((a) => a.payout_destinations.some((d) => d.details === details));
  if (!match) {
    // Signup runs before a session exists, and Payaza has no KES name enquiry.
    // A signed-in caller still gets 404 so a saved destination is never the placeholder.
    const digits = String(details).replace(/\D/g, "");
    if (!req.account && digits.length >= 6) {
      res.status(200).json({ account_name: UNRESOLVED_ACCOUNT_NAME });
      return;
    }
    res.status(404).json({ error: "Account name not found" });
    return;
  }
  res.status(200).json({ account_name: match.full_name });
});

apiRouter.get("/coops/:id/metrics", async (req: Request, res: Response) => {
  const coop = await store.getCoop(getParam(req.params.id));
  if (!coop) {
    res.status(404).json({ error: "Co-op not found" });
    return;
  }

  const invoices = await store.getInvoices({ coop_id: coop.id });
  res.status(200).json(presentMetrics(invoices, seesDemo(req)));
});

// -------------------------------------------------------------
// Invoices
// -------------------------------------------------------------
apiRouter.get("/invoices", async (req: Request, res: Response) => {
  const coop_id = req.query.coop_id as string | undefined;
  const account_id = req.query.account_id as string | undefined;
  const visible = seesDemo(req);
  const invoices = (await store.getInvoices({ coop_id, account_id })).filter((invoice) => includeInView(invoice, visible));
  res.status(200).json(invoices);
});

apiRouter.post("/invoices", async (req: Request, res: Response) => {
  const {
    type,
    account_id,
    coop_id,
    buyer_name,
    buyer_email,
    buyer_phone,
    amount,
    currency,
    description,
    reference,
    due_at,
  } = req.body;

  if (!type || !buyer_name || !buyer_email || amount === undefined || !currency) {
    res.status(400).json({ error: "Missing required invoice fields" });
    return;
  }

  if (type === "direct" && !account_id) {
    res.status(400).json({ error: "Direct invoices require account_id" });
    return;
  }

  if (type === "coop" && !coop_id) {
    res.status(400).json({ error: "Co-op invoices require coop_id" });
    return;
  }

  const invoiceId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const invRef = reference || `INV-${type.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;

  const invoice: Invoice = {
    id: invoiceId,
    type,
    account_id: type === "direct" ? account_id : null,
    coop_id: type === "coop" ? coop_id : null,
    buyer_name,
    buyer_email,
    buyer_phone,
    amount: Number(amount),
    currency: currency.toUpperCase(),
    description: description || `Stawi Invoice ${invRef}`,
    reference: invRef,
    status: "pending",
    split_approved: false,
    fx_rate: null,
    fee_kes_cents: null,
    kes_total_cents: null,
    payaza_checkout_reference: null,
    is_demo: false,
    created_at: new Date().toISOString(),
    due_at: due_at || null,
  };

  await store.saveInvoice(invoice);
  if ((invoice.type === "coop" && invoice.coop_id) || (invoice.type === "direct" && invoice.account_id)) {
    await openShipmentForInvoice(invoice);
  }
  res.status(201).json(invoice);
});

apiRouter.get("/invoices/:id", async (req: Request, res: Response) => {
  const invoice = await store.getInvoice(getParam(req.params.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (req.account && !seesDemo(req) && isDemo(invoice)) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }

  const transactions = await store.getTransactions(invoice.id);
  const split_preview = invoice.type === "coop" ? await pipeline.getSplitPreview(invoice.id) : null;
  const payee = await publicPayee(invoice);

  res.status(200).json({
    invoice,
    transactions,
    split_preview,
    payee_name: payee.payee_name,
    farmer_count: payee.farmer_count,
  });
});

apiRouter.delete("/invoices/:id", async (req: Request, res: Response) => {
  const invoice = await store.getInvoice(getParam(req.params.id));
  if (!invoice) {
    res.status(404).json({ error: "Invoice not found" });
    return;
  }
  if (invoice.status !== "pending") {
    res.status(409).json({ error: "Only unpaid invoices can be deleted" });
    return;
  }
  await store.deleteInvoice(invoice.id);
  res.status(204).send();
});

apiRouter.post("/invoices/:id/checkout-session", async (req: Request, res: Response) => {
  try {
    const invoice = await store.getInvoice(getParam(req.params.id));
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }
    if (isDemo(invoice) && payaza.getMode() !== "mock") {
      res.status(409).json({
        error: "Sample invoices are not sent to Payaza. Create a new invoice for a live payment.",
      });
      return;
    }

    const session = await payaza.createCheckoutSession(invoice);
    invoice.payaza_checkout_reference = session.transaction_reference;
    if (session.link_id) invoice.payaza_link_id = session.link_id;
    await store.saveInvoice(invoice);

    res.status(200).json(session);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

apiRouter.post("/invoices/:id/approve-split", async (req: Request, res: Response) => {
  try {
    const { treasurer_id, pin } = req.body;
    if (!treasurer_id || !pin) {
      res.status(400).json({ error: "Missing treasurer_id or pin" });
      return;
    }

    const result = await pipeline.approveCoopSplit(getParam(req.params.id), treasurer_id, String(pin));

    if (!result.success) {
      if (result.error === "wrong" || result.error === "locked") {
        res.status(403).json({
          error: result.error,
          attemptsLeft: result.attemptsLeft,
          lockedUntil: result.lockedUntil,
        });
        return;
      }
      res.status(400).json({ error: result.error });
      return;
    }

    res.status(200).json({
      success: true,
      invoice: result.invoice,
      payouts: result.payouts,
      transfers: result.transfers ?? [],
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------
// Payaza Webhooks
// -------------------------------------------------------------
apiRouter.post("/webhooks/payaza", async (req: Request, res: Response) => {
  try {
    const sigHeader = (req.headers["x-payaza-signature"] || "") as string;
    const rawBody = (req as any).rawBody || JSON.stringify(req.body);

    const isValid = payaza.verifyWebhookSignature(rawBody, sigHeader);
    if (!isValid) {
      res.status(401).json({ error: "Invalid webhook signature" });
      return;
    }

    const payload = (req.body || {}) as Record<string, unknown>;
    const decision = classifyPayazaWebhook(payload);

    if (!decision.reference && !decision.merchantReference && !decision.invoiceId) {
      res.status(400).json({ error: "Missing transaction reference" });
      return;
    }

    const dedupeKey = decision.reference || decision.merchantReference || decision.invoiceId || "";
    if (await store.isWebhookProcessed(dedupeKey)) {
      res.status(200).json({ received: true, duplicate: true });
      return;
    }

    if (decision.kind === "ignored") {
      await store.markWebhookProcessed(dedupeKey);
      res.status(200).json({ received: true, ignored: true });
      return;
    }

    const result = await pipeline.applyPayazaWebhook(decision);
    await store.markWebhookProcessed(dedupeKey);
    res.status(200).json({ received: true, matched: result.matched });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// -------------------------------------------------------------
// Africa's Talking USSD Gateway Callback
// -------------------------------------------------------------
apiRouter.post("/ussd/callback", handleUssdCallback);

// -------------------------------------------------------------
// Dev Routes (Active in mock mode)
// -------------------------------------------------------------
apiRouter.post("/dev/simulate-payment/:invoiceId", async (req: Request, res: Response) => {
  if (payaza.getMode() !== "mock") {
    res.status(403).json({ error: "Simulation only available when PAYAZA_MODE=mock" });
    return;
  }

  try {
    const invoice = await store.getInvoice(getParam(req.params.invoiceId));
    if (!invoice) {
      res.status(404).json({ error: "Invoice not found" });
      return;
    }

    const result = await pipeline.processPayment(invoice.id);
    res.status(200).json({
      success: true,
      invoice: result.invoice,
      transactions: result.transactions,
      payouts: result.payouts,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

apiRouter.get("/dev/seed-ids", async (req: Request, res: Response) => {
  if (payaza.getMode() !== "mock") {
    res.status(403).json({ error: "Seed IDs only available when PAYAZA_MODE=mock" });
    return;
  }
  res.status(200).json(SEED_IDS);
});
