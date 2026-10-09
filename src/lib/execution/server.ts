import "server-only";
import { env } from "@/lib/env";
import { createAdminClient } from "@/lib/supabase/admin";
import { resendSender } from "@/lib/integrations/email";
import { toolRegistry } from "@/lib/tools";
import type { AppToolContext } from "@/lib/tools/context";
import { ExecutionEngine } from "./engine";
import { SupabaseExecutionStore } from "./supabase-store";
import type { ApprovalRow } from "./types";
import { roleRank, type OrgRole } from "@/lib/auth/permissions";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailSender } from "@/lib/integrations/email";

/** Adds best-effort email notification of approvers to the persistence layer. */
class NotifyingStore extends SupabaseExecutionStore {
  constructor(private readonly client: SupabaseClient, private readonly mailer: EmailSender, private readonly appUrl: string) {
    super(client);
  }
  override async createApproval(row: Omit<ApprovalRow, "id" | "created_at">) {
    const approval = await super.createApproval(row);
    if (!this.mailer.configured) return approval;
    try {
      const { data: members } = await this.client.from("organization_members").select("user_id, role").eq("organization_id", row.organization_id).eq("status", "active");
      const eligible = (members ?? []).filter((m) => roleRank(m.role as OrgRole) >= roleRank(row.approver_min_role)).map((m) => m.user_id as string);
      if (!eligible.length) return approval;
      const [{ data: profiles }, { data: prefs }] = await Promise.all([
        this.client.from("profiles").select("id, email").in("id", eligible),
        this.client.from("user_preferences").select("user_id, notification_settings").in("user_id", eligible),
      ]);
      for (const p of profiles ?? []) {
        const pref = (prefs ?? []).find((x) => x.user_id === p.id)?.notification_settings as { email?: boolean } | undefined;
        if (pref?.email === false) continue;
        await this.mailer.send({
          to: p.email as string,
          subject: "TrustOS: approval needed",
          text: `An action is waiting for your approval:\n\n${row.summary}\n\nReview it: ${this.appUrl}/app/approvals\n\nNothing happens until someone with the required role approves it.`,
          idempotencyKey: `approval-${approval.id}-${p.id}`,
        });
      }
    } catch (err) {
      console.error("approval email failed", (err as Error).message);
    }
    return approval;
  }
}

/** Production engine wired to PostgreSQL, the tool registry and providers. */
export function getEngine(): ExecutionEngine<AppToolContext> {
  const db = createAdminClient();
  const email = resendSender();
  const appUrl = env().NEXT_PUBLIC_APP_URL;
  return new ExecutionEngine<AppToolContext>({
    store: new NotifyingStore(db, email, appUrl),
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
