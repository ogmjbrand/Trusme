import Link from "next/link";
import { pagePermission } from "@/lib/auth/context";
import { PageHeader, Forbidden } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ page?: string; action?: string }> }) {
  const { ctx: ws, allowed } = await pagePermission("audit.read");
  if (!allowed) return <Forbidden requirement="admin" />;
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0) || 0);
  let q = ws.supabase.from("audit_logs").select("id, actor_user_id, actor_type, action, resource_type, resource_id, execution_id, metadata, created_at").eq("organization_id", ws.org.organizationId).order("id", { ascending: false }).range(page * 50, page * 50 + 49);
  if (sp.action) q = q.ilike("action", `${sp.action.replace(/[%_]/g, "")}%`);
  const { data } = await q;
  const ids = [...new Set((data ?? []).map((d) => d.actor_user_id).filter(Boolean))] as string[];
  const { data: profiles } = ids.length ? await ws.supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of security- and money-relevant actions. Entries cannot be edited or deleted." actions={<a href="/api/reports/audit.csv" className={buttonClass("secondary", "sm")}>Export CSV</a>} />
      <form className="mb-4 flex gap-2"><input name="action" defaultValue={sp.action ?? ""} placeholder="Filter by action prefix (e.g. payment.)" className="h-9 w-72 rounded-lg border border-line-strong bg-surface-2 px-3 text-sm" /><button className={buttonClass("secondary", "sm")}>Filter</button></form>
      <Card>
        <Table>
          <THead><TR><TH>When</TH><TH>Actor</TH><TH>Action</TH><TH>Resource</TH><TH>Details</TH></TR></THead>
          <TBody>
            {(data ?? []).map((a) => {
              const p = profiles?.find((x) => x.id === a.actor_user_id);
              return (
                <TR key={a.id}>
                  <TD className="whitespace-nowrap text-xs text-fg-muted">{fmtDateTime(a.created_at)}</TD>
                  <TD className="text-xs"><Badge tone={a.actor_type === "ai" ? "info" : a.actor_type === "webhook" ? "gold" : "neutral"}>{a.actor_type}</Badge> {p?.full_name ?? p?.email ?? ""}</TD>
                  <TD className="font-mono text-xs">{a.action}</TD>
                  <TD className="text-xs text-fg-muted">{a.resource_type}{a.resource_id ? ` · ${a.resource_id.slice(0, 8)}` : ""}{a.execution_id ? <> · <Link href={`/app/tasks/${a.execution_id}`} className="underline">execution</Link></> : null}</TD>
                  <TD className="max-w-xs truncate font-mono text-[11px] text-fg-subtle" title={JSON.stringify(a.metadata)}>{JSON.stringify(a.metadata)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
      <div className="mt-4 flex gap-2">
        {page > 0 ? <Link className={buttonClass("ghost", "sm")} href={`/app/audit?page=${page - 1}${sp.action ? `&action=${sp.action}` : ""}`}>Newer</Link> : null}
        {(data ?? []).length === 50 ? <Link className={buttonClass("ghost", "sm")} href={`/app/audit?page=${page + 1}${sp.action ? `&action=${sp.action}` : ""}`}>Older</Link> : null}
      </div>
    </>
  );
}
