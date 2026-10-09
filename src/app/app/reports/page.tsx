import { nowMs } from "@/lib/format";
import { Download } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney, totalsByCurrency } from "@/lib/money";
import { AGING_BUCKETS, agingReport, type InvoiceLike } from "@/lib/domain/receivables";
import { computeMargins } from "@/lib/domain/margins";
import { loadMarginInputs } from "@/lib/tools/analysis";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { buttonClass } from "@/components/ui/button";
import { todayIso } from "@/lib/format";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ws = await getWorkspace();
  const org = ws.org.organizationId;
  const now = nowMs();
  const [inv, products, margin, pay30, exp30] = await Promise.all([
    ws.supabase.from("invoices").select("id, invoice_number, customer_id, status, currency, total_minor, amount_paid_minor, due_date").eq("organization_id", org).in("status", ["issued", "partially_paid"]),
    ws.supabase.from("products").select("currency, stock_on_hand, unit_cost_minor").eq("organization_id", org),
    loadMarginInputs({ db: ws.supabase, orgId: org }, new Date(now - 30 * 86_400_000).toISOString(), new Date(now).toISOString()),
    ws.supabase.from("payments").select("amount_minor, currency").eq("organization_id", org).eq("status", "succeeded").gte("received_at", new Date(now - 30 * 86_400_000).toISOString()),
    ws.supabase.from("expenses").select("amount_minor, currency").eq("organization_id", org).gte("incurred_at", new Date(now - 30 * 86_400_000).toISOString().slice(0, 10)),
  ]);
  const aging = agingReport((inv.data ?? []) as InvoiceLike[], todayIso());
  const valuation = totalsByCurrency((products.data ?? []).map((p) => ({ amountMinor: Math.round(Math.max(Number(p.stock_on_hand), 0) * p.unit_cost_minor), currency: p.currency })));
  const margins = computeMargins(margin.sales, margin.expenses, margin.spoilage);
  const marginTotals = totalsByCurrency(margins.map((m) => ({ amountMinor: m.contribution, currency: m.currency })));
  const revenueTotals = totalsByCurrency(margins.map((m) => ({ amountMinor: m.netRevenue, currency: m.currency })));
  const exports = [
    { href: "/api/reports/receivables.csv", label: "Receivables & aging" },
    { href: "/api/reports/payments.csv", label: "Payments" },
    { href: "/api/reports/sales.csv", label: "Sales lines" },
    { href: "/api/reports/inventory.csv", label: "Inventory valuation" },
    ...(can(ws.role, "audit.read") ? [{ href: "/api/reports/audit.csv", label: "Audit log" }] : []),
  ];
  const fmtList = (l: { amountMinor: number; currency: string }[]) => (l.length ? l.map((m) => formatMoney(m.amountMinor, m.currency)).join(" · ") : "—");
  return (
    <>
      <PageHeader title="Reports" description="Summaries computed from source records, with CSV exports. Sample records are flagged in exports." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Last 30 days" />
          <CardBody className="grid gap-4 text-sm sm:grid-cols-2">
            <div><div className="text-xs text-fg-muted">Payments received</div><div className="tabular mt-1 font-semibold">{fmtList(totalsByCurrency((pay30.data ?? []).map((p) => ({ amountMinor: p.amount_minor, currency: p.currency }))))}</div></div>
            <div><div className="text-xs text-fg-muted">Expenses recorded</div><div className="tabular mt-1 font-semibold">{fmtList(totalsByCurrency((exp30.data ?? []).map((p) => ({ amountMinor: p.amount_minor, currency: p.currency }))))}</div></div>
            <div><div className="text-xs text-fg-muted">Net sales revenue</div><div className="tabular mt-1 font-semibold">{fmtList(revenueTotals)}</div></div>
            <div><div className="text-xs text-fg-muted">Product contribution</div><div className="tabular mt-1 font-semibold">{fmtList(marginTotals)}</div></div>
            <div><div className="text-xs text-fg-muted">Stock value at cost (now)</div><div className="tabular mt-1 font-semibold">{fmtList(valuation)}</div></div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Exports (CSV)" />
          <CardBody className="flex flex-col gap-2">
            {exports.map((e) => <a key={e.href} href={e.href} className={buttonClass("secondary", "sm", "justify-start")}><Download className="h-3.5 w-3.5" />{e.label}</a>)}
          </CardBody>
        </Card>
      </div>
      <Card className="mt-6">
        <CardHeader title="Receivables aging" />
        <Table>
          <THead><TR><TH>Currency</TH>{AGING_BUCKETS.map((b) => <TH key={b} className="text-right">{b}</TH>)}<TH className="text-right">Total</TH></TR></THead>
          <TBody>
            {aging.map((a) => <TR key={a.currency}><TD>{a.currency}</TD>{AGING_BUCKETS.map((b) => <TD key={b} className="tabular text-right">{formatMoney(a.buckets[b], a.currency)}</TD>)}<TD className="tabular text-right font-medium">{formatMoney(a.total, a.currency)}</TD></TR>)}
            {!aging.length ? <TR><TD colSpan={7} className="text-fg-subtle">No open receivables.</TD></TR> : null}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
