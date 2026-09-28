import {
  Account,
  Coop,
  CoopMember,
  Invoice,
  Payout,
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

  public normalizePhone(phone: string): string {
    const cleaned = phone.replace(/[^\d+]/g, "");
    if (cleaned.startsWith("0")) {
      return `+254${cleaned.substring(1)}`;
    }
    if (cleaned.startsWith("254")) {
      return `+${cleaned}`;
    }
    if (!cleaned.startsWith("+")) {
      return `+${cleaned}`;
    }
    return cleaned;
  }

  // Account
  public saveAccount(account: Account): Account {
    this.accounts.set(account.id, account);
    const normalized = this.normalizePhone(account.phone_number);
    this.accountPhones.set(normalized, account.id);
    return account;
  }

  public getAccount(id: string): Account | undefined {
    return this.accounts.get(id);
  }

  public getAccountByPhone(phone: string): Account | undefined {
    const normalized = this.normalizePhone(phone);
    const accountId = this.accountPhones.get(normalized);
    if (!accountId) return undefined;
    return this.accounts.get(accountId);
  }

  public getAllAccounts(): Account[] {
    return Array.from(this.accounts.values());
  }

  // Coop
  public saveCoop(coop: Coop): Coop {
    this.coops.set(coop.id, coop);
    return coop;
  }

  public getCoop(id: string): Coop | undefined {
    return this.coops.get(id);
  }

  public getAllCoops(): Coop[] {
    return Array.from(this.coops.values());
  }

  // CoopMember
  public getCoopMembers(coopId: string): CoopMember[] {
    return this.coopMembers.get(coopId) || [];
  }

  public addCoopMember(member: CoopMember): void {
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
  public saveInvoice(invoice: Invoice): Invoice {
    this.invoices.set(invoice.id, invoice);
    return invoice;
  }

  public getInvoice(id: string): Invoice | undefined {
    return this.invoices.get(id);
  }

  public getInvoices(filters?: { coop_id?: string; account_id?: string }): Invoice[] {
    const all = Array.from(this.invoices.values());
    if (!filters) return all;

    return all.filter((inv) => {
      if (filters.coop_id && inv.coop_id !== filters.coop_id) return false;
      if (filters.account_id && inv.account_id !== filters.account_id) return false;
      return true;
    });
  }

  // Transaction
  public addTransaction(transaction: Transaction): void {
    const txs = this.transactions.get(transaction.invoice_id) || [];
    txs.push(transaction);
    this.transactions.set(transaction.invoice_id, txs);
  }

  public getTransactions(invoiceId: string): Transaction[] {
    return this.transactions.get(invoiceId) || [];
  }

  public getAllTransactions(): Transaction[] {
    const all: Transaction[] = [];
    for (const list of this.transactions.values()) {
      all.push(...list);
    }
    return all;
  }

  // Payout
  public addPayout(payout: Payout): void {
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

  public updatePayout(payout: Payout): void {
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

  public getPayout(id: string): Payout | undefined {
    return this.payouts.get(id);
  }

  public getPayoutsByAccount(accountId: string, limit?: number): Payout[] {
    const list = this.payoutsByAccount.get(accountId) || [];
    if (limit && limit > 0) {
      return list.slice(0, limit);
    }
    return list;
  }

  public getPayoutByIdempotency(idempotencyKey: string): Payout | undefined {
    return this.payoutsByIdempotency.get(idempotencyKey);
  }

  public getPayoutByPayazaReference(reference: string): Payout | undefined {
    const id = this.payoutsByPayazaRef.get(reference);
    return id ? this.payouts.get(id) : undefined;
  }

  // Webhook idempotency
  public isWebhookProcessed(reference: string): boolean {
    return this.processedWebhookRefs.has(reference);
  }

  public markWebhookProcessed(reference: string): void {
    this.processedWebhookRefs.add(reference);
  }

  // Reset store (for testing)
  public reset(): void {
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
  }
}

export const store = new InMemoryStore();
