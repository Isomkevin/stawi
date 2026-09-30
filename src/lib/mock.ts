import {
  ApiError,
  type Account,
  type Balance,
  type CheckoutSession,
  type Coop,
  type CoopMember,
  type CoopMetrics,
  type CoopMetricsBucket,
  type CreateAccountBody,
  type DemoDataSettings,
  type CreateInvoiceBody,
  type UpdateInvoiceBody,
  type Invoice,
  type InvoiceDetail,
  type PaymentReceipt,
  type Payout,
  type PayoutDestination,
  type SplitLine,
  type Transaction,
  type WithdrawBody,
} from "./types";
import { checkoutAmount, defaultPayCurrency } from "./payCurrencies";

export const FX_USD_KES = 129;
export const FX_EUR_KES = 139;
export const FEE_RATE = 0.008; // 0.8%

export const DEMO_PIN = "1234";

const DEMO_DATA_EFFECT =
  "Shows sample records, labelled Demo, alongside live transactions. It does not switch Payaza mode, block live payments, or mark new invoices as sample. Turning it off hides sample records and keeps them stored. Live balance is what sandbox and live payouts can send. Sample balance stays separate, and it can be withdrawn only while Payaza is in mock mode.";

const DEMO_OVERRIDE_KEY = "stawi.mock.demo_data_enabled";

function readDemoOverride(): boolean | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(DEMO_OVERRIDE_KEY);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/** Mock-mode visibility. Live mode asks the API instead. Default on, matching a non-production server. */
export function mockDemoVisible(): boolean {
  const saved = readDemoOverride();
  return saved == null ? true : saved;
}

function includeDemo<T extends { is_demo?: boolean }>(row: T): boolean {
  return mockDemoVisible() || row.is_demo !== true;
}

function metricsBucket(rows: Invoice[]): CoopMetricsBucket {
  const collected = rows.filter((i) => i.status === "completed" || i.status === "settling" || i.kes_total_cents);
  return {
    invoices: rows.length,
    total_collected_kes_cents: collected.reduce((sum, i) => sum + (i.kes_total_cents ?? 0) + (i.fee_kes_cents ?? 0), 0),
    fee_taken_kes_cents: collected.reduce((sum, i) => sum + (i.fee_kes_cents ?? 0), 0),
    total_split_kes_cents: rows.filter((i) => i.split_approved).reduce((sum, i) => sum + (i.kes_total_cents ?? 0), 0),
  };
}

const now = Date.now();
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
const daysAgo = (d: number) => new Date(now - d * 86_400_000).toISOString();
const daysAhead = (d: number) => new Date(now + d * 86_400_000).toISOString();

export function fxFor(currency: string): number {
  return currency === "EUR" ? FX_EUR_KES : FX_USD_KES;
}

function id(prefix: string, n: number | string) {
  return `${prefix}_${n}`;
}

const dest = (
  n: string,
  type: "mpesa" | "momo" | "bank",
  details: string,
  account_name: string,
  is_verified = true,
): PayoutDestination => ({ id: id("dst", n), type, details, account_name, is_verified });

// ---------------------------------------------------------------- accounts

const farmerSeed: Array<{ name: string; phone: string; share: number; kilos: number; verified: boolean }> = [
  { name: "Wanjiku Mwangi", phone: "+254712004501", share: 14, kilos: 420, verified: true },
  { name: "Joseph Kamau", phone: "+254712004502", share: 12, kilos: 360, verified: true },
  { name: "Grace Njeri", phone: "+254712004503", share: 11, kilos: 330, verified: true },
  { name: "Peter Kariuki", phone: "+254712004504", share: 10, kilos: 300, verified: true },
  { name: "Esther Wambui", phone: "+254712004505", share: 10, kilos: 300, verified: true },
  { name: "Samuel Otieno", phone: "+254712004506", share: 9, kilos: 270, verified: true },
  { name: "Mary Achieng", phone: "+254712004507", share: 9, kilos: 270, verified: true },
  { name: "David Mutiso", phone: "+254712004508", share: 9, kilos: 270, verified: false },
  { name: "Lucy Nyokabi", phone: "+254712004509", share: 8, kilos: 240, verified: true },
  { name: "Boniface Kiptoo", phone: "+254712004510", share: 8, kilos: 240, verified: true },
];

export const COOP_ID = "coop_kiambu";

const accounts: Account[] = [
  {
    id: "acc_treasurer",
    full_name: "Njeri Kamande",
    phone_number: "+254712000001",
    id_number: "24118899",
    payout_destinations: [dest("t1", "bank", "01100123456700", "Kiambu Highlands Coffee Co-op")],
    coop_id: COOP_ID,
    channel_capability: "webapp",
    balance_kes_cents: 0,
    incoming_kes_cents: 0,
  },
  {
    id: "acc_exporter",
    full_name: "Wanjiru Njoroge",
    phone_number: "+254712000002",
    id_number: "30441220",
    payout_destinations: [
      dest("e1", "mpesa", "+254712000002", "Wanjiru Njoroge"),
      dest("e2", "bank", "01100998877000", "Wanjiru Crafts Ltd"),
    ],
    coop_id: null,
    channel_capability: "webapp+ussd",
    balance_kes_cents: 42_780_00,
    incoming_kes_cents: 18_900_00,
  },
  ...farmerSeed.map((f, i) => ({
    id: id("acc_farmer", i + 1),
    full_name: f.name,
    phone_number: f.phone,
    id_number: `2${400000 + i * 137}`,
    payout_destinations: f.verified
      ? [dest(`f${i + 1}`, "mpesa", f.phone, f.name)]
      : [dest(`f${i + 1}`, "mpesa", f.phone, f.name, false)],
    coop_id: COOP_ID,
    channel_capability: (i % 3 === 0 ? "webapp+ussd" : "webapp") as Account["channel_capability"],
    balance_kes_cents: i === 0 ? 1_845_000 : 120_000 + i * 43_500,
    incoming_kes_cents: i === 0 ? 742_300 : 80_000 + i * 12_000,
  })),
];

export const FARMER_ID = "acc_farmer_1";
export const EXPORTER_ID = "acc_exporter";
export const TREASURER_ID = "acc_treasurer";

const coops: Coop[] = [
  { id: COOP_ID, name: "Kiambu Highlands Coffee Co-op", treasurer_account_id: TREASURER_ID },
];

const members: CoopMember[] = farmerSeed.map((f, i) => ({
  coop_id: COOP_ID,
  account_id: id("acc_farmer", i + 1),
  full_name: f.name,
  contribution_share: f.share,
  kilos: f.kilos,
}));

// ---------------------------------------------------------------- invoices

function payeeFor(invoice: Invoice): { payee_name: string; farmer_count: number | null } {
  if (invoice.coop_id) {
    const coop = coops.find((c) => c.id === invoice.coop_id);
    const farmer_count = members.filter((m) => m.coop_id === invoice.coop_id).length;
    return { payee_name: coop?.name ?? "Stawi seller", farmer_count };
  }
  if (invoice.account_id) {
    const account = accounts.find((a) => a.id === invoice.account_id);
    return { payee_name: account?.full_name ?? "Stawi seller", farmer_count: null };
  }
  return { payee_name: "Stawi seller", farmer_count: null };
}

function kesFromAmount(amount: number, currency: string) {
  const rate = fxFor(currency);
  const gross = Math.round(amount * rate * 100);
  const fee = Math.round(gross * FEE_RATE);
  return { gross, fee, net: gross - fee, rate };
}

function coopInvoice(
  n: string,
  partial: Partial<Invoice> & Pick<Invoice, "buyer_name" | "buyer_email" | "amount" | "currency" | "description" | "status">,
): Invoice {
  const settled = ["paid", "converting", "settling", "completed"].includes(partial.status);
  const { fee, net, rate } = kesFromAmount(partial.amount, partial.currency);
  return {
    id: id("inv", n),
    type: "coop",
    account_id: null,
    coop_id: COOP_ID,
    buyer_phone: undefined,
    reference: `KH-${n.toUpperCase()}`,
    split_approved: false,
    fx_rate: settled ? rate : null,
    fee_kes_cents: settled ? fee : null,
    kes_total_cents: settled ? net : null,
    payaza_checkout_reference: settled ? `PZ-${n.toUpperCase()}` : null,
    created_at: daysAgo(6),
    due_at: daysAhead(10),
    ...partial,
    is_demo: partial.is_demo ?? true,
  } as Invoice;
}

const invoices: Invoice[] = [
  coopInvoice("2411", {
    buyer_name: "Hansen Kaffee GmbH",
    buyer_email: "procurement@hansenkaffee.de",
    amount: 12_400,
    currency: "USD",
    description: "3,000 kg washed AA green coffee · Hamburg",
    status: "completed",
    split_approved: true,
    created_at: daysAgo(9),
    due_at: daysAgo(4),
  }),
  coopInvoice("2412", {
    buyer_name: "Nordic Roasters AB",
    buyer_email: "ap@nordicroasters.se",
    amount: 8_600,
    currency: "EUR",
    description: "2,100 kg AB grade · Malmö shipment",
    status: "paid",
    split_approved: false,
    created_at: daysAgo(2),
    due_at: daysAhead(5),
  }),
  coopInvoice("2413", {
    buyer_name: "Bristol Coffee Works",
    buyer_email: "finance@bristolcoffee.co.uk",
    amount: 5_250,
    currency: "USD",
    description: "1,200 kg peaberry · February lot",
    status: "pending",
    created_at: daysAgo(1),
    due_at: daysAhead(14),
  }),
  coopInvoice("2410", {
    buyer_name: "Amsterdam Bean Traders",
    buyer_email: "pay@abtraders.nl",
    amount: 4_100,
    currency: "EUR",
    description: "900 kg natural lot · January",
    status: "settling",
    split_approved: true,
    created_at: daysAgo(14),
    due_at: daysAgo(7),
  }),
  {
    id: "inv_9001",
    type: "direct",
    is_demo: true,
    account_id: EXPORTER_ID,
    coop_id: null,
    buyer_name: "Maison Tissu",
    buyer_email: "orders@maisontissu.fr",
    amount: 3_400,
    currency: "EUR",
    description: "Hand-woven sisal baskets · 120 units",
    reference: "WC-0041",
    status: "completed",
    split_approved: true,
    fx_rate: FX_EUR_KES,
    fee_kes_cents: kesFromAmount(3_400, "EUR").fee,
    kes_total_cents: kesFromAmount(3_400, "EUR").net,
    payaza_checkout_reference: "PZ-WC0041",
    created_at: daysAgo(11),
    due_at: daysAgo(5),
  },
  {
    id: "inv_9002",
    type: "direct",
    is_demo: true,
    account_id: EXPORTER_ID,
    coop_id: null,
    buyer_name: "Halcyon Home Goods",
    buyer_email: "ap@halcyonhome.com",
    amount: 2_150,
    currency: "USD",
    description: "Beaded table runners · 80 units",
    reference: "WC-0042",
    status: "pending",
    split_approved: false,
    fx_rate: null,
    fee_kes_cents: null,
    kes_total_cents: null,
    payaza_checkout_reference: null,
    created_at: hoursAgo(20),
    due_at: daysAhead(12),
  },
];

// ------------------------------------------------------------ transactions

function txnsFor(invoice: Invoice): Transaction[] {
  const out: Transaction[] = [];
  const base = new Date(invoice.created_at).getTime();
  const at = (mins: number) => new Date(base + mins * 60_000).toISOString();
  if (invoice.status === "pending") return out;
  out.push({
    id: `${invoice.id}_t1`,
    invoice_id: invoice.id,
    type: "collection",
    status: "completed",
    amount: invoice.amount,
    currency: invoice.currency,
    fx_rate: null,
    fee_kes_cents: null,
    created_at: at(60),
  });
  out.push({
    id: `${invoice.id}_t2`,
    invoice_id: invoice.id,
    type: "conversion",
    status: invoice.status === "paid" ? "pending" : "completed",
    amount: invoice.amount,
    currency: invoice.currency,
    fx_rate: invoice.fx_rate,
    fee_kes_cents: invoice.fee_kes_cents,
    created_at: at(75),
  });
  if (["settling", "completed"].includes(invoice.status)) {
    out.push({
      id: `${invoice.id}_t3`,
      invoice_id: invoice.id,
      type: "settlement",
      status: "completed",
      amount: (invoice.kes_total_cents ?? 0) / 100,
      currency: "KES",
      fx_rate: invoice.fx_rate,
      fee_kes_cents: invoice.fee_kes_cents,
      created_at: at(110),
    });
  }
  if (invoice.status === "completed") {
    out.push({
      id: `${invoice.id}_t4`,
      invoice_id: invoice.id,
      type: "payout",
      status: "completed",
      amount: (invoice.kes_total_cents ?? 0) / 100,
      currency: "KES",
      fx_rate: null,
      fee_kes_cents: null,
      created_at: at(140),
    });
  }
  return out.map((txn) => ({ ...txn, is_demo: invoice.is_demo === true }));
}

const transactions: Transaction[] = invoices.flatMap(txnsFor);

// ----------------------------------------------------------------- payouts

export function splitFor(invoice: Invoice): SplitLine[] | null {
  if (invoice.type !== "coop") return null;
  const rate = invoice.fx_rate ?? fxFor(invoice.currency);
  const gross = Math.round(invoice.amount * rate * 100);
  return members.map((m) => {
    const lineGross = Math.round((gross * m.contribution_share) / 100);
    const fee = Math.round(lineGross * FEE_RATE);
    return {
      account_id: m.account_id,
      share: m.contribution_share,
      gross_kes_cents: lineGross,
      fee_kes_cents: fee,
      net_kes_cents: lineGross - fee,
    };
  });
}

const payouts: Payout[] = [];

function seedPayouts() {
  const completed = invoices.find((i) => i.id === "inv_2411")!;
  splitFor(completed)?.forEach((line, i) => {
    payouts.push({
      id: `pay_2411_${i}`,
      invoice_id: completed.id,
      account_id: line.account_id,
      kind: "credit",
      amount_kes_cents: line.net_kes_cents,
      destination_id: null,
      status: "confirmed",
      created_at: daysAgo(8),
    });
  });
  const settling = invoices.find((i) => i.id === "inv_2410")!;
  splitFor(settling)?.forEach((line, i) => {
    const failing = line.account_id === "acc_farmer_8";
    payouts.push({
      id: `pay_2410_${i}`,
      invoice_id: settling.id,
      account_id: line.account_id,
      kind: "credit",
      amount_kes_cents: line.net_kes_cents,
      destination_id: null,
      status: failing ? "failed" : "confirmed",
      created_at: daysAgo(13),
    });
  });
  payouts.push({
    id: "pay_w_1",
    invoice_id: "inv_2411",
    account_id: FARMER_ID,
    kind: "withdrawal",
    amount_kes_cents: 500_000,
    destination_id: "dst_f1",
    status: "confirmed",
    created_at: daysAgo(5),
  });
  payouts.push({
    id: "pay_direct_1",
    invoice_id: "inv_9001",
    account_id: EXPORTER_ID,
    kind: "credit",
    amount_kes_cents: invoices.find((i) => i.id === "inv_9001")!.kes_total_cents!,
    destination_id: null,
    status: "confirmed",
    created_at: daysAgo(10),
  });
}
seedPayouts();
for (const payout of payouts) payout.is_demo = true;
for (const txn of transactions) txn.is_demo = true;

// --------------------------------------------------------------- mock API

const latency = (ms = 420) => new Promise((r) => setTimeout(r, ms));

let pinAttempts = 0;
let lockedUntil = 0;

export const mockDb = {
  accounts,
  coops,
  members,
  invoices,
  transactions,
  payouts,
};

export const mockApi = {
  async getAccount(accountId: string): Promise<Account> {
    await latency(250);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new ApiError(404, "Account not found");
    return structuredClone(account);
  },

  async listAccounts(): Promise<Account[]> {
    await latency(150);
    return structuredClone(accounts);
  },

  async createAccount(body: CreateAccountBody): Promise<Account> {
    await latency(600);
    const account: Account = {
      id: id("acc", accounts.length + 1),
      full_name: body.full_name,
      phone_number: body.phone_number,
      id_number: body.id_number,
      payout_destinations: [
        dest(`n${accounts.length}`, body.destination.type, body.destination.details, body.destination.account_name),
      ],
      coop_id: body.coop_id ?? null,
      channel_capability: body.ussd ? "webapp+ussd" : "webapp",
      balance_kes_cents: 0,
      incoming_kes_cents: 0,
    };
    accounts.push(account);
    return structuredClone(account);
  },

  async getBalance(accountId: string): Promise<Balance> {
    await latency(200);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new ApiError(404, "Account not found");
    const visible = mockDemoVisible();
    return {
      balance_kes_cents: account.balance_kes_cents,
      incoming_kes_cents: account.incoming_kes_cents,
      ...(visible
        ? {
            demo_balance_kes_cents: account.demo_balance_kes_cents ?? 0,
            demo_incoming_kes_cents: account.demo_incoming_kes_cents ?? 0,
          }
        : {}),
    };
  },

  async getDemoSettings(accountId: string): Promise<DemoDataSettings> {
    await latency(120);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new ApiError(404, "Account not found");
    const enabled = readDemoOverride();
    return {
      demo_data_enabled: enabled,
      demo_data_visible: mockDemoVisible(),
      demo_data_default: true,
      effect: DEMO_DATA_EFFECT,
    };
  },

  async updateDemoSettings(accountId: string, demo_data_enabled: boolean | null): Promise<DemoDataSettings> {
    await latency(180);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new ApiError(404, "Account not found");
    account.demo_data_enabled = demo_data_enabled;
    account.demo_data_visible = demo_data_enabled == null ? true : demo_data_enabled;
    if (typeof sessionStorage !== "undefined") {
      if (demo_data_enabled == null) sessionStorage.removeItem(DEMO_OVERRIDE_KEY);
      else sessionStorage.setItem(DEMO_OVERRIDE_KEY, String(demo_data_enabled));
    }
    return this.getDemoSettings(accountId);
  },

  async getAccountTransactions(accountId: string, limit = 50): Promise<Payout[]> {
    await latency(320);
    return structuredClone(
      payouts
        .filter((p) => p.account_id === accountId && includeDemo(p))
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))
        .slice(0, limit),
    );
  },

  async withdraw(accountId: string, body: WithdrawBody): Promise<Payout> {
    await latency(700);
    if (Date.now() < lockedUntil) throw new ApiError(403, "locked");
    if (body.pin !== DEMO_PIN) {
      pinAttempts += 1;
      if (pinAttempts >= 3) {
        lockedUntil = Date.now() + 15 * 60_000;
        pinAttempts = 0;
        throw new ApiError(403, "locked");
      }
      throw new ApiError(403, "wrong", 3 - pinAttempts);
    }
    pinAttempts = 0;
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new ApiError(404, "Account not found");
    if (body.amount_kes_cents > account.balance_kes_cents)
      throw new ApiError(400, "Insufficient balance");
    account.balance_kes_cents -= body.amount_kes_cents;
    const payout: Payout = {
      id: id("pay", payouts.length + 1),
      invoice_id: "",
      account_id: accountId,
      kind: "withdrawal",
      amount_kes_cents: body.amount_kes_cents,
      destination_id: body.destination_id,
      status: "sent",
      is_demo: false,
      created_at: new Date().toISOString(),
    };
    payouts.unshift(payout);
    return structuredClone(payout);
  },

  async getCoop(coopId: string): Promise<Coop> {
    await latency(150);
    const coop = coops.find((c) => c.id === coopId);
    if (!coop) throw new ApiError(404, "Co-op not found");
    return structuredClone(coop);
  },

  async getCoopMembers(coopId: string): Promise<CoopMember[]> {
    await latency(300);
    return structuredClone(members.filter((m) => m.coop_id === coopId));
  },

  async addCoopMember(coopId: string, member: Omit<CoopMember, "coop_id">): Promise<CoopMember> {
    await latency(400);
    const row: CoopMember = { coop_id: coopId, ...member };
    members.push(row);
    return structuredClone(row);
  },

  async lookupPhones(coopId: string, phones: string[]) {
    const norm = (p: string) => p.replace(/[^\d]/g, "").replace(/^0/, "254").replace(/^(?!254)/, "254");
    return phones.map((phone) => {
      const acc = mockDb.accounts.find((a) => norm(a.phone_number) === norm(phone));
      return {
        phone_number: phone,
        account_id: acc?.id ?? null,
        full_name: acc?.full_name ?? null,
        already_member: acc ? mockDb.members.some((m) => m.coop_id === coopId && m.account_id === acc.id) : false,
        other_coop: false,
      };
    });
  },

  async updateMemberShare(accountId: string, share: number): Promise<void> {
    await latency(200);
    const member = members.find((m) => m.account_id === accountId);
    if (member) member.contribution_share = share;
  },

  async removeCoopMember(coopId: string, accountId: string): Promise<void> {
    await latency(300);
    const i = members.findIndex((m) => m.coop_id === coopId && m.account_id === accountId);
    if (i >= 0) members.splice(i, 1);
  },

  async deleteInvoice(invoiceId: string): Promise<void> {
    await latency(300);
    const i = invoices.findIndex((x) => x.id === invoiceId);
    if (i < 0) return;
    if (invoices[i]!.status !== "pending") throw new ApiError(409, "Only unpaid invoices can be deleted");
    invoices.splice(i, 1);
  },

  async getCoopMetrics(coopId: string): Promise<CoopMetrics> {
    await latency(300);
    const rows = invoices.filter((i) => i.coop_id === coopId);
    const live = metricsBucket(rows.filter((i) => i.is_demo !== true));
    const demo = metricsBucket(rows.filter((i) => i.is_demo === true));
    const visible = mockDemoVisible();
    const shown = visible
      ? {
          invoices: live.invoices + demo.invoices,
          total_collected_kes_cents: live.total_collected_kes_cents + demo.total_collected_kes_cents,
          fee_taken_kes_cents: live.fee_taken_kes_cents + demo.fee_taken_kes_cents,
          total_split_kes_cents: live.total_split_kes_cents + demo.total_split_kes_cents,
        }
      : live;
    return { ...shown, live, ...(visible ? { demo } : {}) };
  },

  async listInvoices(params: { coop_id?: string; account_id?: string }): Promise<Invoice[]> {
    await latency(320);
    return structuredClone(
      invoices
        .filter((i) => includeDemo(i))
        .filter((i) =>
          params.coop_id
            ? i.coop_id === params.coop_id
            : params.account_id
              ? i.account_id === params.account_id
              : true,
        )
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    );
  },

  async getPaymentReceipt(invoiceId: string): Promise<PaymentReceipt> {
    const detail = await this.getInvoice(invoiceId);
    const collection = detail.transactions.find((tx) => tx.type === "collection" && tx.status === "completed");
    const invoice = detail.invoice;
    if (!collection || invoice.status === "pending" || invoice.status === "failed") {
      throw new ApiError(409, "A receipt is issued after the payment is received");
    }
    const fee = invoice.fee_kes_cents;
    const net = invoice.kes_total_cents;
    return {
      receipt_number: `RCP-${invoice.reference}`,
      invoice_id: invoice.id,
      invoice_reference: invoice.reference,
      paid_at: collection.created_at,
      payee_name: detail.payee_name || "Stawi seller",
      buyer_name: invoice.buyer_name,
      buyer_email: invoice.buyer_email,
      description: invoice.description,
      amount: collection.amount,
      currency: collection.currency,
      fx_rate: invoice.fx_rate,
      gross_kes_cents: fee != null && net != null ? fee + net : null,
      fee_kes_cents: fee,
      net_kes_cents: net,
      payaza_reference: collection.payaza_reference ?? invoice.payaza_checkout_reference,
      status: invoice.status,
    };
  },

  async getInvoice(invoiceId: string): Promise<InvoiceDetail> {
    await latency(350);
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new ApiError(404, "Invoice not found");
    return structuredClone({
      invoice,
      transactions: transactions.filter((t) => t.invoice_id === invoiceId),
      split_preview: splitFor(invoice),
      ...payeeFor(invoice),
    });
  },

  async createInvoice(body: CreateInvoiceBody): Promise<Invoice> {
    await latency(600);
    const invoice: Invoice = {
      id: id("inv", Math.floor(Math.random() * 9000) + 1000),
      type: body.type,
      account_id: body.account_id ?? null,
      coop_id: body.coop_id ?? null,
      buyer_name: body.buyer_name,
      buyer_email: body.buyer_email,
      buyer_phone: body.buyer_phone,
      amount: body.amount,
      currency: body.currency,
      description: body.description,
      reference: body.reference || `REF-${Math.floor(Math.random() * 9000) + 1000}`,
      status: "pending",
      split_approved: false,
      fx_rate: null,
      fee_kes_cents: null,
      kes_total_cents: null,
      payaza_checkout_reference: null,
      is_demo: false,
      created_at: new Date().toISOString(),
      due_at: body.due_at ?? daysAhead(14),
    };
    invoices.unshift(invoice);
    if (body.type === "coop" && body.shipment_id) {
      const { shipmentsApi } = await import("./shipments");
      try {
        await shipmentsApi.attachInvoice(body.shipment_id, invoice);
      } catch (err) {
        const index = invoices.indexOf(invoice);
        if (index >= 0) invoices.splice(index, 1);
        throw err;
      }
    }
    return structuredClone(invoice);
  },

  async updateInvoice(id: string, body: UpdateInvoiceBody): Promise<Invoice> {
    await latency(400);
    const invoice = invoices.find((row) => row.id === id);
    if (!invoice) throw new ApiError(404, "Invoice not found");
    if (invoice.status !== "pending") throw new ApiError(409, "Only unpaid invoices can be edited");
    if (body.buyer_name !== undefined) invoice.buyer_name = body.buyer_name;
    if (body.buyer_email !== undefined) invoice.buyer_email = body.buyer_email;
    if (body.amount !== undefined) invoice.amount = body.amount;
    if (body.currency !== undefined) invoice.currency = body.currency;
    if (body.description !== undefined) invoice.description = body.description;
    const { shipmentsApi } = await import("./shipments");
    if (invoice.type === "coop" && body.shipment_id) {
      const current = shipmentsApi.linkedTo(invoice.id);
      if (!current || current.id !== body.shipment_id) {
        if (current) current.invoice_id = null;
        try {
          await shipmentsApi.attachInvoice(body.shipment_id, invoice);
        } catch (err) {
          if (current) current.invoice_id = invoice.id;
          throw err;
        }
      }
    }
    shipmentsApi.applyInvoice(invoice);
    return structuredClone(invoice);
  },

  async createCheckoutSession(invoiceId: string, currencyCode?: string): Promise<CheckoutSession> {
    await latency(400);
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new ApiError(404, "Invoice not found");
    const currency_code = (currencyCode || defaultPayCurrency(invoice.currency)).toUpperCase();
    const reference = `PZ-${invoiceId.toUpperCase()}-${Math.floor(Math.random() * 999)}`;
    invoice.payaza_checkout_reference = reference;
    return {
      reference,
      checkoutUrl: null,
      public_key: "PZ_PUBLIC_KEY_SANDBOX",
      transaction_reference: reference,
      link_id: null,
      connection_mode: "Test",
      checkout_amount: checkoutAmount(invoice.amount, invoice.currency, currency_code),
      currency_code,
    };
  },

  async approveSplit(invoiceId: string, pin: string): Promise<Invoice> {
    await latency(800);
    if (pin !== DEMO_PIN) throw new ApiError(403, "wrong");
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new ApiError(404, "Invoice not found");
    invoice.split_approved = true;
    invoice.status = "settling";
    splitFor(invoice)?.forEach((line, i) => {
      payouts.unshift({
        id: `${invoice.id}_p${i}`,
        invoice_id: invoice.id,
        account_id: line.account_id,
        kind: "credit",
        amount_kes_cents: line.net_kes_cents,
        destination_id: null,
        status: "sent",
        is_demo: invoice.is_demo === true,
        created_at: new Date().toISOString(),
      });
      const account = accounts.find((a) => a.id === line.account_id);
      if (account) account.balance_kes_cents += line.net_kes_cents;
    });
    setTimeout(() => {
      invoice.status = "completed";
    }, 4000);
    return structuredClone(invoice);
  },

  async simulatePayment(invoiceId: string): Promise<Invoice> {
    await latency(900);
    const invoice = invoices.find((i) => i.id === invoiceId);
    if (!invoice) throw new ApiError(404, "Invoice not found");
    const { fee, net, rate } = kesFromAmount(invoice.amount, invoice.currency);
    invoice.status = invoice.type === "coop" ? "paid" : "completed";
    invoice.fx_rate = rate;
    invoice.fee_kes_cents = fee;
    invoice.kes_total_cents = net;
    invoice.payaza_checkout_reference ??= `PZ-${invoice.id.toUpperCase()}`;
    transactions.push(...txnsFor(invoice));
    if (invoice.type === "direct" && invoice.account_id) {
      const account = accounts.find((a) => a.id === invoice.account_id);
      if (account) account.balance_kes_cents += net;
    }
    return structuredClone(invoice);
  },

  async listCoopPayouts(coopId: string): Promise<Payout[]> {
    await latency(320);
    const coopInvoiceIds = invoices.filter((i) => i.coop_id === coopId).map((i) => i.id);
    return structuredClone(
      payouts
        .filter((p) => coopInvoiceIds.includes(p.invoice_id) && p.kind === "credit" && includeDemo(p))
        .sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    );
  },

  async addDestination(
    accountId: string,
    body: { type: "mpesa" | "momo" | "bank"; details: string; account_name: string },
  ): Promise<PayoutDestination> {
    await latency(500);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new ApiError(404, "Account not found");
    const clean = body.details.replace(/\s/g, "");
    if (account.payout_destinations.some((d) => d.type === body.type && d.details === clean))
      throw new ApiError(409, "Destination already added");
    const d = dest(`x${Date.now().toString(36)}`, body.type, clean, body.account_name);
    account.payout_destinations.push(d);
    return structuredClone(d);
  },

  async removeDestination(accountId: string, destId: string): Promise<void> {
    await latency(300);
    const account = accounts.find((a) => a.id === accountId);
    if (!account) throw new ApiError(404, "Account not found");
    if (account.payout_destinations.length <= 1) throw new ApiError(400, "Keep at least one payout destination");
    account.payout_destinations = account.payout_destinations.filter((d) => d.id !== destId);
  },

  async resolveAccountName(type: "mpesa" | "momo" | "bank", details: string): Promise<string> {
    await latency(900);
    if (details.replace(/\D/g, "").length < 6) throw new ApiError(400, "Could not resolve this account");
    return type === "mpesa" ? "WANJIKU M MWANGI" : "KIAMBU HIGHLANDS LTD";
  },
};

export function accountName(accountId: string): string {
  return accounts.find((a) => a.id === accountId)?.full_name ?? accountId;
}

export function coopName(coopId: string | null): string {
  return coops.find((c) => c.id === coopId)?.name ?? "Stawi";
}
