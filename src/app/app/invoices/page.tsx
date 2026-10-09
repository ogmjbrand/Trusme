import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/money";
import { AGING_BUCKETS, agingReport, daysOverdue, isOverdue, outstanding, type InvoiceLike } from "@/lib/domain/receivables";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, SampleBadge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { fmtDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Invoices" };
const FILTERS = ["all", "overdue", "open", "draft", "paid", "void"] as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = "all" } = await searchParams;
  const ws = await getWorkspace();
  const { data } = await ws.supabase
    .from("invoices")
    .select("id, invoice_number, customer_id, status, currency, total_minor, amount_paid_minor, due_date, issue_date, is_sample, customers(name)")
    .eq("organization_id", ws.org.organizationId)
    .order("issue_date", { ascending: false })
    .limit(500);
  type Row = InvoiceLike & { is_sample: boolean; customers: { name: string } | null };
  const all = (data ?? []) as unknown as Row[];
  const today = todayIso();
  const rows = all.filter((i) =>
    filter === "overdue" ? isOverdue(i, today)
    : filter === "open" ? ["issued", "partially_paid"].includes(i.status)
    : filter === "all" ? true
    : i.status === filter,
  );
  const aging = agingReport(all, today);

  return (
    <>
      <PageHeader eyebrow="CollectIQ" title="Invoices & receivables" description="Create invoices, record payments and follow up on what you are owed." actions={can(ws.role, "records.write") ? <LinkButton href="/app/invoices/new"><Plus className="h-4 w-4" />New invoice</LinkButton> : null} />

      {aging.length ? (
        <Card className="mb-6">
          <CardHeader title="Receivables aging" description="Outstanding balances by days past due, per currency" />
          <Table>
            <THead><TR><TH>Currency</TH>{AGING_BUCKETS.map((b) => <TH key={b} className="text-right">{b === "current" ? "Not yet due" : `${b} days`}</TH>)}<TH className="text-right">Total</TH></TR></THead>
            <TBody>
              {aging.map((a) => (
                <TR key={a.currency}>
                  <TD>{a.currency}</TD>
                  {AGING_BUCKETS.map((b) => <TD key={b} className={cn("tabular text-right", b !== "current" && a.buckets[b] > 0 && "text-danger")}>{formatMoney(a.buckets[b], a.currency)}</TD>)}
                  <TD className="tabular text-right font-medium">{formatMoney(a.total, a.currency)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <Link key={f} href={`/app/invoices?filter=${f}`} className={cn("rounded-lg border px-3 py-1.5 text-xs capitalize", filter === f ? "border-brand/40 bg-brand-soft text-brand" : "border-line text-fg-muted hover:text-fg")}>{f}</Link>
        ))}
      </div>

      <Card>
        {rows.length ? (
          <Table>
            <THead><TR><TH>Invoice</TH><TH>Customer</TH><TH>Status</TH><TH>Due</TH><TH className="text-right">Total</TH><TH className="text-right">Balance</TH></TR></THead>
            <TBody>
              {rows.map((i) => {
                const od = isOverdue(i, today);
                return (
                  <TR key={i.id}>
                    <TD><Link href={`/app/invoices/${i.id}`} className="font-medium text-fg hover:text-brand">{i.invoice_number}</Link> {i.is_sample ? <SampleBadge /> : null}</TD>
                    <TD className="text-fg-muted">{i.customers?.name ?? "—"}</TD>
                    <TD><div className="flex gap-1"><StatusBadge status={i.status} />{od ? <Badge tone="danger">{daysOverdue(i, today)}d overdue</Badge> : null}</div></TD>
                    <TD className="text-fg-muted">{fmtDate(i.due_date)}</TD>
                    <TD className="tabular text-right">{formatMoney(i.total_minor, i.currency)}</TD>
                    <TD className={cn("tabular text-right", od && "text-danger")}>{formatMoney(outstanding(i), i.currency)}</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={Receipt} title={filter === "all" ? "No invoices yet" : `No ${filter} invoices`} description="Create an invoice to start tracking receivables." />
        )}
      </Card>
    </>
  );
}
