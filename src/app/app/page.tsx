import Link from "next/link";
import { ArrowRight, Boxes, ListChecks, Receipt, ShieldCheck, Sparkles } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/money";
import { agingReport, overdueList, type InvoiceLike } from "@/lib/domain/receivables";
import { fmtDateTime, todayIso } from "@/lib/format";
import { PageHeader, Stat, EmptyState, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { loadSampleData, removeSampleData } from "./actions";

export const metadata = { title: "Overview" };

export default async function Overview() {
  const ws = await getWorkspace();
  const org = ws.org.organizationId;
  const [invoices, lowStock, approvals, executions, sample] = await Promise.all([
    ws.supabase.from("invoices").select("id, invoice_number, customer_id, status, currency, total_minor, amount_paid_minor, due_date").eq("organization_id", org).in("status", ["issued", "partially_paid"]),
    ws.supabase.from("products").select("id, stock_on_hand, reorder_point").eq("organization_id", org).eq("is_active", true),
    ws.supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("status", "pending"),
    ws.supabase.from("executions").select("id, goal, status, created_at, result_summary").eq("organization_id", org).order("created_at", { ascending: false }).limit(6),
    ws.supabase.from("customers").select("id", { count: "exact", head: true }).eq("organization_id", org).eq("is_sample", true),
  ]);
  const inv = (invoices.data ?? []) as InvoiceLike[];
  const today = todayIso();
  const aging = agingReport(inv, today);
  const overdue = overdueList(inv, today);
  const low = (lowStock.data ?? []).filter((p) => Number(p.stock_on_hand) <= Number(p.reorder_point));
  const hasSample = (sample.count ?? 0) > 0;
  const isEmpty = inv.length === 0 && (lowStock.data ?? []).length === 0 && (executions.data ?? []).length === 0;

  return (
    <>
      <PageHeader
        eyebrow={ws.org.kind === "personal" ? "Personal workspace" : "Business workspace"}
        title={`Welcome${ws.profile.full_name ? `, ${ws.profile.full_name.split(" ")[0]}` : ""}`}
        description="What needs attention across your workspace, from authoritative records."
        actions={<LinkButton href="/app/command"><Sparkles className="h-4 w-4" />New command</LinkButton>}
      />

      {hasSample ? (
        <Notice tone="warning" title="Sample data is loaded" className="mb-6">
          Records labelled “Sample” are demonstration data, not real customers or transactions.{" "}
          {can(ws.role, "organization.update") ? (
            <ActionForm action={removeSampleData} className="mt-2">
              <SubmitButton variant="secondary" size="sm">Remove sample data</SubmitButton>
            </ActionForm>
          ) : null}
        </Notice>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Receivables outstanding" value={aging.length ? aging.map((a) => formatMoney(a.total, a.currency)).join(" · ") : formatMoney(0, ws.org.defaultCurrency)} hint={`${inv.length} open invoice(s)`} />
        <Stat label="Overdue invoices" value={overdue.length} tone={overdue.length ? "danger" : undefined} hint={overdue[0] ? `Oldest ${overdue[0].daysOverdue} days` : "None overdue"} />
        <Stat label="Products at/below reorder point" value={low.length} tone={low.length ? "gold" : undefined} />
        <Stat label="Pending approvals" value={approvals.count ?? 0} tone={(approvals.count ?? 0) ? "gold" : undefined} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Recent executions" description="Plans run by the Command Center" actions={<LinkButton href="/app/tasks" variant="ghost" size="sm">View all<ArrowRight className="h-3.5 w-3.5" /></LinkButton>} />
          {(executions.data ?? []).length ? (
            <ul className="divide-y divide-line">
              {(executions.data ?? []).map((e) => (
                <li key={e.id}>
                  <Link href={`/app/tasks/${e.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-surface-2/60">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-fg">{e.goal}</div>
                      <div className="text-xs text-fg-subtle">{fmtDateTime(e.created_at)}{e.result_summary ? ` · ${e.result_summary}` : ""}</div>
                    </div>
                    <StatusBadge status={e.status} />
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={ListChecks} title="No executions yet" description="Describe an outcome in the Command Center and TrustOS will plan and run it with your approval." action={<LinkButton href="/app/command" size="sm">Open Command Center</LinkButton>} />
          )}
        </Card>

        <Card>
          <CardHeader title="Next actions" />
          <CardBody className="space-y-3 text-sm">
            <QuickLink href="/app/invoices?filter=overdue" icon={Receipt} label={overdue.length ? `Follow up ${overdue.length} overdue invoice(s)` : "Create an invoice"} />
            <QuickLink href="/app/inventory" icon={Boxes} label={low.length ? `Review ${low.length} low-stock product(s)` : "Add products and stock"} />
            <QuickLink href="/app/approvals" icon={ShieldCheck} label={(approvals.count ?? 0) ? `Decide ${approvals.count} approval(s)` : "No approvals waiting"} />
            {isEmpty && can(ws.role, "organization.update") && !hasSample ? (
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <p className="text-xs text-fg-muted">New workspace? Load clearly labelled sample data to explore TrustOS. You can remove it at any time.</p>
                <ActionForm action={loadSampleData} className="mt-2">
                  <SubmitButton variant="gold" size="sm" pendingLabel="Loading…">Load sample data</SubmitButton>
                </ActionForm>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function QuickLink({ href, icon: Icon, label }: { href: string; icon: typeof Receipt; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:border-line-strong hover:bg-surface-2">
      <Icon className="h-4 w-4 text-brand" aria-hidden />
      <span className="flex-1 text-fg">{label}</span>
      <ArrowRight className="h-3.5 w-3.5 text-fg-subtle" aria-hidden />
    </Link>
  );
}
