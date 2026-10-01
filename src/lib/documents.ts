import { downloadCsv } from "@/lib/csv";
import { formatCurrency, formatDate, formatKesCents } from "@/lib/format";
import type { InvoiceStatus, PaymentReceipt } from "@/lib/types";

export const PAID_INVOICE_STATUSES: InvoiceStatus[] = ["paid", "converting", "settling", "completed"];

export function isPaidInvoice(status: InvoiceStatus): boolean {
  return PAID_INVOICE_STATUSES.includes(status);
}

/** Shillings with two decimals, for a spreadsheet. Empty when the receipt has no KES figure yet. */
export function kesShillings(cents: number | null): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

export const BOOKS_CSV_HEAD = [
  "date",
  "receipt number",
  "buyer",
  "currency amount",
  "currency",
  "FX rate",
  "gross KES",
  "fee KES",
  "net KES",
  "Payaza reference",
  "status",
] as const;

export function booksCsvRow(receipt: PaymentReceipt): string[] {
  return [
    receipt.paid_at.slice(0, 10),
    receipt.receipt_number,
    receipt.buyer_name,
    receipt.amount.toFixed(2),
    receipt.currency,
    receipt.fx_rate != null ? receipt.fx_rate.toFixed(4) : "",
    kesShillings(receipt.gross_kes_cents),
    kesShillings(receipt.fee_kes_cents),
    kesShillings(receipt.net_kes_cents),
    receipt.payaza_reference || receipt.invoice_reference,
    receipt.status,
  ];
}

export function downloadPaidInvoicesCsv(receipts: PaymentReceipt[]) {
  const sorted = [...receipts].sort((a, b) => a.paid_at.localeCompare(b.paid_at));
  downloadCsv("stawi-paid-invoices.csv", [[...BOOKS_CSV_HEAD], ...sorted.map(booksCsvRow)]);
}

function receiptRows(receipt: PaymentReceipt): Array<[string, string]> {
  return [
    ["Receipt", receipt.receipt_number],
    ["Paid", formatDate(receipt.paid_at)],
    ["From", `${receipt.buyer_name} (${receipt.buyer_email})`],
    ["To", receipt.payee_name],
    ["For", receipt.description],
    ["Amount", formatCurrency(receipt.amount, receipt.currency)],
    ["Rate", receipt.fx_rate != null ? `1 ${receipt.currency} = KES ${receipt.fx_rate.toFixed(2)}` : "—"],
    ["Gross in shillings", receipt.gross_kes_cents != null ? formatKesCents(receipt.gross_kes_cents) : "—"],
    ["Stawi fee (0.8%)", receipt.fee_kes_cents != null ? formatKesCents(receipt.fee_kes_cents) : "—"],
    ["To the seller", receipt.net_kes_cents != null ? formatKesCents(receipt.net_kes_cents) : "—"],
    ["Payment reference", receipt.payaza_reference || receipt.invoice_reference],
  ];
}

export async function downloadPaymentReceiptPdf(receipt: PaymentReceipt) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  doc.setFontSize(18);
  doc.text("Stawi payment receipt", 40, 52);
  doc.setFontSize(11);
  doc.text(receipt.receipt_number, 40, 72);
  autoTable(doc, {
    startY: 92,
    body: receiptRows(receipt),
    styles: { fontSize: 11, cellPadding: 6 },
    columnStyles: { 0: { cellWidth: 160, textColor: [80, 80, 80] } },
    margin: { left: 40, right: 40 },
    theme: "plain",
  });
  doc.save(`${receipt.receipt_number}.pdf`);
}

export type PayoutAdviceLine = {
  farmer: string;
  share: number;
  grossKesCents: number;
  feeKesCents: number;
  netKesCents: number;
  status: string;
  date: string;
};

export const ADVICE_CSV_HEAD = ["farmer", "share", "gross KES", "fee KES", "net KES", "payout status", "date"] as const;

export function downloadPayoutAdviceCsv(reference: string, lines: PayoutAdviceLine[]) {
  downloadCsv(`payout-advice-${reference}.csv`, [
    [...ADVICE_CSV_HEAD],
    ...lines.map((line) => [
      line.farmer,
      line.share,
      kesShillings(line.grossKesCents),
      kesShillings(line.feeKesCents),
      kesShillings(line.netKesCents),
      line.status,
      line.date,
    ]),
  ]);
}

export async function downloadPayoutAdvicePdf(input: {
  reference: string;
  buyerName: string;
  lines: PayoutAdviceLine[];
}) {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  doc.setFontSize(18);
  doc.text("Payout advice", 40, 52);
  doc.setFontSize(11);
  doc.text(`${input.reference} · ${input.buyerName}`, 40, 72);
  autoTable(doc, {
    startY: 96,
    head: [[...ADVICE_CSV_HEAD]],
    body: input.lines.map((line) => [
      line.farmer,
      `${line.share}%`,
      kesShillings(line.grossKesCents),
      kesShillings(line.feeKesCents),
      kesShillings(line.netKesCents),
      line.status,
      line.date,
    ]),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [31, 58, 44] },
    margin: { left: 40, right: 40 },
  });
  doc.save(`payout-advice-${input.reference}.pdf`);
}
