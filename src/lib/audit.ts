import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEntry {
  organizationId: string;
  actorUserId: string | null;
  actorType?: "user" | "system" | "ai" | "webhook";
  action: string;
  resourceType: string;
  resourceId?: string | null;
  executionId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append an audit record. Failures are surfaced, never swallowed silently. */
export async function writeAudit(db: SupabaseClient, entry: AuditEntry): Promise<void> {
  const { error } = await db.from("audit_logs").insert({
    organization_id: entry.organizationId,
    actor_user_id: entry.actorUserId,
    actor_type: entry.actorType ?? "user",
    action: entry.action,
    resource_type: entry.resourceType,
    resource_id: entry.resourceId ?? null,
    execution_id: entry.executionId ?? null,
    metadata: entry.metadata ?? {},
  });
  if (error) throw new Error(`Audit log write failed: ${error.message}`);
}
