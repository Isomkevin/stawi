import crypto from "crypto";
import { CoopSmsSettings, EXPORTER_SMS_TOGGLE_KEYS, ExporterSmsSettings, SMS_TOGGLE_KEYS, SmsLogEntry, SmsPurpose, SmsToggleKey } from "../types";

export const DEFAULT_SMS_SETTINGS: CoopSmsSettings = {
  invite: true,
  invite_summary: true,
  share_landed: true,
  payout_sent: true,
  payout_failed: true,
};

export function resolveSmsSettings(partial?: Partial<CoopSmsSettings> | null): CoopSmsSettings {
  const next: CoopSmsSettings = { ...DEFAULT_SMS_SETTINGS };
  if (!partial) return next;
  for (const key of SMS_TOGGLE_KEYS) {
    const value = partial[key];
    if (typeof value === "boolean") next[key] = value;
  }
  return next;
}

export function isSmsToggle(purpose: SmsPurpose): purpose is SmsToggleKey {
  return (SMS_TOGGLE_KEYS as readonly string[]).includes(purpose);
}

export const DEFAULT_EXPORTER_SMS_SETTINGS: ExporterSmsSettings = {
  payment_received: true,
};

export function resolveExporterSmsSettings(partial?: Partial<ExporterSmsSettings> | null): ExporterSmsSettings {
  const next: ExporterSmsSettings = { ...DEFAULT_EXPORTER_SMS_SETTINGS };
  if (!partial) return next;
  for (const key of EXPORTER_SMS_TOGGLE_KEYS) {
    const value = partial[key];
    if (typeof value === "boolean") next[key] = value;
  }
  return next;
}

export function isExporterSmsToggle(purpose: SmsPurpose): purpose is "payment_received" {
  return (EXPORTER_SMS_TOGGLE_KEYS as readonly string[]).includes(purpose);
}

/** Login codes are logged without the digits. */
export function maskSmsForLog(purpose: SmsPurpose, message: string): string {
  if (purpose === "otp") return message.replace(/login code: \d+/i, "login code: ******");
  return message;
}

export function completeSmsLog(
  entry: Omit<SmsLogEntry, "id" | "created_at" | "account_id"> & {
    id?: string;
    created_at?: string;
    account_id?: string | null;
  }
): SmsLogEntry {
  return {
    id: entry.id ?? `sms_${crypto.randomBytes(8).toString("hex")}`,
    coop_id: entry.coop_id,
    account_id: entry.account_id ?? null,
    purpose: entry.purpose,
    phone_number: entry.phone_number,
    message: entry.message,
    status: entry.status,
    dry_run: entry.dry_run,
    created_at: entry.created_at ?? new Date().toISOString(),
    ...(entry.error ? { error: entry.error } : {}),
  };
}
