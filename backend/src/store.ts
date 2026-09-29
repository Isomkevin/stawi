import { normalizePhone as normalizeKenyanPhone } from "./services/phone";
import {
  ACCOUNT_TYPES,
  Account,
  AccountType,
  Coop,
  CoopMember,
  Invoice,
  Payout,
  PaymentProof,
  Shipment,
  Transaction,
} from "./types";

export class InMemoryStore {
  private accounts = new Map<string, Account>();
  private accountPhones = new Map<string, string>(); // normalized phone -> account_id
  private coops = new Map<string, Coop>();
  private coopMembers = new Map<string, CoopMember[]>(); // coop_id -> CoopMember[]
  private invoices = new Map<string, Invoice>();
  private transactions = new Map<string, Transaction[]>(); // invoice_id -> Transaction[]
  private payouts = new Map<string, Payout>(); // payout_id -> Payout
  private payoutsByAccount = new Map<string, Payout[]>(); // account_id -> Payout[]
  private payoutsByIdempotency = new Map<string, Payout>(); // idempotency_key -> Payout
  private payoutsByPayazaRef = new Map<string, string>(); // payaza transaction_reference -> payout_id
  private processedWebhookRefs = new Set<string>();
  private otps = new Map<string, { codeHash: string; expiresAt: string; attempts: number }>();
  private sessions = new Map<string, { accountId: string; expiresAt: string }>();
  private shipments = new Map<string, Shipment>();
  private paymentProofs = new Map<string, PaymentProof>();
  /** Present key means an admin saved this phone. The set may be empty. */
  private explicitTypes = new Map<string, Set<AccountType>>();

  public normalizePhone(phone: string): string {
    return normalizeKenyanPhone(phone);
  }

  public async getExplicitAccountTypes(phone: string): Promise<AccountType[] | null> {
    const set = this.explicitTypes.get(this.normalizePhone(phone));
    if (!set) return null;
    return ACCOUNT_TYPES.filter((type) => set.has(type));
  }

  public async saveExplicitAccountTypes(phone: string, types: AccountType[]): Promise<AccountType[]> {
    const unique = ACCOUNT_TYPES.filter((type) => types.includes(type));
    this.explicitTypes.set(this.normalizePhone(phone), new Set(unique));
    return unique;
  }

  public async listExplicitAccountTypes(): Promise<Array<{ phone_number: string; account_types: AccountType[] }>> {
    return Array.from(this.explicitTypes.entries())
      .map(([phone_number, set]) => ({
        phone_number,
        account_types: ACCOUNT_TYPES.filter((type) => set.has(type)),
      }))
      .sort((a, b) => a.phone_number.localeCompare(b.phone_number));
  }

  // Account
  public async saveAccount(account: Account): Promise<Account> {
    this.accounts.set(account.id, account);
    const normalized = this.normalizePhone(account.phone_number);
    this.accountPhones.set(normalized, account.id);
    return account;
  }

  public async getAccount(id: string): Promise<Account | undefined> {
    return this.accounts.get(id);
  }

  public async getAccountByPhone(phone: string): Promise<Account | undefined> {
    const normalized = this.normalizePhone(phone);
    const accountId = this.accountPhones.get(normalized);
    if (!accountId) return undefined;
    return this.accounts.get(accountId);
  }

  public async getAllAccounts(): Promise<Account[]> {
    return Array.from(this.accounts.values());
  }

  // Coop
  public async saveCoop(coop: Coop): Promise<Coop> {
    this.coops.set(coop.id, coop);
    return coop;
  }

  public async getCoop(id: string): Promise<Coop | undefined> {
    return this.coops.get(id);
  }

  public async getAllCoops(): Promise<Coop[]> {
    return Array.from(this.coops.values());
  }

  // CoopMember
  public async getCoopMembers(coopId: string): Promise<CoopMember[]> {
    return this.coopMembers.get(coopId) || [];
  }

  public async removeCoopMember(coopId: string, accountId: string): Promise<boolean> {
    const members = this.coopMembers.get(coopId) || [];
    const next = members.filter((member) => member.account_id !== accountId);
    if (next.length === members.length) return false;
    this.coopMembers.set(coopId, next);
    const account = this.accounts.get(accountId);
    if (account?.coop_id === coopId) {
      account.coop_id = null;
      this.accounts.set(accountId, account);
    }
    return true;
  }

  public async addCoopMember(member: CoopMember): Promise<void> {
    const members = this.coopMembers.get(member.coop_id) || [];
    const existingIndex = members.findIndex((m) => m.account_id === member.account_id);
    if (existingIndex >= 0) {
      members[existingIndex] = member;
    } else {
      members.push(member);
    }
    this.coopMembers.set(member.coop_id, members);
  }

  // Invoice
  public async saveInvoice(invoice: Invoice): Promise<Invoice> {
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  public async getInvoice(id: string): Promise<Invoice | undefined> {
    return this.invoices.get(id);
  }

  public async deleteInvoice(id: string): Promise<boolean> {
    if (!this.invoices.has(id)) return false;
    this.invoices.delete(id);
    this.transactions.delete(id);
    for (const shipment of this.shipments.values()) {
      if (shipment.invoice_id === id) shipment.invoice_id = null;
    }
    return true;
  }

  public async getInvoices(filters?: { coop_id?: string; account_id?: string }): Promise<Invoice[]> {
    const all = Array.from(this.invoices.values());
    if (!filters) return all;

    return all.filter((inv) => {
      if (filters.coop_id && inv.coop_id !== filters.coop_id) return false;
      if (filters.account_id && inv.account_id !== filters.account_id) return false;
      return true;
    });
  }

  // Transaction
  public async addTransaction(transaction: Transaction): Promise<void> {
    const txs = this.transactions.get(transaction.invoice_id) || [];
    txs.push(transaction);
    this.transactions.set(transaction.invoice_id, txs);
  }

  public async getTransactions(invoiceId: string): Promise<Transaction[]> {
    return this.transactions.get(invoiceId) || [];
  }

  public async getAllTransactions(): Promise<Transaction[]> {
    const all: Transaction[] = [];
    for (const list of this.transactions.values()) {
      all.push(...list);
    }
    return all;
  }

  // Payout
  public async addPayout(payout: Payout): Promise<void> {
    this.payouts.set(payout.id, payout);

    const accountList = this.payoutsByAccount.get(payout.account_id) || [];
    // Insert newest first
    accountList.unshift(payout);
    this.payoutsByAccount.set(payout.account_id, accountList);

    if (payout.idempotency_key) {
      this.payoutsByIdempotency.set(payout.idempotency_key, payout);
    }
    if (payout.payaza_reference) {
      this.payoutsByPayazaRef.set(payout.payaza_reference, payout.id);
    }
  }

  public async updatePayout(payout: Payout): Promise<void> {
    this.payouts.set(payout.id, payout);
    const list = this.payoutsByAccount.get(payout.account_id);
    if (list) {
      const idx = list.findIndex((p) => p.id === payout.id);
      if (idx >= 0) list[idx] = payout;
    }
    if (payout.idempotency_key) {
      this.payoutsByIdempotency.set(payout.idempotency_key, payout);
    }
    if (payout.payaza_reference) {
      this.payoutsByPayazaRef.set(payout.payaza_reference, payout.id);
    }
  }

  public async getPayout(id: string): Promise<Payout | undefined> {
    return this.payouts.get(id);
  }

  public async getPayoutsByAccount(accountId: string, limit?: number): Promise<Payout[]> {
    const list = this.payoutsByAccount.get(accountId) || [];
    if (limit && limit > 0) {
      return list.slice(0, limit);
    }
    return list;
  }

  public async getPayoutByIdempotency(idempotencyKey: string): Promise<Payout | undefined> {
    return this.payoutsByIdempotency.get(idempotencyKey);
  }

  public async getPayoutByPayazaReference(reference: string): Promise<Payout | undefined> {
    const id = this.payoutsByPayazaRef.get(reference);
    return id ? this.payouts.get(id) : undefined;
  }

  public async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  public async saveOtp(phone: string, codeHash: string, expiresAt: string): Promise<void> {
    this.otps.set(this.normalizePhone(phone), { codeHash, expiresAt, attempts: 0 });
  }

  public async getOtp(phone: string): Promise<{ codeHash: string; expiresAt: string; attempts: number } | undefined> {
    return this.otps.get(this.normalizePhone(phone));
  }

  public async incrementOtpAttempts(phone: string): Promise<number> {
    const row = this.otps.get(this.normalizePhone(phone));
    if (!row) return 0;
    row.attempts += 1;
    return row.attempts;
  }

  public async deleteOtp(phone: string): Promise<void> {
    this.otps.delete(this.normalizePhone(phone));
  }

  public async saveSession(tokenHash: string, accountId: string, expiresAt: string): Promise<void> {
    this.sessions.set(tokenHash, { accountId, expiresAt });
  }

  public async getSessionAccount(tokenHash: string): Promise<Account | undefined> {
    const row = this.sessions.get(tokenHash);
    if (!row) return undefined;
    if (new Date(row.expiresAt).getTime() <= Date.now()) {
      this.sessions.delete(tokenHash);
      return undefined;
    }
    return this.accounts.get(row.accountId);
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }

  public async saveShipment(shipment: Shipment): Promise<Shipment> {
    this.shipments.set(shipment.id, {
      ...shipment,
      farmers: shipment.farmers.map((farmer) => ({ ...farmer })),
    });
    return this.shipments.get(shipment.id)!;
  }

  public async getShipment(id: string): Promise<Shipment | undefined> {
    const shipment = this.shipments.get(id);
    if (!shipment) return undefined;
    return { ...shipment, farmers: shipment.farmers.map((farmer) => ({ ...farmer })) };
  }

  public async deleteShipment(id: string): Promise<boolean> {
    return this.shipments.delete(id);
  }

  public async listShipments(coopId: string): Promise<Shipment[]> {
    return Array.from(this.shipments.values())
      .filter((shipment) => shipment.coop_id === coopId)
      .sort((a, b) => b.ship_date.localeCompare(a.ship_date))
      .map((shipment) => ({ ...shipment, farmers: shipment.farmers.map((farmer) => ({ ...farmer })) }));
  }

  public async listAccountShipments(accountId: string): Promise<Shipment[]> {
    return Array.from(this.shipments.values())
      .filter((shipment) => shipment.account_id === accountId)
      .sort((a, b) => b.ship_date.localeCompare(a.ship_date))
      .map((shipment) => ({ ...shipment, farmers: shipment.farmers.map((farmer) => ({ ...farmer })) }));
  }

  public async getShipmentByInvoice(invoiceId: string): Promise<Shipment | undefined> {
    for (const shipment of this.shipments.values()) {
      if (shipment.invoice_id === invoiceId) {
        return { ...shipment, farmers: shipment.farmers.map((farmer) => ({ ...farmer })) };
      }
    }
    return undefined;
  }

  public async findShipmentByReference(reference: string): Promise<Shipment | undefined> {
    const key = reference.trim().toLowerCase();
    for (const shipment of this.shipments.values()) {
      if (shipment.reference.toLowerCase() === key) {
        return { ...shipment, farmers: shipment.farmers.map((farmer) => ({ ...farmer })) };
      }
    }
    return undefined;
  }

  public async savePaymentProof(proof: PaymentProof): Promise<PaymentProof> {
    this.paymentProofs.set(proof.id, { ...proof });
    return { ...proof };
  }

  public async getPaymentProof(id: string): Promise<PaymentProof | undefined> {
    const proof = this.paymentProofs.get(id);
    return proof ? { ...proof } : undefined;
  }

  public async listPaymentProofs(filter: { coop_id?: string; account_id?: string; invoice_id?: string }): Promise<PaymentProof[]> {
    return Array.from(this.paymentProofs.values())
      .filter((p) => (!filter.coop_id || p.coop_id === filter.coop_id) && (!filter.account_id || p.account_id === filter.account_id) && (!filter.invoice_id || p.invoice_id === filter.invoice_id))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => ({ ...p }));
  }

  // Webhook idempotency
  public async isWebhookProcessed(reference: string): Promise<boolean> {
    return this.processedWebhookRefs.has(reference);
  }

  public async markWebhookProcessed(reference: string): Promise<void> {
    this.processedWebhookRefs.add(reference);
  }

  /** Marks a legacy seeded invoice and the rows that belong to it. Returns false when it was already sample data or missing. */
  public async flagDemoInvoice(id: string): Promise<boolean> {
    const invoice = this.invoices.get(id);
    if (!invoice || invoice.is_demo) return false;
    invoice.is_demo = true;
    for (const tx of this.transactions.get(id) || []) tx.is_demo = true;
    for (const payout of this.payouts.values()) {
      if (payout.invoice_id !== id) continue;
      payout.is_demo = true;
    }
    for (const shipment of this.shipments.values()) {
      if (shipment.invoice_id === id) shipment.is_demo = true;
    }
    return true;
  }

  public async flagSeedWithdrawals(): Promise<void> {
    for (const payout of this.payouts.values()) {
      const seeded =
        payout.idempotency_key?.startsWith("seed-wth-") || payout.payaza_reference?.startsWith("PZ-WTH-");
      if (!seeded) continue;
      payout.is_demo = true;
      payout.demo_portion_kes_cents = payout.amount_kes_cents;
    }
  }

  public async flagDemoAccount(id: string): Promise<void> {
    const account = this.accounts.get(id);
    if (account) account.is_demo = true;
  }

  public async flagDemoShipment(id: string): Promise<void> {
    const shipment = this.shipments.get(id);
    if (shipment) shipment.is_demo = true;
  }

  // Reset store (for testing)
  public async reset(): Promise<void> {
    this.accounts.clear();
    this.accountPhones.clear();
    this.coops.clear();
    this.coopMembers.clear();
    this.invoices.clear();
    this.transactions.clear();
    this.payouts.clear();
    this.payoutsByAccount.clear();
    this.payoutsByIdempotency.clear();
    this.payoutsByPayazaRef.clear();
    this.processedWebhookRefs.clear();
    this.otps.clear();
    this.sessions.clear();
    this.shipments.clear();
    this.explicitTypes.clear();
  }
}

const memoryStore = new InMemoryStore();
let activeStore: InMemoryStore = memoryStore;

export function setStore(next: InMemoryStore): void {
  activeStore = next;
}

export const store: InMemoryStore = new Proxy({} as InMemoryStore, {
  get(_target, prop) {
    const value = (activeStore as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(activeStore) : value;
  },
});
