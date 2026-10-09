import { randomUUID } from "node:crypto";
import type { OrgRole } from "@/lib/auth/permissions";
import type { ExecutionStore } from "./store";
import type { ApprovalRow, EventInput, ExecutionRow, StepRow } from "./types";

/** In-memory ExecutionStore for unit tests and local experiments. */
export class MemoryExecutionStore implements ExecutionStore {
  executions = new Map<string, ExecutionRow>();
  steps = new Map<string, StepRow>();
  approvals = new Map<string, ApprovalRow>();
  events: (EventInput & { id: number })[] = [];
  roles = new Map<string, OrgRole>();

  setRole(orgId: string, userId: string, role: OrgRole | null) {
    if (role) this.roles.set(`${orgId}:${userId}`, role);
    else this.roles.delete(`${orgId}:${userId}`);
  }

  private stamp() {
    return new Date().toISOString();
  }

  async findExecutionByKey(orgId: string, key: string) {
    return [...this.executions.values()].find((e) => e.organization_id === orgId && e.idempotency_key === key) ?? null;
  }
  async insertExecution(row: Omit<ExecutionRow, "created_at" | "updated_at">) {
    const full = { ...row, created_at: this.stamp(), updated_at: this.stamp() };
    this.executions.set(row.id, structuredClone(full));
    return structuredClone(full);
  }
  async insertSteps(rows: Omit<StepRow, "created_at" | "updated_at">[]) {
    return rows.map((r) => {
      const full = { ...r, created_at: this.stamp(), updated_at: this.stamp() };
      this.steps.set(r.id, structuredClone(full));
      return structuredClone(full);
    });
  }
  async getExecution(id: string) {
    const e = this.executions.get(id);
    return e ? structuredClone(e) : null;
  }
  async getSteps(executionId: string) {
    return [...this.steps.values()].filter((s) => s.execution_id === executionId).sort((a, b) => a.position - b.position).map((s) => structuredClone(s));
  }
  async getStep(id: string) {
    const s = this.steps.get(id);
    return s ? structuredClone(s) : null;
  }
  async updateExecution(id: string, patch: Partial<ExecutionRow>) {
    const e = this.executions.get(id);
    if (e) this.executions.set(id, { ...e, ...structuredClone(patch), updated_at: this.stamp() });
  }
  async updateStep(id: string, patch: Partial<StepRow>) {
    const s = this.steps.get(id);
    if (s) this.steps.set(id, { ...s, ...structuredClone(patch), updated_at: this.stamp() });
  }
  async appendEvent(event: EventInput) {
    this.events.push({ ...event, id: this.events.length + 1 });
  }
  async acquireLease(id: string, owner: string, until: Date, now: Date) {
    const e = this.executions.get(id);
    if (!e) return false;
    const free = !e.lease_expires_at || Date.parse(e.lease_expires_at) < now.getTime() || e.lease_owner === owner;
    if (!free) return false;
    e.lease_owner = owner;
    e.lease_expires_at = until.toISOString();
    return true;
  }
  async releaseLease(id: string, owner: string) {
    const e = this.executions.get(id);
    if (e && e.lease_owner === owner) {
      e.lease_owner = null;
      e.lease_expires_at = null;
    }
  }
  async createApproval(row: Omit<ApprovalRow, "id" | "created_at">) {
    const full: ApprovalRow = { ...row, id: randomUUID(), created_at: this.stamp() };
    this.approvals.set(full.id, structuredClone(full));
    return structuredClone(full);
  }
  async getApproval(id: string) {
    const a = this.approvals.get(id);
    return a ? structuredClone(a) : null;
  }
  async approvalsForStep(stepId: string) {
    return [...this.approvals.values()].filter((a) => a.step_id === stepId).map((a) => structuredClone(a));
  }
  async transitionApproval(id: string, expected: ApprovalRow["status"], patch: Partial<ApprovalRow>) {
    const a = this.approvals.get(id);
    if (!a || a.status !== expected) return false;
    this.approvals.set(id, { ...a, ...patch });
    return true;
  }
  async cancelPendingApprovals(executionId: string) {
    for (const a of this.approvals.values()) if (a.execution_id === executionId && a.status === "pending") a.status = "cancelled";
  }
  async getMemberRole(orgId: string, userId: string) {
    return this.roles.get(`${orgId}:${userId}`) ?? null;
  }
  async findRunnable(now: Date, limit: number) {
    return [...this.executions.values()]
      .filter((e) => ["queued", "running", "waiting"].includes(e.status) && (!e.next_run_at || Date.parse(e.next_run_at) <= now.getTime()))
      .slice(0, limit)
      .map((e) => e.id);
  }
}
