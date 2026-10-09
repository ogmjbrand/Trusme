import "server-only";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { resendSender } from "@/lib/integrations/email";
import { toolRegistry } from "@/lib/tools";
import type { AppToolContext } from "@/lib/tools/context";
import { ExecutionEngine } from "./engine";
import { SupabaseExecutionStore } from "./supabase-store";

/** Production engine wired to PostgreSQL, the tool registry and providers. */
export function getEngine(): ExecutionEngine<AppToolContext> {
  const db = createAdminClient();
  const email = resendSender();
  const appUrl = env().NEXT_PUBLIC_APP_URL;
  return new ExecutionEngine<AppToolContext>({
    store: new SupabaseExecutionStore(db),
    registry: toolRegistry(),
    makeContext: (base) => ({
      ...base,
      db,
      email,
      appUrl,
      audit: async (action, resourceType, resourceId, metadata) => {
        const { error } = await db.from("audit_logs").insert({
          organization_id: base.orgId,
          actor_user_id: base.actorUserId,
          actor_type: "ai",
          action,
          resource_type: resourceType,
          resource_id: resourceId ?? null,
          execution_id: base.executionId,
          metadata: metadata ?? {},
        });
        if (error) throw new Error(`audit: ${error.message}`);
      },
    }),
  });
}

/** Run runnable executions (cron / resume). Bounded per invocation. */
export async function runPending(limit = 10, budgetMs = 45_000): Promise<{ processed: string[] }> {
  const engine = getEngine();
  const store = new SupabaseExecutionStore(createAdminClient());
  const started = Date.now();
  const ids = await store.findRunnable(new Date(), limit);
  const processed: string[] = [];
  for (const id of ids) {
    if (Date.now() - started > budgetMs) break;
    await engine.run(id);
    processed.push(id);
  }
  return { processed };
}
