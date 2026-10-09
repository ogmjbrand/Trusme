import type { z } from "zod";
import type { OrgRole } from "@/lib/auth/permissions";

export type ExecutionStatus =
  | "draft" | "pending_approval" | "queued" | "running" | "waiting"
  | "completed" | "partially_completed" | "failed" | "cancelled";

export type StepStatus =
  | "pending" | "awaiting_approval" | "approved" | "running" | "retry_scheduled"
  | "succeeded" | "failed" | "skipped" | "rejected" | "cancelled";

export type SideEffect = "read" | "reversible_write" | "consequential";
export type VerificationStatus = "not_applicable" | "pending" | "verified" | "unverified" | "failed";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled" | "expired" | "superseded";

/** Distinguishes what actually happened. "prepared" is never reported as "sent". */
export type OutcomeLabel = "analyzed" | "prepared" | "created" | "updated" | "recorded" | "sent" | "submitted" | "verified" | "no_op";

export const TERMINAL_EXECUTION: ExecutionStatus[] = ["completed", "partially_completed", "failed", "cancelled"];
export const TERMINAL_STEP: StepStatus[] = ["succeeded", "failed", "skipped", "rejected", "cancelled"];

export interface PlanStep {
  toolId: string;
  title: string;
  rationale?: string;
  input: unknown;
  dependsOn?: number[];
}

export interface ExecutionPlan {
  goal: string;
  summary: string;
  steps: PlanStep[];
  planner: string;
  notes?: string[];
}

export interface ResultRef {
  type: string; // e.g. "invoice", "payment_reminder", "purchase_order"
  id: string;
  label: string;
  href?: string;
}

export interface ExecutionRow {
  id: string;
  organization_id: string;
  created_by: string;
  conversation_id: string | null;
  goal: string;
  originating_request: string;
  plan_summary: string | null;
  plan: ExecutionPlan | Record<string, unknown>;
  plan_version: number;
  planner: string;
  status: ExecutionStatus;
  current_step: number;
  retry_count: number;
  result_summary: string | null;
  error_summary: string | null;
  idempotency_key: string | null;
  cancel_requested: boolean;
  cancelled_by: string | null;
  cancelled_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  next_run_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StepRow {
  id: string;
  execution_id: string;
  organization_id: string;
  position: number;
  tool_id: string;
  title: string;
  rationale: string | null;
  input: unknown;
  depends_on: number[];
  side_effect: SideEffect;
  requires_approval: boolean;
  status: StepStatus;
  permission_check: Record<string, unknown> | null;
  attempt_count: number;
  max_attempts: number;
  idempotency_key: string;
  next_attempt_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  output: unknown;
  result_refs: ResultRef[];
  error: { message: string; code?: string; retryable?: boolean; setupRequired?: string[] } | null;
  verification: VerificationStatus;
  verification_detail: string | null;
  outcome_label: OutcomeLabel | null;
  created_at: string;
  updated_at: string;
}

export interface ApprovalRow {
  id: string;
  organization_id: string;
  execution_id: string;
  step_id: string;
  requested_by: string | null;
  tool_id: string;
  summary: string;
  action_details: Record<string, unknown>;
  action_hash: string;
  approver_min_role: OrgRole;
  status: ApprovalStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  expires_at: string;
  created_at: string;
}

export interface EventInput {
  execution_id: string;
  step_id?: string | null;
  organization_id: string;
  actor_user_id?: string | null;
  actor_type: "user" | "system" | "ai" | "webhook";
  event_type: string;
  message: string;
  data?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------
export interface ToolContextBase {
  orgId: string;
  actorUserId: string;
  actorRole: OrgRole;
  executionId: string;
  stepId: string;
  idempotencyKey: string;
  now: Date;
}

export interface ToolResult<O> {
  output: O;
  outcome: OutcomeLabel;
  refs?: ResultRef[];
}

export interface Verification {
  status: Exclude<VerificationStatus, "not_applicable" | "pending">;
  detail: string;
}

export interface ToolDefinition<I = unknown, O = unknown, C extends ToolContextBase = ToolContextBase> {
  id: string;
  title: string;
  description: string;
  module: "collectiq" | "stocksense" | "marginguard" | "incomepilot" | "beforeyoupay" | "jobproof" | "careervault" | "launchready" | "core";
  sideEffect: SideEffect;
  inputSchema: z.ZodType<I>;
  outputSchema: z.ZodType<O>;
  /** Minimum role of the actor to run the tool at all. */
  minRole: OrgRole;
  /** Minimum role to approve the tool when approval is required. */
  approverMinRole?: OrgRole;
  /** Extra approval rule beyond the side-effect class (e.g. amount thresholds). */
  requiresApproval?: (input: I) => boolean;
  retry: { maxAttempts: number; idempotent: boolean };
  timeoutMs: number;
  /** Human-readable description of exactly what will happen. Shown on approval cards. */
  summarize: (input: I) => string;
  run: (ctx: C, input: I) => Promise<ToolResult<O>>;
  /** Verify the result against an authoritative source (DB re-read, provider API). */
  verify?: (ctx: C, input: I, result: ToolResult<O>) => Promise<Verification>;
}

export class ToolError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly setupRequired?: string[];
  constructor(message: string, opts: { code?: string; retryable?: boolean; setupRequired?: string[] } = {}) {
    super(message);
    this.name = "ToolError";
    this.code = opts.code ?? "tool_error";
    this.retryable = opts.retryable ?? false;
    this.setupRequired = opts.setupRequired;
  }
}

export class PlanValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Plan rejected: ${issues.join("; ")}`);
    this.name = "PlanValidationError";
  }
}
