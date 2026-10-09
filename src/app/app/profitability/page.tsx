import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { computeMargins, marginTrends } from "@/lib/domain/margins";
import { loadMarginInputs } from "@/lib/tools/analysis";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/money";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/field";
import { fmtDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/cn";
import { recordExpense } from "./actions";
import { WhatIfCalculator } from "./what-if";

export const metadata = { title: "Profitability" };

export default async function ProfitabilityPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const sp = await searchParams;
  const days = [7, 30, 90, 180].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const ws = await getWorkspace();
  const org = ws.org.organizationId;
  const now = Date.now();
  const to = new Date(now).toISOString();
  const from = new Date(now - days * 86_400_000).toISOString();
  const prevFrom = new Date(now - 2 * days * 86_400_000).toISOString();
  const ctx = { db: ws.supabase, orgId: org };
  const [cur, prev, products, costHistory, expenses] = await Promise.all([
    loadMarginInputs(ctx, from, to),
    loadMarginInputs(ctx, prevFrom, from),
    ws.supabase.from("products").select("id, name, sku, unit_price_minor, unit_cost_minor, currency").eq("organization_id", org).order("name"),
    ws.supabase.from("product_cost_history").select("product_id, unit_cost_minor, currency, effective_at, source, suppliers(name)").eq("organization_id", org).order("effective_at", { ascending: false }).limit(300),
    ws.supabase.from("expenses").select("id, description, cost_type, amount_minor, currency, incurred_at, product_id, is_sample").eq("organization_id", org).order("incurred_at", { ascending: false }).limit(20),
  ]);
  const margins = computeMargins(cur.sales, cur.expenses, cur.spoilage);
  const trends = marginTrends(computeMargins(prev.sales, prev.expenses, prev.spoilage), margins);
  const names = new Map((products.data ?? []).map((p) => [p.id, p]));
  const unallocated = cur.expenses.filter((e) => !e.product_id && ["shipping", "payment_fee", "other_direct"].includes(e.cost_type));

  // Supplier cost changes: latest vs previous recorded cost per product.
  type CH = { product_id: string; unit_cost_minor: number; currency: string; effective_at: string; source: string; suppliers: { name: string } | null };
  const byProduct = new Map<string, CH[]>();
  for (const c of (costHistory.data ?? []) as unknown as CH[]) byProduct.set(c.product_id, [...(byProduct.get(c.product_id) ?? []), c]);
  const costChanges = [...byProduct.entries()]
    .map(([pid, list]) => ({ pid, latest: list[0]!, prev: list.find((x) => x.currency === list[0]!.currency && x.unit_cost_minor !== list[0]!.unit_cost_minor) }))
    .filter((x) => x.prev);

  return (
    <>
      <PageHeader eyebrow="MarginGuard" title="Product profitability" description="Every figure is computed from recorded sales, expenses and stock movements. Different currencies are never combined." />
      <div className="mb-4 flex gap-1.5">
        {[7, 30, 90, 180].map((d) => (
          <Link key={d} href={`/app/profitability?days=${d}`} className={cn("rounded-lg border px-3 py-1.5 text-xs", d === days ? "border-brand/40 bg-brand-soft text-brand" : "border-line text-fg-muted hover:text-fg")}>Last {d} days</Link>
        ))}
      </div>

      <Card className="mb-6">
        <CardHeader title={`Margins · ${fmtDate(from.slice(0, 10))} – ${fmtDate(to.slice(0, 10))}`} description="Trend compares contribution margin with the previous period of equal length; a drop of 3+ points is flagged." />
        {margins.length ? (
          <Table>
            <THead><TR><TH>Product</TH><TH className="text-right">Units</TH><TH className="text-right">Net revenue</TH><TH className="text-right">COGS</TH><TH className="text-right">Gross margin</TH><TH className="text-right">Direct costs</TH><TH className="text-right">Contribution</TH><TH>Trend</TH><TH>Sources</TH></TR></THead>
            <TBody>
              {margins.map((m, i) => {
                const t = trends[i]!;
                const p = names.get(m.productId);
                const direct = m.paymentFees + m.shipping + m.otherDirect + m.spoilage;
                return (
                  <TR key={`${m.productId}-${m.currency}`}>
                    <TD><div className="font-medium">{p?.name ?? "Unknown"}</div><div className="font-mono text-[11px] text-fg-subtle">{p?.sku} · {m.currency}</div></TD>
                    <TD className="tabular text-right">{m.unitsSold - m.unitsReturned}</TD>
                    <TD className="tabular text-right">{formatMoney(m.netRevenue, m.currency)}</TD>
                    <TD className="tabular text-right text-fg-muted">{formatMoney(m.cogs, m.currency)}</TD>
                    <TD className="tabular text-right">{m.grossMarginPct ?? "—"}%</TD>
                    <TD className="tabular text-right text-fg-muted" title={`Fees ${formatMoney(m.paymentFees, m.currency)} · Shipping ${formatMoney(m.shipping, m.currency)} · Other ${formatMoney(m.otherDirect, m.currency)} · Spoilage ${formatMoney(m.spoilage, m.currency)}`}>{formatMoney(direct, m.currency)}</TD>
                    <TD className={cn("tabular text-right font-medium", m.contribution < 0 && "text-danger")}>{formatMoney(m.contribution, m.currency)}<div className="text-xs font-normal text-fg-muted">{m.contributionMarginPct ?? "—"}%</div></TD>
                    <TD>{t.changePts === null ? <span className="text-xs text-fg-subtle">no prior data</span> : t.declining ? <Badge tone="danger"><TrendingDown className="h-3 w-3" />{t.changePts} pts</Badge> : <Badge tone={t.changePts >= 0 ? "brand" : "neutral"}>{t.changePts >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}{t.changePts} pts</Badge>}</TD>
                    <TD className="text-[11px] text-fg-subtle">{m.sources.sales.length} sales · {m.sources.expenses.length} expenses · {m.sources.spoilage.length} spoilage</TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={TrendingUp} title="No sales in this period" description="Record sales in StockSense to see product margins." />
        )}
        {unallocated.length ? <CardBody className="border-t border-line text-xs text-fg-muted">{unallocated.length} direct expense(s) are not linked to a product and are excluded from product margins (no allocation is guessed).</CardBody> : null}
        <CardBody className="border-t border-line text-xs leading-relaxed text-fg-subtle">
          <strong className="text-fg-muted">Definitions.</strong> Net revenue = (sold − returned) × price − allocated discounts. COGS = units × cost snapshot at time of sale. Gross margin = (net revenue − COGS) ÷ net revenue. Direct costs = allocated payment fees and shipping + product-linked direct expenses + spoilage at cost. Contribution = gross profit − direct costs. Expenses classed as “inventory purchase” are excluded because COGS already includes them.
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Supplier cost changes" description="Latest vs previous recorded unit cost" />
          <ul className="divide-y divide-line">
            {costChanges.map((c) => {
              const delta = c.latest.unit_cost_minor - c.prev!.unit_cost_minor;
              return (
                <li key={c.pid} className="px-5 py-3 text-sm">
                  <div className="font-medium">{names.get(c.pid)?.name ?? "Product"}</div>
                  <div className="text-xs text-fg-muted">{formatMoney(c.prev!.unit_cost_minor, c.latest.currency)} → <span className={delta > 0 ? "text-danger" : "text-brand"}>{formatMoney(c.latest.unit_cost_minor, c.latest.currency)}</span> on {fmtDate(c.latest.effective_at)} ({c.latest.source.replace("_", " ")}{c.latest.suppliers ? `, ${c.latest.suppliers.name}` : ""})</div>
                </li>
              );
            })}
            {!costChanges.length ? <li className="px-5 py-4 text-sm text-fg-subtle">No cost changes recorded.</li> : null}
          </ul>
        </Card>
        <Card>
          <CardHeader title="What-if pricing" />
          <CardBody>
            <WhatIfCalculator currency={ws.org.defaultCurrency} products={(products.data ?? []).map((p) => ({ id: p.id, name: p.name, price: p.unit_price_minor, cost: p.unit_cost_minor, currency: p.currency }))} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Record an expense" />
          <CardBody>
            {can(ws.role, "records.write") ? (
              <ActionForm action={recordExpense} resetOnSuccess className="space-y-3">
                <Field label="Description" htmlFor="edesc"><Input id="edesc" name="description" required /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Amount" htmlFor="eamt"><Input id="eamt" name="amount" inputMode="decimal" required /></Field>
                  <Field label="Currency" htmlFor="ecur"><Select id="ecur" name="currency" defaultValue={ws.org.defaultCurrency}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                  <Field label="Type" htmlFor="etype"><Select id="etype" name="cost_type" defaultValue="other_direct"><option value="other_direct">Other direct cost</option><option value="shipping">Shipping / transport</option><option value="payment_fee">Payment fee</option><option value="inventory_purchase">Inventory purchase (excluded from margins)</option><option value="overhead">Overhead</option><option value="personal">Personal</option></Select></Field>
                  <Field label="Date" htmlFor="edate"><Input id="edate" name="incurred_at" type="date" defaultValue={todayIso()} required /></Field>
                </div>
                <Field label="Category" htmlFor="ecat"><Input id="ecat" name="category" placeholder="e.g. Logistics" /></Field>
                <Field label="Product (for direct costs)" htmlFor="eprod"><Select id="eprod" name="product_id" defaultValue=""><option value="">Not product-specific</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                <SubmitButton>Record expense</SubmitButton>
              </ActionForm>
            ) : <p className="text-sm text-fg-muted">Viewers cannot record expenses.</p>}
            <ul className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-fg-muted">
              {(expenses.data ?? []).slice(0, 6).map((e) => <li key={e.id} className="flex justify-between gap-2"><span className="truncate">{e.description}</span><span className="tabular">{formatMoney(e.amount_minor, e.currency)}</span></li>)}
            </ul>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
