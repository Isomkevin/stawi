export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const escape = (v: string | number) => {
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    if (/[",\r\n]/.test(s)) s = `"${s.replaceAll('"', '""')}"`;
    return s;
  };
  const body = rows.map((r) => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const MEMBER_TEMPLATE: Array<Array<string | number>> = [
  ["name", "phone", "share", "kilos"],
  ["Amina Wanjiku", "0712345678", 10, 120],
];

/** Normalises Kenyan numbers (07…, 7…, 2547…, +2547…) to +2547XXXXXXXX. */
export function normalizeKePhone(raw: string): string {
  const d = raw.replace(/[^\d+]/g, "");
  if (/^\+254\d{9}$/.test(d)) return d;
  if (/^254\d{9}$/.test(d)) return `+${d}`;
  if (/^0\d{9}$/.test(d)) return `+254${d.slice(1)}`;
  if (/^[17]\d{8}$/.test(d)) return `+254${d}`;
  return raw.trim();
}

const MAX_BYTES = 1_000_000;
const MAX_ROWS = 5_000;
const NAME_RE = /^(name|jina|farmer|full[ _-]?name|member)$/i;
const PHONE_RE = /^(phone|simu|nambari|msisdn|mobile|number|tel)$/i;
const SHARE_RE = /^(share|hisa|asilimia|percent|percentage|%)$/i;
const KILO_RE = /^(kilos?|kg|weight)$/i;

export type RosterColumnMap = { name: number; phone: number; share?: number; kilos?: number };

export type ParsedRosterRow = {
  line: number;
  name: string;
  phone: string;
  share: number;
  kilos?: number;
  error?: string;
};

export type ParsedRoster = {
  needs_mapping: boolean;
  headers: string[];
  delimiter: "," | ";" | "\t";
  rows: ParsedRosterRow[];
  total_share: number;
};

export function decodeRosterBytes(input: Uint8Array): string {
  if (input.byteLength > MAX_BYTES) throw new Error("CSV is limited to 1 MB");
  if (input.byteLength >= 2 && input[0] === 0xff && input[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(input).replace(/^\uFEFF/, "");
  }
  if (input.byteLength >= 2 && input[0] === 0xfe && input[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(input).replace(/^\uFEFF/, "");
  }
  const body =
    input.byteLength >= 3 && input[0] === 0xef && input[1] === 0xbb && input[2] === 0xbf ? input.subarray(3) : input;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return new TextDecoder("windows-1252").decode(body);
  }
}

export function decodeRosterBase64(csvBase64: string): string {
  const binary = atob(csvBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decodeRosterBytes(bytes);
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

function resolveColumns(headers: string[], headerRow: boolean, columns: RosterColumnMap | undefined) {
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

function normalizePhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, "");
  if (cleaned.startsWith("0")) return `+254${cleaned.substring(1)}`;
  if (cleaned.startsWith("254")) return `+${cleaned}`;
  if (!cleaned.startsWith("+")) return `+${cleaned}`;
  return cleaned;
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
  if (!/^\+254\d{9}$/.test(phone)) return { ok: false, error: "Phone isn't a Kenyan phone number" };
  return { ok: true, phone };
}

/** Same roster rules as the backend importer. Mock mode uses this; live mode asks the server. */
export function parseRosterCsv(text: string, columns?: RosterColumnMap): ParsedRoster {
  if (new TextEncoder().encode(text).byteLength > MAX_BYTES) throw new Error("CSV is limited to 1 MB");
  const clean = text.replace(/^\uFEFF/, "");
  const delimiter = sniffDelimiter(clean);
  const records = parseRecords(clean, delimiter);
  if (records.length === 0) throw new Error("CSV has no farmers");
  const headerRow = looksLikeHeader(records[0] ?? []);
  const headers = headerRow ? (records[0] ?? []) : [];
  const mapped = resolveColumns(headers, headerRow, columns);
  if (!mapped) return { needs_mapping: true, headers, delimiter, rows: [], total_share: 0 };
  const data = headerRow ? records.slice(1) : records;
  if (data.length === 0) throw new Error("CSV has no farmers");
  if (data.length > MAX_ROWS) throw new Error("CSV is limited to 5000 farmers");

  const seen = new Set<string>();
  let totalMillis = 0;
  const rows: ParsedRosterRow[] = data.map((cells, index) => {
    const line = headerRow ? index + 2 : index + 1;
    const name = (cells[mapped.name] ?? "").trim().slice(0, 80);
    const phoneRaw = cells[mapped.phone] ?? "";
    const shareRaw = mapped.share >= 0 ? (cells[mapped.share] ?? "") : "";
    const kilosRaw = mapped.kilos >= 0 ? cells[mapped.kilos] : undefined;
    const shareParsed = parseShareText(shareRaw);
    const kilosParsed = parseKilosText(kilosRaw);
    const phoneParsed = classifyPhone(phoneRaw);
    let error: string | undefined;
    const phone = phoneParsed.ok ? phoneParsed.phone : phoneRaw.trim();
    let share = 0;
    if (name.length < 2) error = "Missing name";
    else if (!phoneParsed.ok) error = phoneParsed.error;
    else if ("blank" in shareParsed) {
      if ("absent" in kilosParsed) error = "Share must be 0–100";
      else if (!kilosParsed.ok) error = "Kilos must be a number";
    } else if (!shareParsed.ok) error = "Share must be 0–100";
    else if (!("absent" in kilosParsed) && !kilosParsed.ok) error = "Kilos must be a number";
    else if (seen.has(phoneParsed.phone)) error = "Duplicate phone in file";
    else share = shareParsed.share;
    if (!error && phoneParsed.ok) seen.add(phoneParsed.phone);
    if (!error && "ok" in shareParsed && shareParsed.ok) totalMillis += Math.round(shareParsed.share * 1000);
    const row: ParsedRosterRow = { line, name, phone, share };
    if ("ok" in kilosParsed && kilosParsed.ok) row.kilos = kilosParsed.kilos;
    if (error) row.error = error;
    return row;
  });
  return { needs_mapping: false, headers, delimiter, rows, total_share: totalMillis / 1000 };
}

export function rowsToRosterCsv(rows: Array<{ name: string; phone: string; share: number; kilos?: number | undefined }>): string {
  const escape = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const lines = ["name,phone,share,kilos"];
  for (const row of rows) {
    lines.push([row.name, row.phone, String(row.share), row.kilos === undefined ? "" : String(row.kilos)].map(escape).join(","));
  }
  return lines.join("\n");
}
