import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrgRole } from "@/lib/auth/permissions";
import type { ExecutionStore } from "./store";
import type { ApprovalRow, EventInput, ExecutionRow, StepRow } from "./types";

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** PostgreSQL-backed store. Uses the service-role client; engine enforces authorization. */
export class SupabaseExecutionStore implements ExecutionStore {
  constructor(private readonly db: SupabaseClient) {}

  async findExecutionByKey(orgId: string, key: string) {
    const r = await this.db.from("executions").select("*").eq("organization_id", orgId).eq("idempotency_key", key).maybeSingle();
    return check(r, "find execution") as ExecutionRow | null;
  }
  async insertExecution(row: Omit<ExecutionRow, "created_at" | "updated_at">) {
    return check(await this.db.from("executions").insert(row).select("*").single(), "insert execution") as ExecutionRow;
  }
  async insertSteps(rows: Omit<StepRow, "created_at" | "updated_at">[]) {
    return check(await this.db.from("execution_steps").insert(rows).select("*"), "insert steps") as StepRow[];
  }
  async getExecution(id: string) {
    return check(await this.db.from("executions").select("*").eq("id", id).maybeSingle(), "get execution") as ExecutionRow | null;
  }
  async getSteps(executionId: string) {
    return check(await this.db.from("execution_steps").select("*").eq("execution_id", executionId).order("position"), "get steps") as StepRow[];
  }
  async getStep(id: string) {
    return check(await this.db.from("execution_steps").select("*").eq("id", id).maybeSingle(), "get step") as StepRow | null;
  }
  async updateExecution(id: string, patch: Partial<ExecutionRow>) {
    check(await this.db.from("executions").update(patch).eq("id", id), "update execution");
    if (patch.status && ["completed", "partially_completed", "failed", "cancelled"].includes(patch.status)) {
      const e = check(await this.db.from("executions").select("organization_id, created_by, goal, result_summary").eq("id", id).single(), "load execution") as { organization_id: string; created_by: string; goal: string; result_summary: string | null };
      await this.db.from("notifications").insert({
        organization_id: e.organization_id,
        user_id: e.created_by,
        kind: `execution.${patch.status}`,
        title: `Execution ${patch.status.replace("_", " ")}: ${e.goal.slice(0, 80)}`,
        body: patch.result_summary ?? e.result_summary,
        link: `/app/tasks/${id}`,
      });
    }
  }
  async updateStep(id: string, patch: Partial<StepRow>) {
    check(await this.db.from("execution_steps").update(patch).eq("id", id), "update step");
  }
  async appendEvent(e: EventInput) {
    check(await this.db.from("execution_events").insert({ ...e, data: e.data ?? {} }), "append event");
  }
  async acquireLease(id: string, owner: string, until: Date, now: Date) {
    const r = await this.db
      .from("executions")
      .update({ lease_owner: owner, lease_expires_at: until.toISOString() })
      .eq("id", id)
      .or(`lease_expires_at.is.null,lease_expires_at.lt.${now.toISOString()},lease_owner.eq.${owner}`)
      .select("id");
    return (check(r, "acquire lease") ?? []).length === 1;
  }
  async releaseLease(id: string, owner: string) {
    check(await this.db.from("executions").update({ lease_owner: null, lease_expires_at: null }).eq("id", id).eq("lease_owner", owner), "release lease");
  }
  async createApproval(row: Omit<ApprovalRow, "id" | "created_at">) {
    const approval = check(await this.db.from("approval_requests").insert(row).select("*").single(), "create approval") as ApprovalRow;
    if (row.requested_by) {
      await this.db.from("notifications").insert({
        organization_id: row.organization_id,
        user_id: row.requested_by,
        kind: "approval.requested",
        title: "Approval needed",
        body: row.summary.slice(0, 500),
        link: "/app/approvals",
      });
    }
    return approval;
  }
  async getApproval(id: string) {
    return check(await this.db.from("approval_requests").select("*").eq("id", id).maybeSingle(), "get approval") as ApprovalRow | null;
  }
  async approvalsForStep(stepId: string) {
    return check(await this.db.from("approval_requests").select("*").eq("step_id", stepId).order("created_at"), "approvals for step") as ApprovalRow[];
  }
  async transitionApproval(id: string, expected: ApprovalRow["status"], patch: Partial<ApprovalRow>) {
    const r = await this.db.from("approval_requests").update(patch).eq("id", id).eq("status", expected).select("id");
    return (check(r, "transition approval") ?? []).length === 1;
  }
  async cancelPendingApprovals(executionId: string) {
    check(
      await this.db.from("approval_requests").update({ status: "cancelled", decided_at: new Date().toISOString() }).eq("execution_id", executionId).eq("status", "pending"),
      "cancel approvals",
    );
  }
  async getMemberRole(orgId: string, userId: string) {
    const r = await this.db.from("organization_members").select("role").eq("organization_id", orgId).eq("user_id", userId).eq("status", "active").maybeSingle();
    return (check(r, "member role") as { role: OrgRole } | null)?.role ?? null;
  }
  async findRunnable(now: Date, limit: number) {
    const iso = now.toISOString();
    const r = await this.db
      .from("executions")
      .select("id")
      .in("status", ["queued", "running", "waiting"])
      .or(`next_run_at.is.null,next_run_at.lte.${iso}`)
      .or(`lease_expires_at.is.null,lease_expires_at.lt.${iso}`)
      .order("next_run_at", { ascending: true, nullsFirst: true })
      .limit(limit);
    return (check(r, "find runnable") as { id: string }[]).map((x) => x.id);
  }
}
