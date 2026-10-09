import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ToolContextBase } from "@/lib/execution/types";
import type { EmailSender } from "@/lib/integrations/email";

/**
 * Context available to registered tools. `db` is a service-role client:
 * every query MUST filter by `orgId` and every write MUST set
 * organization_id = orgId. Authorization has already been checked by the
 * engine (role vs. tool.minRole, approvals for consequential actions).
 */
export interface AppToolContext extends ToolContextBase {
  db: SupabaseClient;
  email: EmailSender;
  appUrl: string;
  audit: (action: string, resourceType: string, resourceId?: string | null, metadata?: Record<string, unknown>) => Promise<void>;
}

export function today(ctx: Pick<ToolContextBase, "now">): string {
  return ctx.now.toISOString().slice(0, 10);
}

export function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}
