import { AsyncLocalStorage } from "async_hooks";
import fs from "fs";
import path from "path";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { normalizeBuyerCode, randomBuyerCode } from "../services/buyerCode";
import { InMemoryStore } from "../store";
import { completeSmsLog, resolveExporterSmsSettings, resolveSmsSettings } from "../services/sms";
import { ACCOUNT_TYPES, Account, AccountType, Coop, CoopMember, Invoice, PaymentProof, Payout, PayoutDestination, Shipment, ShipmentFarmer, ShipmentStatus, SmsLogEntry, Transaction, UssdSession } from "../types";

const txClient = new AsyncLocalStorage<PoolClient>();

function num(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return typeof value === "number" ? value : Number(value);
}

function iso(value: unknown): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export class PostgresStore extends InMemoryStore {
  constructor(private pool: Pool) {
    super();
  }

  private async q<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<QueryResult<T>> {
    const client = txClient.getStore();
    if (client) return client.query<T>(sql, params);
    return this.pool.query<T>(sql, params);
  }

  public async withTransaction<T>(fn: () => Promise<T>): Promise<T> {
    if (txClient.getStore()) return fn();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await txClient.run(client, fn);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  private async destinationsFor(accountIds: string[]): Promise<Map<string, PayoutDestination[]>> {
    const grouped = new Map<string, PayoutDestination[]>();
    if (accountIds.length === 0) return grouped;
    const result = await this.q(
      "SELECT * FROM payout_destinations WHERE account_id = ANY($1::varchar[]) ORDER BY created_at",
      [accountIds]
    );
    for (const row of result.rows) {
      const dest: PayoutDestination = {
        id: row.id,
        type: row.type,
        details: row.details,
        account_name: row.account_name,
        is_verified: row.is_verified,
        ...(row.bank_code ? { bank_code: row.bank_code } : {}),
      };
      const list = grouped.get(row.account_id) || [];
      list.push(dest);
      grouped.set(row.account_id, list);
    }
    return grouped;
  }

  private mapAccount(row: QueryResultRow, destinations: PayoutDestination[]): Account {
    return {
      id: row.id,
      full_name: row.full_name,
      phone_number: row.phone_number,
      id_number: row.id_number,
      payout_destinations: destinations,
      coop_id: row.coop_id,
      channel_capability: row.channel_capability,
      balance_kes_cents: num(row.balance_kes_cents),
      incoming_kes_cents: num(row.incoming_kes_cents),
      demo_balance_kes_cents: num(row.demo_balance_kes_cents),
      demo_incoming_kes_cents: num(row.demo_incoming_kes_cents),
      is_demo: row.is_demo === true,
      demo_data_enabled: row.demo_data_enabled === null || row.demo_data_enabled === undefined ? null : row.demo_data_enabled === true,
      pin_hash: row.pin_hash,
      pin_failed_attempts: num(row.pin_failed_attempts),
      pin_locked_until: iso(row.pin_locked_until),
      sms_settings: resolveExporterSmsSettings({
        payment_received: row.sms_payment_received !== false,
      }),
    };
  }

  public async saveAccount(account: Account): Promise<Account> {
    const phone = this.normalizePhone(account.phone_number);
    await this.q(
      `INSERT INTO accounts (
         id, full_name, phone_number, phone_normalized, id_number, coop_id, channel_capability,
         balance_kes_cents, incoming_kes_cents, demo_balance_kes_cents, demo_incoming_kes_cents,
         is_demo, demo_data_enabled, pin_hash, pin_failed_attempts, pin_locked_until, sms_payment_received
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,COALESCE($17, TRUE))
       ON CONFLICT (id) DO UPDATE SET
         full_name = EXCLUDED.full_name,
         phone_number = EXCLUDED.phone_number,
         phone_normalized = EXCLUDED.phone_normalized,
         id_number = EXCLUDED.id_number,
         coop_id = EXCLUDED.coop_id,
         channel_capability = EXCLUDED.channel_capability,
         balance_kes_cents = EXCLUDED.balance_kes_cents,
         incoming_kes_cents = EXCLUDED.incoming_kes_cents,
         demo_balance_kes_cents = EXCLUDED.demo_balance_kes_cents,
         demo_incoming_kes_cents = EXCLUDED.demo_incoming_kes_cents,
         is_demo = EXCLUDED.is_demo,
         demo_data_enabled = EXCLUDED.demo_data_enabled,
         pin_hash = EXCLUDED.pin_hash,
         pin_failed_attempts = EXCLUDED.pin_failed_attempts,
         pin_locked_until = EXCLUDED.pin_locked_until,
         sms_payment_received = COALESCE($17, accounts.sms_payment_received)`,
      [
        account.id,
        account.full_name,
        account.phone_number,
        phone,
        account.id_number,
        account.coop_id,
        account.channel_capability,
        account.balance_kes_cents,
        account.incoming_kes_cents,
        account.demo_balance_kes_cents ?? 0,
        account.demo_incoming_kes_cents ?? 0,
        account.is_demo === true,
        account.demo_data_enabled ?? null,
        account.pin_hash ?? null,
        account.pin_failed_attempts ?? 0,
        account.pin_locked_until,
        account.sms_settings ? account.sms_settings.payment_received : null,
      ]
    );
    await this.q("DELETE FROM payout_destinations WHERE account_id = $1", [account.id]);
    for (const dest of account.payout_destinations) {
      await this.q(
        `INSERT INTO payout_destinations (id, account_id, type, details, account_name, bank_code, is_verified)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [dest.id, account.id, dest.type, dest.details, dest.account_name, dest.bank_code ?? null, dest.is_verified]
      );
    }
    return account;
  }

  public async getAccount(id: string): Promise<Account | undefined> {
    const result = await this.q("SELECT * FROM accounts WHERE id = $1", [id]);
    if (result.rows.length === 0) return undefined;
    const destinations = await this.destinationsFor([id]);
    return this.mapAccount(result.rows[0], destinations.get(id) || []);
  }

  public async getAccountByPhone(phone: string): Promise<Account | undefined> {
    const result = await this.q("SELECT * FROM accounts WHERE phone_normalized = $1", [this.normalizePhone(phone)]);
    if (result.rows.length === 0) return undefined;
    const row = result.rows[0];
    const destinations = await this.destinationsFor([row.id]);
    return this.mapAccount(row, destinations.get(row.id) || []);
  }

  public async getAllAccounts(): Promise<Account[]> {
    const result = await this.q("SELECT * FROM accounts");
    const ids = result.rows.map((row) => row.id as string);
    const destinations = await this.destinationsFor(ids);
    return result.rows.map((row) => this.mapAccount(row, destinations.get(row.id) || []));
  }

  private mapCoop(row: QueryResultRow): Coop {
    return {
      id: row.id,
      name: row.name,
      treasurer_account_id: row.treasurer_account_id,
      sms_settings: resolveSmsSettings({
        invite: row.sms_invite !== false,
        invite_summary: row.sms_invite_summary !== false,
        share_landed: row.sms_share_landed !== false,
        payout_sent: row.sms_payout_sent !== false,
        payout_failed: row.sms_payout_failed !== false,
      }),
    };
  }

  public async saveCoop(coop: Coop): Promise<Coop> {
    if (coop.sms_settings) {
      const settings = resolveSmsSettings(coop.sms_settings);
      await this.q(
        `INSERT INTO coops (id, name, treasurer_account_id, sms_invite, sms_invite_summary, sms_share_landed, sms_payout_sent, sms_payout_failed)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           treasurer_account_id = EXCLUDED.treasurer_account_id,
           sms_invite = EXCLUDED.sms_invite,
           sms_invite_summary = EXCLUDED.sms_invite_summary,
           sms_share_landed = EXCLUDED.sms_share_landed,
           sms_payout_sent = EXCLUDED.sms_payout_sent,
           sms_payout_failed = EXCLUDED.sms_payout_failed`,
        [
          coop.id,
          coop.name,
          coop.treasurer_account_id,
          settings.invite,
          settings.invite_summary,
          settings.share_landed,
          settings.payout_sent,
          settings.payout_failed,
        ]
      );
      return { ...coop, sms_settings: settings };
    }
    await this.q(
      `INSERT INTO coops (id, name, treasurer_account_id) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, treasurer_account_id = EXCLUDED.treasurer_account_id`,
      [coop.id, coop.name, coop.treasurer_account_id]
    );
    return coop;
  }

  public async getCoop(id: string): Promise<Coop | undefined> {
    const result = await this.q("SELECT * FROM coops WHERE id = $1", [id]);
    if (result.rows.length === 0) return undefined;
    return this.mapCoop(result.rows[0]);
  }

  public async getAllCoops(): Promise<Coop[]> {
    const result = await this.q("SELECT * FROM coops");
    return result.rows.map((row) => this.mapCoop(row));
  }

  public async addSmsLog(
    entry: Omit<SmsLogEntry, "id" | "created_at" | "account_id"> & {
      id?: string;
      created_at?: string;
      account_id?: string | null;
    }
  ): Promise<SmsLogEntry> {
    const row = completeSmsLog(entry);
    await this.q(
      `INSERT INTO sms_logs (id, coop_id, account_id, purpose, phone_number, message, status, dry_run, error, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [row.id, row.coop_id, row.account_id, row.purpose, row.phone_number, row.message, row.status, row.dry_run, row.error ?? null, row.created_at]
    );
    return row;
  }

  public async listSmsLogs(coopId: string, limit: number): Promise<SmsLogEntry[]> {
    const result = await this.q(
      `SELECT * FROM sms_logs WHERE coop_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [coopId, limit]
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      coop_id: row.coop_id == null ? null : String(row.coop_id),
      account_id: row.account_id == null ? null : String(row.account_id),
      purpose: row.purpose,
      phone_number: String(row.phone_number),
      message: String(row.message),
      status: row.status,
      dry_run: row.dry_run === true,
      created_at: iso(row.created_at) ?? new Date().toISOString(),
      ...(row.error ? { error: String(row.error) } : {}),
    }));
  }

  public async listAccountSmsLogs(accountId: string, limit: number): Promise<SmsLogEntry[]> {
    const result = await this.q(
      `SELECT * FROM sms_logs WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [accountId, limit]
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      coop_id: row.coop_id == null ? null : String(row.coop_id),
      account_id: row.account_id == null ? null : String(row.account_id),
      purpose: row.purpose,
      phone_number: String(row.phone_number),
      message: String(row.message),
      status: row.status,
      dry_run: row.dry_run === true,
      created_at: iso(row.created_at) ?? new Date().toISOString(),
      ...(row.error ? { error: String(row.error) } : {}),
    }));
  }

  public async getCoopMembers(coopId: string): Promise<CoopMember[]> {
    const result = await this.q(
      `SELECT m.coop_id, m.account_id, m.contribution_share, m.kilos, a.full_name
       FROM coop_members m JOIN accounts a ON a.id = m.account_id WHERE m.coop_id = $1`,
      [coopId]
    );
    return result.rows.map((row) => ({
      coop_id: row.coop_id,
      account_id: row.account_id,
      full_name: row.full_name,
      contribution_share: num(row.contribution_share),
      kilos: row.kilos === null ? undefined : num(row.kilos),
    }));
  }

  public async removeCoopMember(coopId: string, accountId: string): Promise<boolean> {
    const removed = await this.q("DELETE FROM coop_members WHERE coop_id = $1 AND account_id = $2", [coopId, accountId]);
    if ((removed.rowCount ?? 0) === 0) return false;
    await this.q("UPDATE accounts SET coop_id = NULL WHERE id = $1 AND coop_id = $2", [accountId, coopId]);
    return true;
  }

  public async addCoopMember(member: CoopMember): Promise<void> {
    await this.q(
      `INSERT INTO coop_members (coop_id, account_id, contribution_share, kilos)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (coop_id, account_id) DO UPDATE SET
         contribution_share = EXCLUDED.contribution_share,
         kilos = EXCLUDED.kilos`,
      [member.coop_id, member.account_id, member.contribution_share, member.kilos ?? null]
    );
  }

  private mapInvoice(row: QueryResultRow): Invoice {
    return {
      id: row.id,
      type: row.type,
      account_id: row.account_id,
      coop_id: row.coop_id,
      buyer_name: row.buyer_name,
      buyer_email: row.buyer_email,
      buyer_phone: row.buyer_phone ?? undefined,
      amount: num(row.amount),
      currency: row.currency,
      description: row.description || "",
      reference: row.reference,
      status: row.status,
      split_approved: row.split_approved,
      fx_rate: row.fx_rate === null ? null : num(row.fx_rate),
      fee_kes_cents: row.fee_kes_cents === null ? null : num(row.fee_kes_cents),
      kes_total_cents: row.kes_total_cents === null ? null : num(row.kes_total_cents),
      payaza_checkout_reference: row.payaza_checkout_reference,
      payaza_link_id: row.payaza_link_id,
      is_demo: row.is_demo === true,
      created_at: iso(row.created_at) || new Date().toISOString(),
      due_at: iso(row.due_at),
    };
  }

  public async deleteInvoice(id: string): Promise<boolean> {
    const removed = await this.q("DELETE FROM invoices WHERE id = $1", [id]);
    return (removed.rowCount ?? 0) > 0;
  }

  public async saveInvoice(invoice: Invoice): Promise<Invoice> {
    await this.q(
      `INSERT INTO invoices (
         id, type, account_id, coop_id, buyer_name, buyer_email, buyer_phone, amount, currency,
         description, reference, status, split_approved, fx_rate, fee_kes_cents, kes_total_cents,
         payaza_checkout_reference, payaza_link_id, is_demo, due_at, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (id) DO UPDATE SET
         type = EXCLUDED.type,
         account_id = EXCLUDED.account_id,
         coop_id = EXCLUDED.coop_id,
         buyer_name = EXCLUDED.buyer_name,
         buyer_email = EXCLUDED.buyer_email,
         buyer_phone = EXCLUDED.buyer_phone,
         amount = EXCLUDED.amount,
         currency = EXCLUDED.currency,
         description = EXCLUDED.description,
         reference = EXCLUDED.reference,
         status = EXCLUDED.status,
         split_approved = EXCLUDED.split_approved,
         fx_rate = EXCLUDED.fx_rate,
         fee_kes_cents = EXCLUDED.fee_kes_cents,
         kes_total_cents = EXCLUDED.kes_total_cents,
         payaza_checkout_reference = EXCLUDED.payaza_checkout_reference,
         payaza_link_id = EXCLUDED.payaza_link_id,
         is_demo = EXCLUDED.is_demo,
         due_at = EXCLUDED.due_at`,
      [
        invoice.id,
        invoice.type,
        invoice.account_id,
        invoice.coop_id,
        invoice.buyer_name,
        invoice.buyer_email,
        invoice.buyer_phone ?? null,
        invoice.amount,
        invoice.currency,
        invoice.description,
        invoice.reference,
        invoice.status,
        invoice.split_approved,
        invoice.fx_rate,
        invoice.fee_kes_cents,
        invoice.kes_total_cents,
        invoice.payaza_checkout_reference,
        invoice.payaza_link_id ?? null,
        invoice.is_demo === true,
        invoice.due_at,
        invoice.created_at,
      ]
    );
    return invoice;
  }

  public async getInvoice(id: string): Promise<Invoice | undefined> {
    const lock = txClient.getStore() ? " FOR UPDATE" : "";
    const result = await this.q(`SELECT * FROM invoices WHERE id = $1${lock}`, [id]);
    return result.rows[0] ? this.mapInvoice(result.rows[0]) : undefined;
  }

  public async getInvoices(filters?: { coop_id?: string; account_id?: string }): Promise<Invoice[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters?.coop_id) {
      params.push(filters.coop_id);
      clauses.push(`coop_id = $${params.length}`);
    }
    if (filters?.account_id) {
      params.push(filters.account_id);
      clauses.push(`account_id = $${params.length}`);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.q(`SELECT * FROM invoices ${where} ORDER BY created_at DESC`, params);
    return result.rows.map((row) => this.mapInvoice(row));
  }

  private mapTransaction(row: QueryResultRow): Transaction {
    return {
      id: row.id,
      invoice_id: row.invoice_id,
      type: row.type,
      status: row.status,
      amount: num(row.amount),
      currency: row.currency,
      payaza_reference: row.payaza_reference,
      fx_rate: row.fx_rate === null ? null : num(row.fx_rate),
      fee_kes_cents: row.fee_kes_cents === null ? null : num(row.fee_kes_cents),
      is_demo: row.is_demo === true,
      created_at: iso(row.created_at) || new Date().toISOString(),
    };
  }

  public async addTransaction(transaction: Transaction): Promise<void> {
    await this.q(
      `INSERT INTO transactions (
         id, invoice_id, type, status, amount, currency, payaza_reference, fx_rate, fee_kes_cents, is_demo, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING`,
      [
        transaction.id,
        transaction.invoice_id,
        transaction.type,
        transaction.status,
        transaction.amount,
        transaction.currency,
        transaction.payaza_reference,
        transaction.fx_rate,
        transaction.fee_kes_cents,
        transaction.is_demo === true,
        transaction.created_at,
      ]
    );
  }

  public async getTransactions(invoiceId: string): Promise<Transaction[]> {
    const result = await this.q("SELECT * FROM transactions WHERE invoice_id = $1 ORDER BY created_at", [invoiceId]);
    return result.rows.map((row) => this.mapTransaction(row));
  }

  public async getAllTransactions(): Promise<Transaction[]> {
    const result = await this.q("SELECT * FROM transactions ORDER BY created_at");
    return result.rows.map((row) => this.mapTransaction(row));
  }

  private mapPayout(row: QueryResultRow): Payout {
    return {
      id: row.id,
      invoice_id: row.invoice_id,
      transaction_id: row.transaction_id ?? undefined,
      account_id: row.account_id,
      kind: row.kind,
      amount_kes_cents: num(row.amount_kes_cents),
      destination_id: row.destination_id,
      status: row.status,
      created_at: iso(row.created_at) || new Date().toISOString(),
      idempotency_key: row.idempotency_key ?? undefined,
      payaza_reference: row.payaza_reference,
      is_demo: row.is_demo === true,
      demo_portion_kes_cents: num(row.demo_portion_kes_cents),
    };
  }

  public async addPayout(payout: Payout): Promise<void> {
    await this.q(
      `INSERT INTO payouts (
         id, invoice_id, transaction_id, account_id, kind, amount_kes_cents, destination_id,
         status, idempotency_key, payaza_reference, is_demo, demo_portion_kes_cents, created_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        payout.id,
        payout.invoice_id,
        payout.transaction_id ?? null,
        payout.account_id,
        payout.kind,
        payout.amount_kes_cents,
        payout.destination_id,
        payout.status,
        payout.idempotency_key ?? null,
        payout.payaza_reference ?? null,
        payout.is_demo === true,
        payout.demo_portion_kes_cents ?? 0,
        payout.created_at,
      ]
    );
  }

  public async updatePayout(payout: Payout): Promise<void> {
    await this.q(
      `UPDATE payouts SET status = $2, idempotency_key = $3, payaza_reference = $4, destination_id = $5
       WHERE id = $1`,
      [payout.id, payout.status, payout.idempotency_key ?? null, payout.payaza_reference ?? null, payout.destination_id]
    );
  }

  public async getPayout(id: string): Promise<Payout | undefined> {
    const result = await this.q("SELECT * FROM payouts WHERE id = $1", [id]);
    return result.rows[0] ? this.mapPayout(result.rows[0]) : undefined;
  }

  public async getPayoutsByAccount(accountId: string, limit?: number): Promise<Payout[]> {
    const sql = limit
      ? "SELECT * FROM payouts WHERE account_id = $1 ORDER BY created_at DESC LIMIT $2"
      : "SELECT * FROM payouts WHERE account_id = $1 ORDER BY created_at DESC";
    const result = await this.q(sql, limit ? [accountId, limit] : [accountId]);
    return result.rows.map((row) => this.mapPayout(row));
  }

  public async getPayoutByIdempotency(idempotencyKey: string): Promise<Payout | undefined> {
    const result = await this.q("SELECT * FROM payouts WHERE idempotency_key = $1", [idempotencyKey]);
    return result.rows[0] ? this.mapPayout(result.rows[0]) : undefined;
  }

  public async getPayoutByPayazaReference(reference: string): Promise<Payout | undefined> {
    const result = await this.q("SELECT * FROM payouts WHERE payaza_reference = $1", [reference]);
    return result.rows[0] ? this.mapPayout(result.rows[0]) : undefined;
  }

  public async isWebhookProcessed(reference: string): Promise<boolean> {
    const result = await this.q("SELECT 1 FROM webhook_events WHERE reference = $1", [reference]);
    return result.rows.length > 0;
  }

  public async markWebhookProcessed(reference: string): Promise<void> {
    await this.q("INSERT INTO webhook_events (reference) VALUES ($1) ON CONFLICT DO NOTHING", [reference]);
  }

  public async saveOtp(phone: string, codeHash: string, expiresAt: string): Promise<void> {
    const normalized = this.normalizePhone(phone);
    await this.q(
      `INSERT INTO otp_codes (phone_number, code_hash, expires_at, attempts)
       VALUES ($1,$2,$3,0)
       ON CONFLICT (phone_number) DO UPDATE SET code_hash = EXCLUDED.code_hash, expires_at = EXCLUDED.expires_at, attempts = 0, created_at = CURRENT_TIMESTAMP`,
      [normalized, codeHash, expiresAt]
    );
  }

  public async getOtp(phone: string): Promise<{ codeHash: string; expiresAt: string; attempts: number } | undefined> {
    const result = await this.q("SELECT * FROM otp_codes WHERE phone_number = $1", [this.normalizePhone(phone)]);
    if (!result.rows[0]) return undefined;
    const row = result.rows[0];
    return { codeHash: row.code_hash, expiresAt: iso(row.expires_at) || "", attempts: num(row.attempts) };
  }

  public async incrementOtpAttempts(phone: string): Promise<number> {
    const result = await this.q(
      "UPDATE otp_codes SET attempts = attempts + 1 WHERE phone_number = $1 RETURNING attempts",
      [this.normalizePhone(phone)]
    );
    return result.rows[0] ? num(result.rows[0].attempts) : 0;
  }

  public async deleteOtp(phone: string): Promise<void> {
    await this.q("DELETE FROM otp_codes WHERE phone_number = $1", [this.normalizePhone(phone)]);
  }

  public async saveSession(tokenHash: string, accountId: string, expiresAt: string): Promise<void> {
    await this.q(
      `INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1,$2,$3)
       ON CONFLICT (token_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [tokenHash, accountId, expiresAt]
    );
  }

  public async getSessionAccount(tokenHash: string): Promise<Account | undefined> {
    const result = await this.q("SELECT account_id, expires_at FROM sessions WHERE token_hash = $1", [tokenHash]);
    const row = result.rows[0];
    if (!row) return undefined;
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      await this.deleteSession(tokenHash);
      return undefined;
    }
    return this.getAccount(row.account_id);
  }

  public async deleteSession(tokenHash: string): Promise<void> {
    await this.q("DELETE FROM sessions WHERE token_hash = $1", [tokenHash]);
  }

  private mapShipment(row: QueryResultRow, farmers: ShipmentFarmer[]): Shipment {
    return {
      id: row.id,
      reference: row.reference,
      coop_id: row.coop_id ?? "",
      account_id: row.account_id ?? null,
      buyer_name: row.buyer_name,
      product: row.product,
      quantity_kg: num(row.quantity_kg),
      destination: row.destination,
      value: num(row.value),
      currency: row.currency,
      ship_date: iso(row.ship_date) || new Date().toISOString(),
      shipped_at: iso(row.shipped_at),
      status: row.status as ShipmentStatus,
      invoice_id: row.invoice_id,
      farmers,
      buyer_code: typeof row.buyer_code === "string" ? row.buyer_code : undefined,
      is_demo: row.is_demo === true,
      updated_at: iso(row.updated_at) || new Date().toISOString(),
    };
  }

  private async allocatePortalCode(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = randomBuyerCode();
      const hit = await this.q("SELECT 1 FROM shipments WHERE buyer_code = $1", [code]);
      if (!hit.rows[0]) return code;
    }
    throw new Error("Could not allocate a buyer portal code");
  }

  private async portalCodeForSave(shipment: Shipment): Promise<string> {
    const incoming = normalizeBuyerCode(shipment.buyer_code);
    if (incoming) {
      const hit = await this.q<{ id: string }>("SELECT id FROM shipments WHERE buyer_code = $1", [incoming]);
      if (!hit.rows[0] || hit.rows[0].id === shipment.id) return incoming;
    }
    const existing = await this.q<{ buyer_code: string | null }>("SELECT buyer_code FROM shipments WHERE id = $1", [shipment.id]);
    if (existing.rows[0]?.buyer_code) return existing.rows[0].buyer_code;
    return this.allocatePortalCode();
  }

  /** Older rows were saved before portal codes existed. Fill the code on read so the link is stable. */
  private async withBuyerCode(shipment: Shipment): Promise<Shipment> {
    if (shipment.buyer_code) return shipment;
    const code = await this.allocatePortalCode();
    await this.q("UPDATE shipments SET buyer_code = $1 WHERE id = $2 AND buyer_code IS NULL", [code, shipment.id]);
    const again = await this.q<{ buyer_code: string | null }>("SELECT buyer_code FROM shipments WHERE id = $1", [shipment.id]);
    shipment.buyer_code = again.rows[0]?.buyer_code || code;
    return shipment;
  }

  private async farmersFor(shipmentIds: string[]): Promise<Map<string, ShipmentFarmer[]>> {
    const grouped = new Map<string, ShipmentFarmer[]>();
    if (shipmentIds.length === 0) return grouped;
    const result = await this.q(
      "SELECT shipment_id, account_id, kilos FROM shipment_farmers WHERE shipment_id = ANY($1::varchar[]) ORDER BY account_id",
      [shipmentIds]
    );
    for (const row of result.rows) {
      const list = grouped.get(row.shipment_id) || [];
      list.push({ account_id: row.account_id, kilos: num(row.kilos) });
      grouped.set(row.shipment_id, list);
    }
    return grouped;
  }

  public async saveShipment(shipment: Shipment): Promise<Shipment> {
    shipment.buyer_code = await this.portalCodeForSave(shipment);
    await this.q(
      `INSERT INTO shipments (
         id, reference, coop_id, buyer_name, product, quantity_kg, destination, value, currency,
         ship_date, shipped_at, status, invoice_id, is_demo, updated_at, account_id, buyer_code
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         reference = EXCLUDED.reference,
         coop_id = EXCLUDED.coop_id,
         buyer_name = EXCLUDED.buyer_name,
         product = EXCLUDED.product,
         quantity_kg = EXCLUDED.quantity_kg,
         destination = EXCLUDED.destination,
         value = EXCLUDED.value,
         currency = EXCLUDED.currency,
         ship_date = EXCLUDED.ship_date,
         shipped_at = EXCLUDED.shipped_at,
         status = EXCLUDED.status,
         invoice_id = EXCLUDED.invoice_id,
         is_demo = EXCLUDED.is_demo,
         updated_at = EXCLUDED.updated_at,
         account_id = EXCLUDED.account_id,
         buyer_code = COALESCE(EXCLUDED.buyer_code, shipments.buyer_code)`,
      [
        shipment.id,
        shipment.reference,
        shipment.coop_id || null,
        shipment.buyer_name,
        shipment.product,
        shipment.quantity_kg,
        shipment.destination,
        shipment.value,
        shipment.currency,
        shipment.ship_date,
        shipment.shipped_at,
        shipment.status,
        shipment.invoice_id,
        shipment.is_demo === true,
        shipment.updated_at,
        shipment.account_id ?? null,
        shipment.buyer_code,
      ]
    );
    await this.q("DELETE FROM shipment_farmers WHERE shipment_id = $1", [shipment.id]);
    for (const farmer of shipment.farmers) {
      await this.q(
        "INSERT INTO shipment_farmers (shipment_id, account_id, kilos) VALUES ($1,$2,$3)",
        [shipment.id, farmer.account_id, farmer.kilos]
      );
    }
    return shipment;
  }

  public async deleteShipment(id: string): Promise<boolean> {
    const removed = await this.q("DELETE FROM shipments WHERE id = $1", [id]);
    return (removed.rowCount ?? 0) > 0;
  }

  public async getShipment(id: string): Promise<Shipment | undefined> {
    const result = await this.q("SELECT * FROM shipments WHERE id = $1", [id]);
    if (!result.rows[0]) return undefined;
    const farmers = await this.farmersFor([id]);
    return this.withBuyerCode(this.mapShipment(result.rows[0], farmers.get(id) || []));
  }

  public async listShipments(coopId: string): Promise<Shipment[]> {
    const result = await this.q("SELECT * FROM shipments WHERE coop_id = $1 ORDER BY ship_date DESC", [coopId]);
    const ids = result.rows.map((row) => row.id as string);
    const farmers = await this.farmersFor(ids);
    const shipments = result.rows.map((row) => this.mapShipment(row, farmers.get(row.id) || []));
    return Promise.all(shipments.map((shipment) => this.withBuyerCode(shipment)));
  }

  public async listAccountShipments(accountId: string): Promise<Shipment[]> {
    const result = await this.q("SELECT * FROM shipments WHERE account_id = $1 ORDER BY ship_date DESC", [accountId]);
    const ids = result.rows.map((row) => row.id as string);
    const farmers = await this.farmersFor(ids);
    const shipments = result.rows.map((row) => this.mapShipment(row, farmers.get(row.id) || []));
    return Promise.all(shipments.map((shipment) => this.withBuyerCode(shipment)));
  }

  public async getShipmentByInvoice(invoiceId: string): Promise<Shipment | undefined> {
    const result = await this.q("SELECT * FROM shipments WHERE invoice_id = $1 LIMIT 1", [invoiceId]);
    if (!result.rows[0]) return undefined;
    const id = result.rows[0].id as string;
    const farmers = await this.farmersFor([id]);
    return this.withBuyerCode(this.mapShipment(result.rows[0], farmers.get(id) || []));
  }

  public async findShipmentByReference(reference: string): Promise<Shipment | undefined> {
    const result = await this.q("SELECT * FROM shipments WHERE LOWER(reference) = LOWER($1) LIMIT 1", [reference.trim()]);
    if (!result.rows[0]) return undefined;
    const id = result.rows[0].id as string;
    const farmers = await this.farmersFor([id]);
    return this.withBuyerCode(this.mapShipment(result.rows[0], farmers.get(id) || []));
  }

  public async findShipmentByBuyerCode(code: string): Promise<Shipment | undefined> {
    const key = normalizeBuyerCode(code);
    if (!key) return undefined;
    const result = await this.q("SELECT * FROM shipments WHERE buyer_code = $1 LIMIT 1", [key]);
    if (!result.rows[0]) return undefined;
    const id = result.rows[0].id as string;
    const farmers = await this.farmersFor([id]);
    return this.mapShipment(result.rows[0], farmers.get(id) || []);
  }

  private mapProof(row: QueryResultRow): PaymentProof {
    const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? null : String(v));
    return {
      id: row.id,
      invoice_id: row.invoice_id,
      shipment_id: row.shipment_id ?? null,
      shipment_reference: row.shipment_reference,
      coop_id: row.coop_id ?? null,
      account_id: row.account_id ?? null,
      payer_name: row.payer_name,
      payer_email: row.payer_email,
      bank_reference: row.bank_reference,
      amount: Number(row.amount),
      currency: row.currency,
      paid_at: row.paid_at,
      note: row.note ?? null,
      receipt_name: row.receipt_name ?? null,
      receipt_data: row.receipt_data ?? null,
      status: row.status,
      reviewed_by: row.reviewed_by ?? null,
      reviewed_at: iso(row.reviewed_at),
      created_at: iso(row.created_at) || new Date().toISOString(),
    };
  }

  public async savePaymentProof(p: PaymentProof): Promise<PaymentProof> {
    await this.q(
      `INSERT INTO payment_proofs (id, invoice_id, shipment_id, shipment_reference, coop_id, account_id, payer_name, payer_email,
         bank_reference, amount, currency, paid_at, note, receipt_name, receipt_data, status, reviewed_by, reviewed_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, reviewed_by = EXCLUDED.reviewed_by, reviewed_at = EXCLUDED.reviewed_at`,
      [p.id, p.invoice_id, p.shipment_id, p.shipment_reference, p.coop_id, p.account_id, p.payer_name, p.payer_email,
       p.bank_reference, p.amount, p.currency, p.paid_at, p.note, p.receipt_name, p.receipt_data ?? null, p.status, p.reviewed_by, p.reviewed_at, p.created_at]
    );
    return p;
  }

  public async getPaymentProof(id: string): Promise<PaymentProof | undefined> {
    const result = await this.q("SELECT * FROM payment_proofs WHERE id = $1", [id]);
    return result.rows[0] ? this.mapProof(result.rows[0]) : undefined;
  }

  public async listPaymentProofs(filter: { coop_id?: string; account_id?: string; invoice_id?: string }): Promise<PaymentProof[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    for (const key of ["coop_id", "account_id", "invoice_id"] as const) {
      if (filter[key]) {
        params.push(filter[key]);
        where.push(`${key} = $${params.length}`);
      }
    }
    const result = await this.q(
      `SELECT * FROM payment_proofs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC`,
      params
    );
    return result.rows.map((row) => this.mapProof(row));
  }

  public async flagDemoInvoice(id: string): Promise<boolean> {
    const updated = await this.q("UPDATE invoices SET is_demo = true WHERE id = $1 AND is_demo = false", [id]);
    if ((updated.rowCount ?? 0) === 0) return false;
    await this.q("UPDATE transactions SET is_demo = true WHERE invoice_id = $1", [id]);
    await this.q("UPDATE payouts SET is_demo = true WHERE invoice_id = $1", [id]);
    await this.q("UPDATE shipments SET is_demo = true WHERE invoice_id = $1", [id]);
    return true;
  }

  public async flagSeedWithdrawals(): Promise<void> {
    await this.q(
      `UPDATE payouts
       SET is_demo = true, demo_portion_kes_cents = amount_kes_cents
       WHERE idempotency_key LIKE 'seed-wth-%' OR payaza_reference LIKE 'PZ-WTH-%'`
    );
  }

  public async flagDemoAccount(id: string): Promise<void> {
    await this.q("UPDATE accounts SET is_demo = true WHERE id = $1", [id]);
  }

  public async flagDemoShipment(id: string): Promise<void> {
    await this.q("UPDATE shipments SET is_demo = true WHERE id = $1", [id]);
  }

  public async getExplicitAccountTypes(phone: string): Promise<AccountType[] | null> {
    const key = this.normalizePhone(phone);
    const head = await this.q("SELECT phone_normalized FROM phone_mappings WHERE phone_normalized = $1", [key]);
    if (head.rows.length === 0) return null;
    const types = await this.q("SELECT account_type FROM phone_account_types WHERE phone_normalized = $1", [key]);
    const found = types.rows.map((row) => row.account_type as AccountType);
    return ACCOUNT_TYPES.filter((type) => found.includes(type));
  }

  public async saveExplicitAccountTypes(phone: string, types: AccountType[]): Promise<AccountType[]> {
    const key = this.normalizePhone(phone);
    const unique = ACCOUNT_TYPES.filter((type) => types.includes(type));
    await this.q(
      "INSERT INTO phone_mappings (phone_normalized) VALUES ($1) ON CONFLICT (phone_normalized) DO NOTHING",
      [key]
    );
    await this.q("DELETE FROM phone_account_types WHERE phone_normalized = $1", [key]);
    for (const type of unique) {
      await this.q(
        "INSERT INTO phone_account_types (phone_normalized, account_type) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [key, type]
      );
    }
    return unique;
  }

  public async listExplicitAccountTypes(): Promise<Array<{ phone_number: string; account_types: AccountType[] }>> {
    const phones = await this.q("SELECT phone_normalized FROM phone_mappings ORDER BY phone_normalized");
    const types = await this.q("SELECT phone_normalized, account_type FROM phone_account_types");
    const grouped = new Map<string, AccountType[]>();
    for (const row of phones.rows) grouped.set(String(row.phone_normalized), []);
    for (const row of types.rows) {
      const phone = String(row.phone_normalized);
      const list = grouped.get(phone) ?? [];
      list.push(row.account_type as AccountType);
      grouped.set(phone, list);
    }
    return Array.from(grouped.entries()).map(([phone_number, account_types]) => ({
      phone_number,
      account_types: ACCOUNT_TYPES.filter((type) => account_types.includes(type)),
    }));
  }

  public async getUssdSession(sessionId: string): Promise<UssdSession | undefined> {
    const result = await this.q("SELECT * FROM ussd_sessions WHERE session_id = $1", [sessionId]);
    const row = result.rows[0];
    return row ? ussdSessionFrom(row) : undefined;
  }

  public async saveUssdSession(session: UssdSession): Promise<UssdSession> {
    await this.q(
      `INSERT INTO ussd_sessions (
         session_id, phone_number, account_id, service_code, last_text, text_hash, last_response, state, created_at, updated_at, expires_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (session_id) DO UPDATE SET
         phone_number = EXCLUDED.phone_number,
         account_id = EXCLUDED.account_id,
         service_code = EXCLUDED.service_code,
         last_text = EXCLUDED.last_text,
         text_hash = EXCLUDED.text_hash,
         last_response = EXCLUDED.last_response,
         state = EXCLUDED.state,
         updated_at = EXCLUDED.updated_at,
         expires_at = EXCLUDED.expires_at`,
      [
        session.session_id,
        session.phone_number,
        session.account_id,
        session.service_code,
        session.last_text,
        session.text_hash,
        session.last_response,
        session.state,
        session.created_at,
        session.updated_at,
        session.expires_at,
      ]
    );
    return session;
  }

  public async listUssdSessions(limit: number): Promise<UssdSession[]> {
    const result = await this.q("SELECT * FROM ussd_sessions ORDER BY updated_at DESC LIMIT $1", [limit]);
    return result.rows.map((row) => ussdSessionFrom(row));
  }

  public async consumeUssdRate(
    phone: string,
    limit: number,
    windowMs: number
  ): Promise<{ hits: number; limited: boolean }> {
    const result = await this.q(
      `INSERT INTO ussd_rate (phone_number, window_start, hits)
       VALUES ($1, NOW(), 1)
       ON CONFLICT (phone_number) DO UPDATE SET
         hits = CASE
           WHEN ussd_rate.window_start <= NOW() - ($2::double precision * INTERVAL '1 millisecond') THEN 1
           ELSE ussd_rate.hits + 1
         END,
         window_start = CASE
           WHEN ussd_rate.window_start <= NOW() - ($2::double precision * INTERVAL '1 millisecond') THEN NOW()
           ELSE ussd_rate.window_start
         END
       RETURNING hits`,
      [phone, windowMs]
    );
    const hits = num(result.rows[0]?.hits);
    return { hits, limited: hits > limit };
  }

  public async reset(): Promise<void> {
    await this.q(
      `TRUNCATE ussd_rate, ussd_sessions, sms_logs, webhook_events, otp_codes, sessions, payouts, transactions, shipment_farmers, shipments, invoices, coop_members, payout_destinations, phone_account_types, phone_mappings, accounts, coops RESTART IDENTITY CASCADE`
    );
  }
}

function ussdSessionFrom(row: QueryResultRow): UssdSession {
  return {
    session_id: String(row.session_id),
    phone_number: String(row.phone_number),
    account_id: row.account_id ? String(row.account_id) : null,
    service_code: row.service_code ? String(row.service_code) : null,
    last_text: String(row.last_text ?? ""),
    text_hash: String(row.text_hash ?? ""),
    last_response: row.last_response ? String(row.last_response) : null,
    state: String(row.state),
    created_at: iso(row.created_at) || new Date().toISOString(),
    updated_at: iso(row.updated_at) || new Date().toISOString(),
    expires_at: iso(row.expires_at) || new Date().toISOString(),
  };
}

export async function connectPostgres(connectionString: string): Promise<PostgresStore> {
  const pool = new Pool({
    connectionString,
    ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
  });
  const schemaPath = path.resolve(__dirname, "../../db/schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf8");
  const stripped = schema
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  const statements = stripped
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await pool.query(statement);
  }
  return new PostgresStore(pool);
}
