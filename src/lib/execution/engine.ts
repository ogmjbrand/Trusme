import { randomUUID } from "node:crypto";
import { atLeast, AuthorizationError, type OrgRole } from "@/lib/auth/permissions";
import { hashObject, sha256, canonicalJson } from "@/lib/domain/hash";
import type { ExecutionStore } from "./store";
import {
  PlanValidationError,
  TERMINAL_EXECUTION,
  TERMINAL_STEP,
  ToolError,
  type ExecutionPlan,
  type ExecutionRow,
  type StepRow,
  type ToolContextBase,
  type ToolDefinition,
} from "./types";
import type { ToolRegistry } from "./registry";

export interface EngineDeps<C extends ToolContextBase> {
  store: ExecutionStore;
  registry: ToolRegistry<C>;
  /** Builds the full tool context (database handle, providers, audit). */
  makeContext: (base: ToolContextBase) => C;
  now?: () => Date;
  workerId?: string;
  leaseMs?: number;
  /** Base delay for bounded exponential backoff. */
  backoffBaseMs?: number;
  backoffMaxMs?: number;
  /** Safety valve: maximum steps processed in one run() call. */
  maxStepsPerRun?: number;
}

export interface CreateExecutionInput {
  orgId: string;
  actorUserId: string;
  request: string;
  plan: ExecutionPlan;
  conversationId?: string | null;
  idempotencyKey?: string | null;
  /** User preference: allow low-risk reversible writes without approval. */
  autoRunLowRisk: boolean;
}

export function actionHash(toolId: string, input: unknown): string {
  return hashObject({ toolId, input });
}

/**
 * Durable, step-based execution engine. All state lives in the store; any
 * worker can resume any execution after acquiring its lease. A model-produced
 * plan is only a proposal: each step is re-validated, permission-checked and,
 * when consequential, gated on an explicit approval bound to its exact input.
 */
export class ExecutionEngine<C extends ToolContextBase = ToolContextBase> {
  private readonly store: ExecutionStore;
  private readonly registry: ToolRegistry<C>;
  private readonly now: () => Date;
  private readonly workerId: string;
  private readonly leaseMs: number;
  private readonly backoffBaseMs: number;
  private readonly backoffMaxMs: number;
  private readonly maxStepsPerRun: number;

  constructor(private readonly deps: EngineDeps<C>) {
    this.store = deps.store;
    this.registry = deps.registry;
    this.now = deps.now ?? (() => new Date());
    this.workerId = deps.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
    this.leaseMs = deps.leaseMs ?? 60_000;
    this.backoffBaseMs = deps.backoffBaseMs ?? 2_000;
    this.backoffMaxMs = deps.backoffMaxMs ?? 60_000;
    this.maxStepsPerRun = deps.maxStepsPerRun ?? 50;
  }

  // -------------------------------------------------------------------------
  // Planning → persisted execution
  // -------------------------------------------------------------------------
  validatePlan(plan: ExecutionPlan): { steps: { def: ToolDefinition<unknown, unknown, C>; input: unknown; dependsOn: number[] }[] } {
    const issues: string[] = [];
    if (!plan.steps.length) issues.push("plan has no steps");
    if (plan.steps.length > 20) issues.push("plan has more than 20 steps");
    const steps = plan.steps.map((s, idx) => {
      const def = this.registry.get(s.toolId);
      if (!def) {
        issues.push(`step ${idx + 1}: unknown tool "${s.toolId}"`);
        return null;
      }
      const parsed = def.inputSchema.safeParse(s.input ?? {});
      if (!parsed.success) {
        issues.push(`step ${idx + 1} (${s.toolId}): ${parsed.error.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join(", ")}`);
        return null;
      }
      const dependsOn = [...new Set((s.dependsOn ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d < idx))];
      return { def, input: parsed.data, dependsOn };
    });
    if (issues.length) throw new PlanValidationError(issues);
    return { steps: steps as { def: ToolDefinition<unknown, unknown, C>; input: unknown; dependsOn: number[] }[] };
  }

  async createExecution(input: CreateExecutionInput): Promise<ExecutionRow> {
    const role = await this.store.getMemberRole(input.orgId, input.actorUserId);
    if (!atLeast(role, "member")) throw new AuthorizationError("Only members can start executions");

    if (input.idempotencyKey) {
      const existing = await this.store.findExecutionByKey(input.orgId, input.idempotencyKey);
      if (existing) return existing;
    }

    const { steps } = this.validatePlan(input.plan);
    const id = randomUUID();
    const now = this.now().toISOString();

    const exec = await this.store.insertExecution({
      id,
      organization_id: input.orgId,
      created_by: input.actorUserId,
      conversation_id: input.conversationId ?? null,
      goal: input.plan.goal,
      originating_request: input.request,
      plan_summary: input.plan.summary,
      plan: input.plan,
      plan_version: 1,
      planner: input.plan.planner,
      status: "queued",
      current_step: 0,
      retry_count: 0,
      result_summary: null,
      error_summary: null,
      idempotency_key: input.idempotencyKey ?? null,
      cancel_requested: false,
      cancelled_by: null,
      cancelled_at: null,
      lease_owner: null,
      lease_expires_at: null,
      next_run_at: now,
      started_at: null,
      completed_at: null,
    });

    await this.store.insertSteps(
      steps.map((s, position) => {
        const planStep = input.plan.steps[position]!;
        const requiresApproval =
          s.def.sideEffect === "consequential" ||
          (s.def.requiresApproval?.(s.input) ?? false) ||
          (s.def.sideEffect === "reversible_write" && !input.autoRunLowRisk);
        return {
          id: randomUUID(),
          execution_id: id,
          organization_id: input.orgId,
          position,
          tool_id: s.def.id,
          title: planStep.title || s.def.title,
          rationale: planStep.rationale ?? null,
          input: s.input,
          input_resolved: !s.def.resolve,
          depends_on: s.dependsOn,
          side_effect: s.def.sideEffect,
          requires_approval: requiresApproval,
          status: "pending",
          permission_check: null,
          attempt_count: 0,
          max_attempts: s.def.retry.idempotent ? Math.max(1, s.def.retry.maxAttempts) : 1,
          idempotency_key: sha256(`${id}:${position}:${canonicalJson(s.input)}`),
          next_attempt_at: null,
          started_at: null,
          completed_at: null,
          output: null,
          result_refs: [],
          error: null,
          verification: "not_applicable",
          verification_detail: null,
          outcome_label: null,
        };
      }),
    );

    await this.event(exec, null, "execution.created", `Execution created with ${steps.length} step(s)`, input.actorUserId, "user", {
      planner: input.plan.planner,
    });
    return exec;
  }

  // -------------------------------------------------------------------------
  // Running
  // -------------------------------------------------------------------------
  async run(executionId: string): Promise<ExecutionRow | null> {
    const now = this.now();
    const leased = await this.store.acquireLease(executionId, this.workerId, new Date(now.getTime() + this.leaseMs), now);
    if (!leased) return this.store.getExecution(executionId);

    try {
      let exec = await this.store.getExecution(executionId);
      if (!exec || TERMINAL_EXECUTION.includes(exec.status)) return exec;

      if (exec.status !== "running") {
        await this.store.updateExecution(exec.id, {
          status: "running",
          started_at: exec.started_at ?? this.now().toISOString(),
        });
        await this.event(exec, null, "execution.running", "Execution running", null, "system");
      }

      for (let processed = 0; processed < this.maxStepsPerRun; processed++) {
        exec = (await this.store.getExecution(executionId))!;
        if (exec.cancel_requested) return await this.finalizeCancelled(exec, exec.cancelled_by);

        const steps = await this.store.getSteps(executionId);
        await this.skipBlockedDependents(exec, steps);
        const next = this.nextActionable(steps);

        if (!next) return await this.settle(exec, steps);

        await this.store.acquireLease(executionId, this.workerId, new Date(this.now().getTime() + this.leaseMs), this.now());
        await this.processStep(exec, next);
      }
      return await this.store.getExecution(executionId);
    } finally {
      await this.store.releaseLease(executionId, this.workerId);
    }
  }

  private depsSatisfied(step: StepRow, steps: StepRow[]): boolean {
    return step.depends_on.every((d) => steps.find((s) => s.position === d)?.status === "succeeded");
  }

  private nextActionable(steps: StepRow[]): StepRow | undefined {
    const now = this.now().getTime();
    return steps
      .sort((a, b) => a.position - b.position)
      .find((s) => {
        if (!this.depsSatisfied(s, steps)) return false;
        if (s.status === "pending" || s.status === "approved") return true;
        if (s.status === "retry_scheduled") return !s.next_attempt_at || Date.parse(s.next_attempt_at) <= now;
        // A crashed worker may have left a step "running"; the lease expired, so resume it.
        if (s.status === "running") return true;
        return false;
      });
  }

  private async skipBlockedDependents(exec: ExecutionRow, steps: StepRow[]): Promise<void> {
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of steps) {
        if (s.status !== "pending" && s.status !== "awaiting_approval") continue;
        const blocker = s.depends_on
          .map((d) => steps.find((x) => x.position === d))
          .find((d) => d && ["failed", "skipped", "rejected", "cancelled"].includes(d.status));
        if (blocker) {
          s.status = "skipped";
          changed = true;
          await this.store.updateStep(s.id, {
            status: "skipped",
            completed_at: this.now().toISOString(),
            error: { message: `Skipped because step ${blocker.position + 1} (${blocker.title}) ${blocker.status}` },
          });
          await this.cancelStepApprovals(s.id);
          await this.event(exec, s, "step.skipped", `Skipped: depends on step ${blocker.position + 1}, which ${blocker.status}`, null, "system");
        }
      }
    }
  }

  private async cancelStepApprovals(stepId: string) {
    for (const a of await this.store.approvalsForStep(stepId)) {
      if (a.status === "pending") await this.store.transitionApproval(a.id, "pending", { status: "cancelled", decided_at: this.now().toISOString() });
    }
  }

  private backoff(attempt: number): number {
    return Math.min(this.backoffBaseMs * 2 ** Math.max(attempt - 1, 0), this.backoffMaxMs);
  }

  private async processStep(exec: ExecutionRow, step: StepRow): Promise<void> {
    const def = this.registry.get(step.tool_id);
    if (!def) {
      await this.failStep(exec, step, { message: `Tool ${step.tool_id} is no longer registered`, code: "unknown_tool" });
      return;
    }

    // A worker died mid-step. Only idempotent tools may be re-run blindly.
    if (step.status === "running" && !def.retry.idempotent) {
      await this.failStep(exec, step, {
        message: "Execution was interrupted while this step was running. Its outcome is unknown; check the affected records before retrying.",
        code: "interrupted",
      });
      return;
    }

    // 1. Permission check — re-evaluated at execution time, not plan time.
    const role = await this.store.getMemberRole(exec.organization_id, exec.created_by);
    const permission = { checked_at: this.now().toISOString(), actor: exec.created_by, role, required: def.minRole, allowed: atLeast(role, def.minRole) };
    if (!permission.allowed) {
      await this.store.updateStep(step.id, { permission_check: permission });
      await this.failStep(exec, step, { message: `Permission denied: requires ${def.minRole} role`, code: "permission_denied" });
      return;
    }

    const ctx = this.deps.makeContext({
      orgId: exec.organization_id,
      actorUserId: exec.created_by,
      actorRole: role!,
      executionId: exec.id,
      stepId: step.id,
      idempotencyKey: step.idempotency_key,
      now: this.now(),
    });

    // 2a. Late binding of concrete targets (before any approval is requested).
    if (def.resolve && !step.input_resolved) {
      try {
        const resolved = def.inputSchema.parse(await def.resolve(ctx, def.inputSchema.parse(step.input)));
        step.input = resolved;
        step.input_resolved = true;
        await this.store.updateStep(step.id, { input: resolved, input_resolved: true });
        await this.event(exec, step, "step.resolved", `Resolved targets: ${def.summarize(resolved)}`, null, "system");
      } catch (err) {
        await this.failStep(exec, step, { message: err instanceof Error ? err.message : String(err), code: err instanceof ToolError ? err.code : "resolve_failed", setupRequired: err instanceof ToolError ? err.setupRequired : undefined });
        return;
      }
    }

    // 2b. Approval gate — bound to the exact tool + (resolved) input.
    const hash = actionHash(step.tool_id, step.input);
    if (step.requires_approval) {
      const approvals = await this.store.approvalsForStep(step.id);
      const granted = approvals.find((a) => a.status === "approved" && a.action_hash === hash);
      if (!granted) {
        if (!approvals.some((a) => a.status === "pending")) {
          for (const stale of approvals.filter((a) => a.status === "approved" && a.action_hash !== hash)) {
            await this.store.transitionApproval(stale.id, "approved", { status: "superseded" });
          }
          await this.store.createApproval({
            organization_id: exec.organization_id,
            execution_id: exec.id,
            step_id: step.id,
            requested_by: exec.created_by,
            tool_id: def.id,
            summary: def.summarize(step.input),
            action_details: { input: step.input as Record<string, unknown>, side_effect: def.sideEffect, title: step.title },
            action_hash: hash,
            approver_min_role: def.approverMinRole ?? "member",
            status: "pending",
            decided_by: null,
            decided_at: null,
            decision_note: null,
            expires_at: new Date(this.now().getTime() + 7 * 86_400_000).toISOString(),
          });
        }
        await this.store.updateStep(step.id, { status: "awaiting_approval", permission_check: permission });
        await this.event(exec, step, "approval.requested", `Approval required: ${def.summarize(step.input)}`, null, "system");
        return;
      }
    }

    // 3. Execute with timeout.
    const attempt = step.attempt_count + 1;
    await this.store.updateStep(step.id, {
      status: "running",
      attempt_count: attempt,
      started_at: this.now().toISOString(),
      permission_check: permission,
      error: null,
    });
    await this.store.updateExecution(exec.id, { current_step: step.position });
    await this.event(exec, step, "step.started", `Running ${def.title} (attempt ${attempt})`, null, "system", { tool: def.id });

    try {
      const input = def.inputSchema.parse(step.input);
      const result = await withTimeout(def.run(ctx, input), def.timeoutMs, def.id);
      const output = def.outputSchema.parse(result.output);
      let verification: StepRow["verification"] = "not_applicable";
      let verificationDetail: string | null = null;
      if (def.verify) {
        try {
          const v = await def.verify(ctx, input, { ...result, output });
          verification = v.status;
          verificationDetail = v.detail;
        } catch (err) {
          verification = "unverified";
          verificationDetail = `Verification could not be completed: ${(err as Error).message}`;
        }
      }
      await this.store.updateStep(step.id, {
        status: "succeeded",
        output,
        outcome_label: result.outcome,
        result_refs: result.refs ?? [],
        verification,
        verification_detail: verificationDetail,
        completed_at: this.now().toISOString(),
        next_attempt_at: null,
      });
      await this.event(exec, step, "step.succeeded", `${def.title}: ${result.outcome}`, null, "system", {
        refs: result.refs ?? [],
        verification,
      });
    } catch (err) {
      const toolErr = err instanceof ToolError ? err : null;
      const message = err instanceof Error ? err.message : String(err);
      const retryable = (toolErr?.retryable ?? !toolErr) && def.retry.idempotent;
      if (retryable && attempt < step.max_attempts) {
        const delay = this.backoff(attempt);
        const nextAt = new Date(this.now().getTime() + delay).toISOString();
        await this.store.updateStep(step.id, {
          status: "retry_scheduled",
          next_attempt_at: nextAt,
          error: { message, code: toolErr?.code ?? "error", retryable: true },
        });
        await this.store.updateExecution(exec.id, { retry_count: exec.retry_count + 1 });
        await this.event(exec, step, "step.retry_scheduled", `Attempt ${attempt} failed (${message}); retrying in ${Math.round(delay / 1000)}s`, null, "system");
        return;
      }
      await this.failStep(exec, step, {
        message,
        code: toolErr?.code ?? "error",
        retryable: false,
        setupRequired: toolErr?.setupRequired,
      });
    }
  }

  private async failStep(exec: ExecutionRow, step: StepRow, error: NonNullable<StepRow["error"]>) {
    await this.store.updateStep(step.id, { status: "failed", error, completed_at: this.now().toISOString() });
    await this.event(exec, step, "step.failed", `${step.title} failed: ${error.message}`, null, "system", { code: error.code });
  }

  /** Decide the execution status once no step can make progress right now. */
  private async settle(exec: ExecutionRow, steps: StepRow[]): Promise<ExecutionRow> {
    const waitingRetry = steps.filter((s) => s.status === "retry_scheduled");
    const awaiting = steps.filter((s) => s.status === "awaiting_approval");

    if (waitingRetry.length) {
      const nextAt = waitingRetry.map((s) => s.next_attempt_at).filter(Boolean).sort()[0] ?? this.now().toISOString();
      await this.store.updateExecution(exec.id, { status: "waiting", next_run_at: nextAt });
      return (await this.store.getExecution(exec.id))!;
    }
    if (awaiting.length) {
      await this.store.updateExecution(exec.id, { status: "pending_approval", next_run_at: null });
      if (exec.status !== "pending_approval") {
        await this.event(exec, null, "execution.pending_approval", `${awaiting.length} step(s) awaiting approval`, null, "system");
      }
      return (await this.store.getExecution(exec.id))!;
    }

    const succeeded = steps.filter((s) => s.status === "succeeded").length;
    const failed = steps.filter((s) => s.status === "failed").length;
    const rejected = steps.filter((s) => s.status === "rejected").length;
    const skipped = steps.filter((s) => s.status === "skipped").length;
    const cancelled = steps.filter((s) => s.status === "cancelled").length;
    const total = steps.length;

    const status: ExecutionRow["status"] =
      succeeded === total ? "completed" : succeeded > 0 ? "partially_completed" : "failed";
    const parts = [`${succeeded} of ${total} step(s) succeeded`];
    if (failed) parts.push(`${failed} failed`);
    if (rejected) parts.push(`${rejected} rejected`);
    if (skipped) parts.push(`${skipped} skipped`);
    if (cancelled) parts.push(`${cancelled} cancelled`);
    const errors = steps.filter((s) => s.status === "failed" && s.error).map((s) => `Step ${s.position + 1}: ${s.error!.message}`);

    await this.store.updateExecution(exec.id, {
      status,
      result_summary: parts.join(", "),
      error_summary: errors.length ? errors.join("\n") : null,
      completed_at: this.now().toISOString(),
      next_run_at: null,
    });
    await this.event(exec, null, `execution.${status}`, parts.join(", "), null, "system");
    return (await this.store.getExecution(exec.id))!;
  }

  private async finalizeCancelled(exec: ExecutionRow, by: string | null): Promise<ExecutionRow> {
    const steps = await this.store.getSteps(exec.id);
    for (const s of steps) {
      if (!TERMINAL_STEP.includes(s.status)) {
        await this.store.updateStep(s.id, { status: "cancelled", completed_at: this.now().toISOString() });
      }
    }
    await this.store.cancelPendingApprovals(exec.id);
    const done = steps.filter((s) => s.status === "succeeded").length;
    await this.store.updateExecution(exec.id, {
      status: "cancelled",
      cancelled_at: this.now().toISOString(),
      cancelled_by: by,
      completed_at: this.now().toISOString(),
      next_run_at: null,
      result_summary: `Cancelled. ${done} step(s) had already completed and were not rolled back.`,
    });
    await this.event(exec, null, "execution.cancelled", "Execution cancelled", by, by ? "user" : "system");
    return (await this.store.getExecution(exec.id))!;
  }

  // -------------------------------------------------------------------------
  // Human controls
  // -------------------------------------------------------------------------
  async decideApproval(approvalId: string, userId: string, decision: "approve" | "reject", note?: string): Promise<ExecutionRow> {
    const approval = await this.store.getApproval(approvalId);
    if (!approval) throw new Error("Approval request not found");
    const role = await this.store.getMemberRole(approval.organization_id, userId);
    if (!atLeast(role, approval.approver_min_role)) {
      throw new AuthorizationError(`Approving this action requires the ${approval.approver_min_role} role or higher`);
    }
    if (approval.status !== "pending") throw new Error(`This request is already ${approval.status}`);

    const exec = (await this.store.getExecution(approval.execution_id))!;
    const step = (await this.store.getStep(approval.step_id))!;
    if (TERMINAL_EXECUTION.includes(exec.status)) throw new Error(`Execution is already ${exec.status}`);

    const nowIso = this.now().toISOString();
    if (Date.parse(approval.expires_at) < this.now().getTime()) {
      await this.store.transitionApproval(approval.id, "pending", { status: "expired", decided_at: nowIso });
      throw new Error("This approval request has expired. Retry the step to request a fresh approval.");
    }
    if (actionHash(step.tool_id, step.input) !== approval.action_hash) {
      await this.store.transitionApproval(approval.id, "pending", { status: "superseded", decided_at: nowIso });
      throw new Error("The action changed after approval was requested. A fresh approval is required.");
    }

    const applied = await this.store.transitionApproval(approval.id, "pending", {
      status: decision === "approve" ? "approved" : "rejected",
      decided_by: userId,
      decided_at: nowIso,
      decision_note: note ?? null,
    });
    if (!applied) throw new Error("This request was decided by someone else");

    if (decision === "approve") {
      await this.store.updateStep(step.id, { status: "approved" });
      await this.event(exec, step, "approval.approved", `Approved: ${approval.summary}`, userId, "user", { approval_id: approval.id });
    } else {
      await this.store.updateStep(step.id, { status: "rejected", completed_at: nowIso, error: { message: note ? `Rejected: ${note}` : "Rejected by approver" } });
      await this.event(exec, step, "approval.rejected", `Rejected: ${approval.summary}`, userId, "user", { approval_id: approval.id });
    }
    await this.store.updateExecution(exec.id, { status: "queued", next_run_at: nowIso });
    return (await this.store.getExecution(exec.id))!;
  }

  async cancel(executionId: string, userId: string): Promise<ExecutionRow> {
    const exec = await this.store.getExecution(executionId);
    if (!exec) throw new Error("Execution not found");
    const role = await this.store.getMemberRole(exec.organization_id, userId);
    if (!atLeast(role, "member")) throw new AuthorizationError();
    if (TERMINAL_EXECUTION.includes(exec.status)) return exec;

    await this.store.updateExecution(exec.id, { cancel_requested: true, cancelled_by: userId });
    await this.event(exec, null, "execution.cancel_requested", "Cancellation requested", userId, "user");
    const leaseActive = exec.lease_expires_at && Date.parse(exec.lease_expires_at) > this.now().getTime();
    if (!leaseActive) return this.finalizeCancelled({ ...exec, cancel_requested: true }, userId);
    return (await this.store.getExecution(exec.id))!;
  }

  /**
   * Manually retry a failed step. Consequential steps always require a fresh
   * approval — a previous approval never authorizes a repeat attempt.
   */
  async retryStep(stepId: string, userId: string): Promise<ExecutionRow> {
    const step = await this.store.getStep(stepId);
    if (!step) throw new Error("Step not found");
    const exec = (await this.store.getExecution(step.execution_id))!;
    const role = await this.store.getMemberRole(exec.organization_id, userId);
    if (!atLeast(role, "member")) throw new AuthorizationError();
    if (step.status !== "failed") throw new Error(`Only failed steps can be retried (step is ${step.status})`);
    if (exec.status === "cancelled") throw new Error("Cancelled executions cannot be resumed");
    const def = this.registry.get(step.tool_id);
    if (!def) throw new Error("Tool is no longer available");

    const needsFreshApproval = step.requires_approval || def.sideEffect === "consequential";
    for (const a of await this.store.approvalsForStep(step.id)) {
      if (a.status === "approved") await this.store.transitionApproval(a.id, "approved", { status: "superseded" });
    }
    await this.store.updateStep(step.id, {
      status: "pending",
      requires_approval: needsFreshApproval,
      input_resolved: !def.resolve,
      max_attempts: step.attempt_count + Math.max(1, def.retry.idempotent ? def.retry.maxAttempts : 1),
      error: null,
      completed_at: null,
    });
    // Re-open dependents that were skipped because of this failure.
    const steps = await this.store.getSteps(exec.id);
    for (const s of steps) {
      if (s.status === "skipped" && s.depends_on.includes(step.position)) {
        await this.store.updateStep(s.id, { status: "pending", error: null, completed_at: null });
      }
    }
    await this.store.updateExecution(exec.id, {
      status: "queued",
      next_run_at: this.now().toISOString(),
      completed_at: null,
      result_summary: null,
      error_summary: null,
    });
    await this.event(exec, step, "step.retry_requested", `Retry requested${needsFreshApproval ? " (fresh approval required)" : ""}`, userId, "user");
    return (await this.store.getExecution(exec.id))!;
  }

  private async event(
    exec: ExecutionRow,
    step: StepRow | null,
    type: string,
    message: string,
    actor: string | null,
    actorType: "user" | "system" | "ai" | "webhook",
    data: Record<string, unknown> = {},
  ) {
    await this.store.appendEvent({
      execution_id: exec.id,
      step_id: step?.id ?? null,
      organization_id: exec.organization_id,
      actor_user_id: actor,
      actor_type: actorType,
      event_type: type,
      message,
      data,
    });
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolError(`${label} timed out after ${ms}ms`, { code: "timeout", retryable: true })), ms);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type { OrgRole };
