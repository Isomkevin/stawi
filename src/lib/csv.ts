export function downloadCsv(filename: string, rows: Array<Array<string | number>>) {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  const blob = new Blob([rows.map((r) => r.map(escape).join(",")).join("\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export type MemberCsvRow = {
  line: number;
  name: string;
  phone: string;
  share: number;
  kilos?: number | undefined;
  error?: string | undefined;
};

/** Normalises Kenyan numbers (07…, 7…, 2547…, +2547…) to +2547XXXXXXXX. */
export function normalizeKePhone(raw: string): string {
  const d = raw.replace(/[^\d+]/g, "");
  if (/^\+254\d{9}$/.test(d)) return d;
  if (/^254\d{9}$/.test(d)) return `+${d}`;
  if (/^0\d{9}$/.test(d)) return `+254${d.slice(1)}`;
  if (/^[17]\d{8}$/.test(d)) return `+254${d}`;
  return raw.trim();
}

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === "," || ch === ";" || ch === "\t") { out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/**
 * Parses a farmer roster. Columns: name, phone, share (%), kilos (optional).
 * A header row is detected and may list columns in any order.
 * Every row is returned; invalid rows carry an `error`.
 */
export function parseMembersCsv(text: string): MemberCsvRow[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((l, i) => ({ i: i + 1, cells: splitLine(l) }))
    .filter((l) => l.cells.some((c) => c));
  if (!lines.length) return [];
  let idx = { name: 0, phone: 1, share: 2, kilos: 3 };
  const head = lines[0]!.cells.map((c) => c.toLowerCase());
  if (head.some((h) => /name|phone|share|kilo/.test(h))) {
    const find = (re: RegExp, fb: number) => { const k = head.findIndex((h) => re.test(h)); return k === -1 ? fb : k; };
    idx = { name: find(/name/, 0), phone: find(/phone|mobile|msisdn|number/, 1), share: find(/share|%|percent/, 2), kilos: find(/kilo|kg|weight/, -1) };
    lines.shift();
  }
  const seen = new Set<string>();
  return lines.map(({ i, cells }) => {
    let name = cells[idx.name] ?? "";
    let phone = normalizeKePhone(cells[idx.phone] ?? "");
    const asPhone = normalizeKePhone(name);
    if (!/^\+254\d{9}$/.test(phone) && /^\+254\d{9}$/.test(asPhone)) { phone = asPhone; name = cells[idx.phone] ?? ""; }
    const shareRaw = (cells[idx.share] ?? "").replace("%", "");
    const share = Number(shareRaw);
    const kilosRaw = idx.kilos >= 0 ? cells[idx.kilos] : undefined;
    const kilos = kilosRaw ? Number(kilosRaw) : undefined;
    let error: string | undefined;
    if (name.length < 2) error = "Missing name";
    else if (!/^\+2547\d{8}$|^\+2541\d{8}$/.test(phone)) error = "Phone isn't a Kenyan mobile number";
    else if (!shareRaw || Number.isNaN(share) || share < 0 || share > 100) error = "Share must be 0–100";
    else if (kilos !== undefined && (Number.isNaN(kilos) || kilos < 0)) error = "Kilos must be a number";
    else if (seen.has(phone)) error = "Duplicate phone in file";
    seen.add(phone);
    return { line: i, name, phone, share, kilos, error };
  });
}
