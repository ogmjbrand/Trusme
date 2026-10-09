import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { atLeast, can, type OrgRole } from "@/lib/auth/permissions";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Textarea } from "@/components/ui/field";
import { decideApproval, cancelExecution } from "../tasks/actions";
import { fmtDateTime } from "@/lib/format";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage() {
  const ws = await getWorkspace();
  const org = ws.org.organizationId;
  const [{ data: pending }, { data: history }] = await Promise.all([
    ws.supabase.from("approval_requests").select("id, execution_id, tool_id, summary, action_details, approver_min_role, created_at, expires_at, executions(goal)").eq("organization_id", org).eq("status", "pending").order("created_at"),
    ws.supabase.from("approval_requests").select("id, execution_id, tool_id, summary, status, decided_at, decision_note").eq("organization_id", org).neq("status", "pending").order("decided_at", { ascending: false, nullsFirst: false }).limit(30),
  ]);
  type Pending = { id: string; execution_id: string; tool_id: string; summary: string; action_details: { side_effect?: string; title?: string }; approver_min_role: OrgRole; created_at: string; expires_at: string; executions: { goal: string } | null };
  const items = (pending ?? []) as unknown as Pending[];
  return (
    <>
      <PageHeader title="Approval inbox" description="Consequential actions wait here until a person with the required role approves the exact action. Approving one action never authorizes another." />
      <Card className="mb-6">
        <CardHeader title={`Pending (${items.length})`} />
        {items.length ? (
          <ul className="divide-y divide-line">
            {items.map((a) => {
              const allowed = can(ws.role, "approvals.decide") && atLeast(ws.role, a.approver_min_role);
              return (
                <li key={a.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="gold">{a.action_details.side_effect === "consequential" ? "Consequential" : "Requires approval"}</Badge>
                    <span className="font-mono text-[11px] text-fg-subtle">{a.tool_id}</span>
                    <span className="text-xs text-fg-subtle">· requested {fmtDateTime(a.created_at)} · expires {fmtDateTime(a.expires_at)}</span>
                  </div>
                  <p className="mt-2 text-sm text-fg">{a.summary}</p>
                  <p className="mt-1 text-xs text-fg-muted">
                    Part of: <Link href={`/app/tasks/${a.execution_id}`} className="underline hover:text-fg">{a.executions?.goal ?? "execution"}</Link>
                  </p>
                  {allowed ? (
                    <ActionForm action={decideApproval} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
                      <input type="hidden" name="approvalId" value={a.id} />
                      <Textarea name="note" placeholder="Optional note" className="min-h-10 sm:max-w-md" maxLength={500} />
                      <div className="flex gap-2">
                        <SubmitButton name="decision" value="approve" size="sm">Approve</SubmitButton>
                        <SubmitButton name="decision" value="reject" variant="danger" size="sm">Reject</SubmitButton>
                      </div>
                    </ActionForm>
                  ) : (
                    <p className="mt-2 text-xs text-warning">Requires the {a.approver_min_role} role or higher to decide.</p>
                  )}
                  {can(ws.role, "executions.cancel") ? (
                    <ActionForm action={cancelExecution} className="mt-2">
                      <input type="hidden" name="executionId" value={a.execution_id} />
                      <SubmitButton variant="ghost" size="sm">Cancel the whole execution</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={ShieldCheck} title="Nothing waiting for approval" description="When a plan reaches a consequential step, it pauses here." />
        )}
      </Card>
      <Card>
        <CardHeader title="Recent decisions" />
        <ul className="divide-y divide-line">
          {(history ?? []).map((h) => (
            <li key={h.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
              <StatusBadge status={h.status} />
              <Link href={`/app/tasks/${h.execution_id}`} className="min-w-0 flex-1 truncate text-fg-muted hover:text-fg">{h.summary}</Link>
              <span className="text-xs text-fg-subtle">{fmtDateTime(h.decided_at)}</span>
            </li>
          ))}
          {!history?.length ? <li className="px-5 py-4 text-sm text-fg-subtle">No decisions yet.</li> : null}
        </ul>
      </Card>
    </>
  );
}
