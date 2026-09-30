import { store } from "../store";
import { isKenyanPhone, normalizePhone } from "./phone";
import {
  RosterApplyResult,
  RosterColumnMap,
  RosterImportRow,
  RosterPreview,
} from "../types";

const MAX_BYTES = 1_000_000;
const MAX_ROWS = 5_000;

const NAME_RE = /^(name|jina|farmer|full[ _-]?name|member)$/i;
const PHONE_RE = /^(phone|simu|nambari|msisdn|mobile|number|tel)$/i;
const SHARE_RE = /^(share|hisa|asilimia|percent|percentage|%)$/i;
const KILO_RE = /^(kilos?|kg|weight)$/i;

export class RosterImportError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "RosterImportError";
    this.status = status;
  }
}

export type RosterFileBody = {
  csv_base64?: unknown;
  csv?: unknown;
  columns?: RosterColumnMap;
};

export type RosterApplyBody = {
  origin?: unknown;
  rows?: unknown;
};

type ParsedTable = {
  needs_mapping: boolean;
  headers: string[];
  delimiter: "," | ";" | "\t";
  rows: RosterImportRow[];
  total_share: number;
};

const appliedImports = new Map<string, RosterApplyResult>();

export function resetRosterImportCache(): void {
  appliedImports.clear();
}

export function decodeRosterBytes(input: Uint8Array): string {
  if (input.byteLength > MAX_BYTES) {
    throw new RosterImportError("CSV is limited to 1 MB");
  }
  if (input.byteLength >= 2 && input[0] === 0xff && input[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(input).replace(/^\uFEFF/, "");
  }
  if (input.byteLength >= 2 && input[0] === 0xfe && input[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(input).replace(/^\uFEFF/, "");
  }
  const body =
    input.byteLength >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf
      ? input.subarray(3)
      : input;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
}

function textFromBody(body: RosterFileBody): string {
  if (typeof body.csv_base64 === "string" && body.csv_base64.trim()) {
    const buf = Buffer.from(body.csv_base64, "base64");
    if (buf.length === 0) throw new RosterImportError("CSV is empty");
    return decodeRosterBytes(buf);
  }
  if (typeof body.csv === "string") {
    if (Buffer.byteLength(body.csv, "utf8") > MAX_BYTES) throw new RosterImportError("CSV is limited to 1 MB");
    return body.csv.replace(/^\uFEFF/, "");
  }
  throw new RosterImportError("Send the CSV file");
}

function sniffDelimiter(text: string): "," | ";" | "\t" {
  const record = firstRecord(text);
  const score = (delimiter: string) => {
    let quoted = false;
    let count = 0;
    for (let i = 0; i < record.length; i++) {
      const ch = record[i];
      if (ch === '"') {
        if (quoted && record[i + 1] === '"') {
          i++;
          continue;
        }
        quoted = !quoted;
      } else if (!quoted && ch === delimiter) count++;
    }
    return count;
  };
  const comma = score(",");
  const semi = score(";");
  const tab = score("\t");
  if (semi > comma && semi >= tab) return ";";
  if (tab > comma && tab > semi) return "\t";
  return ",";
}

function firstRecord(text: string): string {
  let quoted = false;
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        out += '""';
        i++;
        continue;
      }
      quoted = !quoted;
      out += ch;
      continue;
    }
    if (!quoted && (ch === "\n" || ch === "\r")) break;
    out += ch;
  }
  return out;
}

function parseRecords(text: string, delimiter: "," | ";" | "\t"): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let quoted = false;
  const pushRow = () => {
    row.push(cur.trim());
    cur = "";
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cur.trim());
      cur = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      pushRow();
    } else cur += ch;
  }
  if (cur.length > 0 || row.length > 0) pushRow();
  return rows;
}

function looksLikeHeader(cells: string[]): boolean {
  return cells.some((cell) => NAME_RE.test(cell) || PHONE_RE.test(cell) || SHARE_RE.test(cell) || KILO_RE.test(cell));
}

function columnIndex(headers: string[], re: RegExp): number {
  return headers.findIndex((cell) => re.test(cell));
}

function resolveColumns(
  headers: string[],
  headerRow: boolean,
  columns: RosterColumnMap | undefined
): { name: number; phone: number; share: number; kilos: number } | null {
  if (columns && Number.isInteger(columns.name) && columns.name >= 0 && Number.isInteger(columns.phone) && columns.phone >= 0) {
    return {
      name: columns.name,
      phone: columns.phone,
      share: Number.isInteger(columns.share) && (columns.share as number) >= 0 ? (columns.share as number) : -1,
      kilos: Number.isInteger(columns.kilos) && (columns.kilos as number) >= 0 ? (columns.kilos as number) : -1,
    };
  }
  if (!headerRow) return { name: 0, phone: 1, share: 2, kilos: 3 };
  const name = columnIndex(headers, NAME_RE);
  const phone = columnIndex(headers, PHONE_RE);
  if (name < 0 || phone < 0) return null;
  return { name, phone, share: columnIndex(headers, SHARE_RE), kilos: columnIndex(headers, KILO_RE) };
}

function parseShareText(raw: string): { blank: true } | { ok: true; share: number } | { ok: false } {
  const trimmed = raw.trim().replace(/%/g, "").replace(/\s/g, "");
  if (!trimmed) return { blank: true };
  const normalized = trimmed.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { ok: false };
  const [whole, frac = ""] = normalized.split(".");
  const digits = (frac + "000").slice(0, 3);
  const roundUp = frac.length > 3 && frac[3]! >= "5";
  let millis = Number(whole) * 1000 + Number(digits);
  if (roundUp) millis += 1;
  if (!Number.isSafeInteger(millis) || millis > 100_000) return { ok: false };
  return { ok: true, share: millis / 1000 };
}

function parseKilosText(raw: string | undefined): { absent: true } | { ok: true; kilos: number } | { ok: false } {
  if (raw === undefined || raw.trim() === "") return { absent: true };
  const normalized = raw.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return { ok: false };
  const kilos = Number(normalized);
  if (!Number.isFinite(kilos) || kilos < 0) return { ok: false };
  return { ok: true, kilos };
}

function classifyPhone(raw: string): { ok: true; phone: string } | { ok: false; error: string } {
  const trimmed = raw.trim();
  if (/[eE][+\-]?\d/.test(trimmed) && /\d\.\d/.test(trimmed)) {
    return { ok: false, error: "Phone looks like a number Excel shortened. Format the phone column as text." };
  }
  const phone = normalizePhone(trimmed);
  if (!isKenyanPhone(phone)) return { ok: false, error: "Phone isn't a Kenyan phone number" };
  return { ok: true, phone };
}

export function parseRosterCsv(text: string, columns?: RosterColumnMap): ParsedTable {
  const delimiter = sniffDelimiter(text);
  const records = parseRecords(text, delimiter);
  if (records.length === 0) throw new RosterImportError("CSV has no farmers");
  const headerRow = looksLikeHeader(records[0] ?? []);
  const headers = headerRow ? (records[0] ?? []) : [];
  const mapped = resolveColumns(headers, headerRow, columns);
  if (!mapped) {
    return { needs_mapping: true, headers, delimiter, rows: [], total_share: 0 };
  }
  const data = headerRow ? records.slice(1) : records;
  if (data.length === 0) throw new RosterImportError("CSV has no farmers");
  if (data.length > MAX_ROWS) throw new RosterImportError("CSV is limited to 5000 farmers");

  const seen = new Set<string>();
  let totalMillis = 0;
  const rows: RosterImportRow[] = data.map((cells, index) => {
    const line = headerRow ? index + 2 : index + 1;
    const name = (cells[mapped.name] ?? "").trim().slice(0, 80);
    const phoneRaw = cells[mapped.phone] ?? "";
    const shareRaw = mapped.share >= 0 ? (cells[mapped.share] ?? "") : "";
    const kilosRaw = mapped.kilos >= 0 ? cells[mapped.kilos] : undefined;
    const shareParsed = parseShareText(shareRaw);
    const kilosParsed = parseKilosText(kilosRaw);
    const phoneParsed = classifyPhone(phoneRaw);

    let error: string | undefined;
    let phone = phoneParsed.ok ? phoneParsed.phone : phoneRaw.trim();
    let share = 0;
    if (name.length < 2) error = "Missing name";
    else if (!phoneParsed.ok) error = phoneParsed.error;
    else if ("blank" in shareParsed) {
      if ("absent" in kilosParsed) error = "Share must be 0–100";
      else if (!kilosParsed.ok) error = "Kilos must be a number";
      else share = 0;
    } else if (!shareParsed.ok) error = "Share must be 0–100";
    else if (!("absent" in kilosParsed) && !kilosParsed.ok) error = "Kilos must be a number";
    else if (seen.has(phoneParsed.phone)) error = "Duplicate phone in file";
    else share = shareParsed.share;

    if (!error && phoneParsed.ok) seen.add(phoneParsed.phone);
    if (!error && "ok" in shareParsed && shareParsed.ok) totalMillis += Math.round(shareParsed.share * 1000);
    if (!error && "blank" in shareParsed) {
      /* share stored as 0 when kilos carry the row */
    }

    const row: RosterImportRow = { line, name, phone, share };
    if ("ok" in kilosParsed && kilosParsed.ok) row.kilos = kilosParsed.kilos;
    if (error) row.error = error;
    return row;
  });

  return {
    needs_mapping: false,
    headers,
    delimiter,
    rows,
    total_share: totalMillis / 1000,
  };
}

async function annotate(coopId: string, rows: RosterImportRow[]): Promise<RosterImportRow[]> {
  const members = await store.getCoopMembers(coopId);
  const memberIds = new Set(members.map((member) => member.account_id));
  const annotated: RosterImportRow[] = [];
  for (const row of rows) {
    if (row.error) {
      annotated.push(row);
      continue;
    }
    const account = await store.getAccountByPhone(row.phone);
    if (!account) {
      annotated.push({ ...row, status: "invite", account_id: null, full_name: null });
      continue;
    }
    if (account.coop_id && account.coop_id !== coopId) {
      annotated.push({
        ...row,
        status: "other_coop",
        account_id: account.id,
        full_name: account.full_name,
        error: "Already in another co-op",
      });
      continue;
    }
    annotated.push({
      ...row,
      status: memberIds.has(account.id) ? "update" : "add",
      account_id: account.id,
      full_name: account.full_name,
    });
  }
  return annotated;
}

export async function previewRosterImport(coopId: string, body: RosterFileBody): Promise<RosterPreview> {
  const coop = await store.getCoop(coopId);
  if (!coop) throw new RosterImportError("Co-op not found", 404);
  const parsed = parseRosterCsv(textFromBody(body), body.columns);
  if (parsed.needs_mapping) return parsed;
  return { ...parsed, rows: await annotate(coopId, parsed.rows) };
}

function cleanOrigin(origin: unknown): string {
  if (typeof origin !== "string") throw new RosterImportError("Origin is required so invite links open this app");
  const trimmed = origin.trim().replace(/\/$/, "");
  if (!/^https?:\/\/[^\s/]+(?::\d+)?$/i.test(trimmed) || trimmed.length > 200) {
    throw new RosterImportError("Origin is required so invite links open this app");
  }
  return trimmed;
}

function fieldsFromApplyRow(raw: unknown, line: number): RosterImportRow {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const name = typeof record.name === "string" ? record.name : "";
  const phone = typeof record.phone === "string" ? record.phone : "";
  const share = record.share === undefined || record.share === null ? "" : String(record.share);
  const kilos =
    record.kilos === undefined || record.kilos === null || record.kilos === "" ? undefined : String(record.kilos);
  const parsed = parseRosterCsv(
    ["name,phone,share,kilos", [name, phone, share, kilos ?? ""].map(csvCell).join(",")].join("\n")
  );
  const row = parsed.rows[0];
  if (!row) return { line, name: name.trim(), phone: phone.trim(), share: 0, error: "Missing name" };
  return { ...row, line };
}

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export async function applyRosterImport(
  coopId: string,
  body: RosterApplyBody,
  idempotencyKey: string | undefined
): Promise<RosterApplyResult> {
  const coop = await store.getCoop(coopId);
  if (!coop) throw new RosterImportError("Co-op not found", 404);
  const origin = cleanOrigin(body.origin);
  const key = idempotencyKey?.trim();
  const cacheKey = key ? `${coopId}:${key}` : "";
  if (cacheKey && appliedImports.has(cacheKey)) return appliedImports.get(cacheKey)!;

  if (!Array.isArray(body.rows) || body.rows.length === 0) throw new RosterImportError("CSV has no farmers");
  if (body.rows.length > MAX_ROWS) throw new RosterImportError("CSV is limited to 5000 farmers");

  const validated = body.rows.map((raw, index) => fieldsFromApplyRow(raw, index + 1));
  const seen = new Set<string>();
  for (const row of validated) {
    if (row.error || !row.phone) continue;
    if (seen.has(row.phone)) row.error = "Duplicate phone in file";
    else seen.add(row.phone);
  }
  const planned = await annotate(coopId, validated);

  const result: RosterApplyResult = { added: [], updated: [], invites: [], failed: [] };
  const members = await store.getCoopMembers(coopId);
  for (const row of planned) {
    if (row.error || row.status === "other_coop") {
      result.failed.push({ name: row.name || `Row ${row.line}`, reason: row.error || "Already in another co-op" });
      continue;
    }
    try {
      if (row.status === "update" && row.account_id) {
        const existing = members.find((member) => member.account_id === row.account_id);
        if (!existing) {
          result.failed.push({ name: row.name, reason: "Member not found" });
          continue;
        }
        const updated = {
          ...existing,
          contribution_share: row.share,
          kilos: row.kilos !== undefined ? row.kilos : existing.kilos,
        };
        await store.addCoopMember(updated);
        const index = members.findIndex((member) => member.account_id === row.account_id);
        if (index >= 0) members[index] = updated;
        result.updated.push(row.name);
      } else if (row.status === "add" && row.account_id) {
        const account = await store.getAccount(row.account_id);
        if (!account) {
          result.failed.push({ name: row.name, reason: "Account does not exist" });
          continue;
        }
        if (account.coop_id && account.coop_id !== coopId) {
          result.failed.push({ name: row.name, reason: "Already in another co-op" });
          continue;
        }
        account.coop_id = coopId;
        await store.saveAccount(account);
        const member = {
          coop_id: coopId,
          account_id: account.id,
          full_name: account.full_name,
          contribution_share: row.share,
          kilos: row.kilos,
        };
        await store.addCoopMember(member);
        members.push(member);
        result.added.push(row.name);
      } else {
        const params = new URLSearchParams({
          coop: coop.name,
          share: String(row.share),
          phone: row.phone,
          name: row.name,
        });
        result.invites.push({ name: row.name, phone: row.phone, share: row.share, url: `${origin}/onboarding?${params.toString()}` });
      }
    } catch (err) {
      result.failed.push({ name: row.name || `Row ${row.line}`, reason: err instanceof Error ? err.message : "Couldn't save" });
    }
  }

  if (cacheKey) {
    if (appliedImports.size > 200) {
      const oldest = appliedImports.keys().next().value;
      if (oldest) appliedImports.delete(oldest);
    }
    appliedImports.set(cacheKey, result);
  }
  return result;
}
