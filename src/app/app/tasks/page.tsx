import Link from "next/link";
import { ListChecks } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { LinkButton } from "@/components/ui/button";
import { fmtDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";

export const metadata = { title: "Executions" };
const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active", statuses: ["queued", "running", "waiting", "pending_approval"] },
  { key: "done", label: "Completed", statuses: ["completed", "partially_completed"] },
  { key: "failed", label: "Failed / cancelled", statuses: ["failed", "cancelled"] },
] as const;

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { filter = "all" } = await searchParams;
  const ws = await getWorkspace();
  let q = ws.supabase.from("executions").select("id, goal, status, planner, created_at, completed_at, result_summary, created_by").eq("organization_id", ws.org.organizationId).order("created_at", { ascending: false }).limit(100);
  const f = FILTERS.find((x) => x.key === filter);
  if (f && "statuses" in f) q = q.in("status", [...f.statuses]);
  const { data } = await q;
  return (
    <>
      <PageHeader title="Executions" description="Every plan TrustOS has run, with its durable step history." actions={<LinkButton href="/app/command" size="sm">New command</LinkButton>} />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((x) => (
          <Link key={x.key} href={`/app/tasks?filter=${x.key}`} className={cn("rounded-lg border px-3 py-1.5 text-xs", filter === x.key ? "border-brand/40 bg-brand-soft text-brand" : "border-line text-fg-muted hover:text-fg")}>
            {x.label}
          </Link>
        ))}
      </div>
      <Card>
        {data?.length ? (
          <Table>
            <THead>
              <TR><TH>Goal</TH><TH>Status</TH><TH>Result</TH><TH>Started</TH></TR>
            </THead>
            <TBody>
              {data.map((e) => (
                <TR key={e.id}>
                  <TD className="max-w-md">
                    <Link href={`/app/tasks/${e.id}`} className="font-medium text-fg hover:text-brand">{e.goal}</Link>
                    <div className="text-xs text-fg-subtle">{e.planner}{e.created_by === ws.user.id ? " · you" : ""}</div>
                  </TD>
                  <TD><StatusBadge status={e.status} /></TD>
                  <TD className="text-xs text-fg-muted">{e.result_summary ?? "—"}</TD>
                  <TD className="text-xs text-fg-muted">{fmtDateTime(e.created_at)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState icon={ListChecks} title="No executions" description="Executions appear here when you run a command." />
        )}
      </Card>
    </>
  );
}
