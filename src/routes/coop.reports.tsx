import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Download, FileText, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/features/shared/DashboardShell";
import { downloadCsv } from "@/lib/csv";
import { formatDate, formatKesCents } from "@/lib/format";
import { accountName } from "@/lib/mock";
import { coopMembersOptions, coopOptions, coopPayoutsOptions, invoicesOptions } from "@/lib/queries";
import { useCoopId } from "@/lib/session";
import type { Invoice, Payout } from "@/lib/types";

export const Route = createFileRoute("/coop/reports")({
  head: () => ({
    meta: [
      { title: "Reports & tax — Stawi co-op" },
      { name: "description", content: "Income statement, farmer payout register, FX ledger and tax summary for your co-op, in CSV or PDF." },
      { property: "og:title", content: "Reports & tax — Stawi co-op" },
      { property: "og:description", content: "Co-op income, farmer payouts, FX and tax reports." },
    ],
  }),
  component: Reports,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAID: Invoice["status"][] = ["paid", "converting", "settling", "completed"];
const kes = (c: number) => (c / 100).toFixed(2);
/** Rate in percent applied to integer cents, rounded half-up to a whole cent. */
const pct = (cents: number, rate: number) => Math.round((cents * rate) / 100);

type Period = "year" | "q1" | "q2" | "q3" | "q4" | `m${number}`;

function inPeriod(iso: string, year: number, period: Period) {
  const d = new Date(iso);
  if (d.getFullYear() !== year) return false;
  const m = d.getMonth();
  if (period === "year") return true;
  if (period.startsWith("q")) return Math.floor(m / 3) === Number(period[1]) - 1;
  return m === Number(period.slice(1));
}

function periodLabel(year: number, p: Period) {
  if (p === "year") return `Year ${year}`;
  if (p.startsWith("q")) return `${p.toUpperCase()} ${year}`;
  return `${MONTHS[Number(p.slice(1))]} ${year}`;
}

function Reports() {
  const coopId = useCoopId();
  const coop = useQuery(coopOptions(coopId));
  const invoices = useQuery(invoicesOptions({ coop_id: coopId }));
  const payouts = useQuery(coopPayoutsOptions(coopId));
  const members = useQuery(coopMembersOptions(coopId));

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [period, setPeriod] = useState<Period>("year");
  const [whtRate, setWhtRate] = useState("2");
  const [vatRate, setVatRate] = useState("16");
  const [cessRate, setCessRate] = useState("0");

  const nameOf = (id: string) => members.data?.find((m) => m.account_id === id)?.full_name ?? accountName(id);

  const r = useMemo(() => {
    const wht = Number(whtRate) || 0;
    const vat = Number(vatRate) || 0;
    const cess = Number(cessRate) || 0;
    const inv = (invoices.data ?? []).filter((i) => PAID.includes(i.status) && inPeriod(i.created_at, year, period));
    const credits = (payouts.data ?? []).filter((p: Payout) => p.kind === "credit" && p.status !== "failed" && inPeriod(p.created_at, year, period));

    const ledger = inv.map((i) => {
      const fee = i.fee_kes_cents ?? 0;
      const net = i.kes_total_cents ?? 0;
      return { i, fee, net, gross: net + fee };
    });
    const monthly = new Map<string, { gross: number; fee: number; net: number; paid: number; count: number }>();
    for (const l of ledger) {
      const d = new Date(l.i.created_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const row = monthly.get(k) ?? { gross: 0, fee: 0, net: 0, paid: 0, count: 0 };
      row.gross += l.gross; row.fee += l.fee; row.net += l.net; row.count += 1;
      monthly.set(k, row);
    }
    for (const c of credits) {
      const d = new Date(c.created_at);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const row = monthly.get(k) ?? { gross: 0, fee: 0, net: 0, paid: 0, count: 0 };
      row.paid += c.amount_kes_cents;
      monthly.set(k, row);
    }
    const farmers = new Map<string, { gross: number; count: number }>();
    for (const c of credits) {
      const f = farmers.get(c.account_id) ?? { gross: 0, count: 0 };
      f.gross += c.amount_kes_cents; f.count += 1;
      farmers.set(c.account_id, f);
    }
    const register = [...farmers.entries()]
      .map(([id, f]) => ({ id, name: nameOf(id), ...f, wht: pct(f.gross, wht), cess: pct(f.gross, cess) }))
      .map((f) => ({ ...f, net: f.gross - f.wht - f.cess }))
      .sort((a, b) => b.gross - a.gross);

    const t = {
      gross: ledger.reduce((s, l) => s + l.gross, 0),
      fee: ledger.reduce((s, l) => s + l.fee, 0),
      net: ledger.reduce((s, l) => s + l.net, 0),
      paid: credits.reduce((s, c) => s + c.amount_kes_cents, 0),
      wht: register.reduce((s, f) => s + f.wht, 0),
      cess: register.reduce((s, f) => s + f.cess, 0),
    };
    const inputVat = Math.round((t.fee * vat) / (100 + vat));
    const tax = [
      { item: "Export sales (VAT zero-rated)", basis: t.gross, amount: 0, note: "Exports are zero-rated for VAT. Declare them on the monthly VAT return if the co-op is VAT-registered." },
      { item: `Input VAT inside Stawi fees (${vat}%)`, basis: t.fee, amount: inputVat, note: "VAT included in conversion fees. Claimable against output VAT if registered and you hold a valid tax invoice." },
      { item: `Withholding tax on farmer produce payments (${wht}%)`, basis: t.paid, amount: t.wht, note: "Deduct from farmer payments and remit to KRA by the 20th of the following month. Issue WHT certificates to farmers." },
      { item: `County produce cess (${cess}%)`, basis: t.paid, amount: t.cess, note: "Set the rate your county charges. Leave at 0 if not applicable." },
      { item: "Retained co-op margin", basis: t.net - t.paid, amount: 0, note: "Money collected but not yet split to farmers. Surplus from non-member dealings may be taxable income." },
    ];
    return { ledger, monthly: [...monthly.entries()].sort(), register, t, tax };
  }, [invoices.data, payouts.data, members.data, year, period, whtRate, vatRate, cessRate]); // eslint-disable-line react-hooks/exhaustive-deps

  const live = useMemo(() => {
    const inv = (invoices.data ?? []).filter(
      (i) => i.is_demo !== true && PAID.includes(i.status) && inPeriod(i.created_at, year, period),
    );
    const credits = (payouts.data ?? []).filter(
      (p: Payout) => p.kind === "credit" && p.is_demo !== true && inPeriod(p.created_at, year, period),
    );
    const net = inv.reduce((s, i) => s + (i.kes_total_cents ?? 0), 0);
    const sent = credits
      .filter((p) => p.status === "sent" || p.status === "confirmed")
      .reduce((s, p) => s + p.amount_kes_cents, 0);
    const unapproved = inv
      .filter((i) => !i.split_approved)
      .reduce((s, i) => s + (i.kes_total_cents ?? 0), 0);
    const stuck = credits
      .filter((p) => p.status === "pending" || p.status === "failed")
      .reduce((s, p) => s + p.amount_kes_cents, 0);
    return { inBank: net - sent, owed: unapproved + stuck };
  }, [invoices.data, payouts.data, year, period]);

  const label = periodLabel(year, period);
  const slug = label.replaceAll(" ", "-").toLowerCase();
  const coopName = coop.data?.name ?? "Co-op";

  const tables = {
    income: {
      title: "Income statement",
      head: ["Month", "Invoices", "Gross collected (KES)", "Stawi fees (KES)", "Net received (KES)", "Paid to farmers (KES)"],
      body: [
        ...r.monthly.map(([k, m]) => [k, String(m.count), kes(m.gross), kes(m.fee), kes(m.net), kes(m.paid)]),
        ["Total", String(r.ledger.length), kes(r.t.gross), kes(r.t.fee), kes(r.t.net), kes(r.t.paid)],
      ],
    },
    register: {
      title: "Farmer payout register",
      head: ["Farmer", "Account", "Payouts", "Gross paid (KES)", "WHT (KES)", "Cess (KES)", "Net of deductions (KES)"],
      body: [
        ...r.register.map((f) => [f.name, f.id, String(f.count), kes(f.gross), kes(f.wht), kes(f.cess), kes(f.net)]),
        ["Total", "", "", kes(r.t.paid), kes(r.t.wht), kes(r.t.cess), kes(r.t.paid - r.t.wht - r.t.cess)],
      ],
    },
    ledger: {
      title: "Invoice & FX ledger",
      head: ["Date", "Invoice", "Buyer", "Amount", "Currency", "FX rate", "Gross KES", "Fee KES", "Net KES", "Status"],
      body: r.ledger.map((l) => [
        l.i.created_at.slice(0, 10), l.i.reference, l.i.buyer_name, l.i.amount.toFixed(2), l.i.currency,
        l.i.fx_rate ? l.i.fx_rate.toFixed(4) : "", kes(l.gross), kes(l.fee), kes(l.net), l.i.status,
      ]),
    },
    tax: {
      title: "Tax summary",
      head: ["Item", "Basis (KES)", "Tax (KES)", "Notes"],
      body: r.tax.map((x) => [x.item, kes(x.basis), kes(x.amount), x.note]),
    },
  };

  const csv = (k: keyof typeof tables) => downloadCsv(`stawi-${k}-${slug}.csv`, [tables[k].head, ...tables[k].body]);

  const pdf = async () => {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    doc.setFontSize(18);
    doc.text(`${coopName} — Financial & tax report`, 40, 50);
    doc.setFontSize(10);
    doc.text(`${label} · generated ${new Date().toLocaleString("en-KE")} · amounts in KES`, 40, 68);
    doc.text(`Rates used: WHT ${whtRate}%, VAT ${vatRate}%, cess ${cessRate}%. Confirm rates with KRA or your tax adviser before filing.`, 40, 82);
    let y = 100;
    for (const k of ["income", "tax", "register", "ledger"] as const) {
      const tb = tables[k];
      doc.setFontSize(13);
      doc.text(tb.title, 40, y + 14);
      autoTable(doc, {
        startY: y + 22,
        head: [tb.head],
        body: tb.body.length ? tb.body : [["No records in this period"]],
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [31, 58, 44] },
        margin: { left: 40, right: 40 },
        ...(k === "tax" ? { columnStyles: { 3: { cellWidth: 330 } } } : {}),
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
      if (y > 480) { doc.addPage(); y = 40; }
    }
    doc.save(`stawi-report-${slug}.pdf`);
  };

  const loading = invoices.isLoading || payouts.isLoading;
  const years = Array.from({ length: 4 }, (_, i) => now.getFullYear() - i);

  return (
    <div>
      <PageHeader
        title="Reports & tax"
        description="Everything the co-op needs for accounts, KRA filing and member statements."
        action={<Button className="h-11" onClick={() => void pdf()} disabled={loading}><FileText className="size-4" /> Download PDF</Button>}
      />

      <div className="mb-5 grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-5">
        <div className="space-y-1.5">
          <Label>Year</Label>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Period</Label>
          <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="year">Full year</SelectItem>
              {["q1", "q2", "q3", "q4"].map((q) => <SelectItem key={q} value={q}>{q.toUpperCase()}</SelectItem>)}
              {MONTHS.map((m, i) => <SelectItem key={m} value={`m${i}`}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <RateInput id="wht" label="Withholding tax %" value={whtRate} onChange={setWhtRate} />
        <RateInput id="vat" label="VAT %" value={vatRate} onChange={setVatRate} />
        <RateInput id="cess" label="County cess %" value={cessRate} onChange={setCessRate} />
      </div>

      {loading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <>
          <div className="mb-3 grid gap-3 sm:grid-cols-2">
            <Kpi label="In the co-op's bank" value={live.inBank} />
            <Kpi label="Owed to farmers" value={live.owed} />
          </div>
          <p className="mb-5 text-xs text-muted-foreground">
            These two figures are live money in {label}. The tables below follow this report’s rows, including sample invoices when Demo data is on.
          </p>

          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label="Gross collected" value={r.t.gross} />
            <Kpi label="Paid to farmers" value={r.t.paid} />
            <Kpi label="Withholding tax due" value={r.t.wht} />
            <Kpi label="Stawi fees" value={r.t.fee} />
          </div>

          <Tabs defaultValue="tax">
            <TabsList className="flex h-auto flex-wrap">
              <TabsTrigger value="tax">Tax summary</TabsTrigger>
              <TabsTrigger value="income">Income statement</TabsTrigger>
              <TabsTrigger value="register">Farmer register</TabsTrigger>
              <TabsTrigger value="ledger">Invoice & FX ledger</TabsTrigger>
            </TabsList>
            {(Object.keys(tables) as Array<keyof typeof tables>).map((k) => (
              <TabsContent key={k} value={k} className="mt-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">{tables[k].title} · {label}</p>
                  <Button variant="outline" size="sm" onClick={() => csv(k)}><Download className="size-4" /> CSV</Button>
                </div>
                <div className="overflow-x-auto rounded-2xl border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="bg-secondary/60 text-left text-xs text-muted-foreground uppercase">
                      <tr>{tables[k].head.map((h) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h.replace(" (KES)", "")}</th>)}</tr>
                    </thead>
                    <tbody className="tabular">
                      {tables[k].body.length === 0 ? (
                        <tr><td colSpan={tables[k].head.length} className="px-3 py-6 text-center text-muted-foreground">No records in this period.</td></tr>
                      ) : (
                        tables[k].body.map((row, i) => (
                          <tr key={i} className={`border-t border-border ${row[0] === "Total" ? "font-medium" : ""}`}>
                            {row.map((c, j) => <td key={j} className={`px-3 py-2 ${k === "tax" && j === 3 ? "min-w-72 text-muted-foreground" : "whitespace-nowrap"}`}>{c}</td>)}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </TabsContent>
            ))}
          </Tabs>

          <p className="mt-4 flex gap-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            Figures come from paid invoices and farmer payouts dated in {label}. Tax rates are editable; confirm them with KRA or your tax adviser before filing. Report generated {formatDate(new Date().toISOString())}.
          </p>
        </>
      )}
    </div>
  );
}

function RateInput({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} type="number" min="0" max="100" step="0.1" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground uppercase">{label}</p>
      <p className="text-display mt-1 text-xl tabular">{formatKesCents(value)}</p>
    </div>
  );
}
