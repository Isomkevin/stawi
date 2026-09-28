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

/** Parses "name,phone,share" lines. Header row optional. */
export function parseMembersCsv(text: string): Array<{ name: string; phone: string; share: number }> {
  return text
    .split(/\r?\n/)
    .map((l) => l.split(",").map((c) => c.trim()))
    .filter((c) => c.length >= 3 && !Number.isNaN(Number(c[2])))
    .map(([name = "", phone = "", share = "0"]) => ({ name, phone, share: Number(share) }));
}
