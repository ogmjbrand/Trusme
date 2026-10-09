import type { OrgRole } from "@/lib/auth/permissions";
import type { ApprovalRow, EventInput, ExecutionRow, StepRow } from "./types";

/** Persistence port for the execution engine (PostgreSQL in production). */
export interface ExecutionStore {
  findExecutionByKey(orgId: string, idempotencyKey: string): Promise<ExecutionRow | null>;
  insertExecution(row: Omit<ExecutionRow, "created_at" | "updated_at">): Promise<ExecutionRow>;
  insertSteps(rows: Omit<StepRow, "created_at" | "updated_at">[]): Promise<StepRow[]>;
  getExecution(id: string): Promise<ExecutionRow | null>;
  getSteps(executionId: string): Promise<StepRow[]>;
  getStep(id: string): Promise<StepRow | null>;
  updateExecution(id: string, patch: Partial<ExecutionRow>): Promise<void>;
  updateStep(id: string, patch: Partial<StepRow>): Promise<void>;
  appendEvent(event: EventInput): Promise<void>;
  /** Atomically take the run lease if free or expired. */
  acquireLease(id: string, owner: string, until: Date, now: Date): Promise<boolean>;
  releaseLease(id: string, owner: string): Promise<void>;
  createApproval(row: Omit<ApprovalRow, "id" | "created_at">): Promise<ApprovalRow>;
  getApproval(id: string): Promise<ApprovalRow | null>;
  approvalsForStep(stepId: string): Promise<ApprovalRow[]>;
  /** Conditional update: only applies when the current status equals `expected`. */
  transitionApproval(id: string, expected: ApprovalRow["status"], patch: Partial<ApprovalRow>): Promise<boolean>;
  cancelPendingApprovals(executionId: string): Promise<void>;
  getMemberRole(orgId: string, userId: string): Promise<OrgRole | null>;
  findRunnable(now: Date, limit: number): Promise<string[]>;
}
