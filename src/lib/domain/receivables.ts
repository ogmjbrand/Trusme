/** CollectIQ receivables calculations (pure, deterministic). */
export interface InvoiceLike {
  id: string;
  invoice_number: string;
  customer_id: string;
  customer_name?: string | null;
  status: "draft" | "issued" | "partially_paid" | "paid" | "void";
  currency: string;
  total_minor: number;
  amount_paid_minor: number;
  due_date: string; // YYYY-MM-DD
  issue_date?: string;
}

export type AgingBucket = "current" | "1-30" | "31-60" | "61-90" | "90+";
export const AGING_BUCKETS: AgingBucket[] = ["current", "1-30", "31-60", "61-90", "90+"];

const DAY = 86_400_000;

export function toDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / DAY);
}

export function outstanding(inv: Pick<InvoiceLike, "total_minor" | "amount_paid_minor" | "status">): number {
  if (inv.status === "void" || inv.status === "draft") return 0;
  return Math.max(inv.total_minor - inv.amount_paid_minor, 0);
}

export function daysOverdue(inv: Pick<InvoiceLike, "due_date">, today: string): number {
  return Math.max(daysBetween(inv.due_date, today), 0);
}

export function isOverdue(inv: InvoiceLike, today: string): boolean {
  return outstanding(inv) > 0 && daysBetween(inv.due_date, today) > 0;
}

export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export interface AgingRow {
  currency: string;
  buckets: Record<AgingBucket, number>;
  total: number;
  invoiceCount: number;
}

/** Aging report grouped by currency (never mixes currencies). */
export function agingReport(invoices: InvoiceLike[], today: string): AgingRow[] {
  const byCurrency = new Map<string, AgingRow>();
  for (const inv of invoices) {
    const bal = outstanding(inv);
    if (bal <= 0) continue;
    let row = byCurrency.get(inv.currency);
    if (!row) {
      row = { currency: inv.currency, buckets: { current: 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 }, total: 0, invoiceCount: 0 };
      byCurrency.set(inv.currency, row);
    }
    row.buckets[agingBucket(daysOverdue(inv, today))] += bal;
    row.total += bal;
    row.invoiceCount += 1;
  }
  return [...byCurrency.values()];
}

export interface OverdueItem {
  invoiceId: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string | null;
  currency: string;
  balanceMinor: number;
  daysOverdue: number;
  bucket: AgingBucket;
}

export function overdueList(invoices: InvoiceLike[], today: string): OverdueItem[] {
  return invoices
    .filter((inv) => isOverdue(inv, today))
    .map((inv) => {
      const d = daysOverdue(inv, today);
      return {
        invoiceId: inv.id,
        invoiceNumber: inv.invoice_number,
        customerId: inv.customer_id,
        customerName: inv.customer_name ?? null,
        currency: inv.currency,
        balanceMinor: outstanding(inv),
        daysOverdue: d,
        bucket: agingBucket(d),
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

/** Polite, factual reminder copy. Tone escalates with days overdue but never threatens. */
export function draftReminder(args: {
  businessName: string;
  customerName: string;
  invoiceNumber: string;
  balance: string;
  dueDate: string;
  daysOverdue: number;
}): { subject: string; body: string } {
  const { businessName, customerName, invoiceNumber, balance, dueDate, daysOverdue: d } = args;
  const opener =
    d <= 0
      ? `This is a friendly reminder that invoice ${invoiceNumber} for ${balance} is due on ${dueDate}.`
      : d <= 14
        ? `Our records show that invoice ${invoiceNumber} for ${balance} was due on ${dueDate} and remains outstanding.`
        : `Invoice ${invoiceNumber} for ${balance} has been outstanding since ${dueDate} (${d} days). We would appreciate settlement or an update on when payment can be expected.`;
  return {
    subject: `Payment reminder: invoice ${invoiceNumber}`,
    body: `Hello ${customerName},\n\n${opener}\n\nIf you have already paid, please reply with the payment reference so we can reconcile it. If you need to discuss a payment plan, just let us know.\n\nThank you,\n${businessName}`,
  };
}
