import { after, NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { getEngine } from "@/lib/execution/server";
import { buildPlan, ruleNarration } from "@/lib/ai/plan-service";
import { getAIProvider } from "@/lib/ai/provider";
import { toolRegistry } from "@/lib/tools";
import { PlanValidationError } from "@/lib/execution/types";
import { toUserError } from "@/lib/errors";

export const runtime = "nodejs";
export const maxDuration = 60;

const body = z.object({
  request: z.string().trim().min(3).max(4000),
  conversationId: z.string().uuid().optional().nullable(),
  idempotencyKey: z.string().min(8).max(100),
});

export async function POST(req: Request) {
  const ws = await getWorkspace();
  if (!can(ws.role, "executions.create")) {
    return NextResponse.json({ error: "Viewers cannot run commands. Ask an admin for member access." }, { status: 403 });
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const { request, idempotencyKey } = parsed.data;
  const orgId = ws.org.organizationId;
  const admin = createAdminClient();

  try {
    // Conversation + user message (server-written, scoped to this user and org).
    let conversationId = parsed.data.conversationId ?? null;
    if (conversationId) {
      const { data: conv } = await ws.supabase.from("conversations").select("id").eq("id", conversationId).eq("organization_id", orgId).maybeSingle();
      if (!conv) conversationId = null;
    }
    if (!conversationId) {
      const { data, error } = await ws.supabase.from("conversations").insert({ organization_id: orgId, user_id: ws.user.id, title: request.slice(0, 80) }).select("id").single();
      if (error) throw error;
      conversationId = data.id as string;
    }
    const { error: msgErr } = await admin.from("messages").insert({ conversation_id: conversationId, organization_id: orgId, user_id: ws.user.id, role: "user", content: request });
    if (msgErr) throw msgErr;

    // Retrieve authorized context (counts only — tools fetch records at execution time).
    const tables = ["customers", "invoices", "products", "sales", "expenses", "recurring_obligations", "risk_assessments", "launch_projects"];
    const counts: Record<string, number> = {};
    await Promise.all(tables.map(async (t) => {
      const { count } = await ws.supabase.from(t).select("id", { count: "exact", head: true }).eq("organization_id", orgId);
      counts[t] = count ?? 0;
    }));

    const engine = getEngine();
    const { plan, fallbackReason } = await buildPlan(request, ws, engine, counts);
    const exec = await engine.createExecution({
      orgId,
      actorUserId: ws.user.id,
      request,
      plan,
      conversationId,
      idempotencyKey,
      autoRunLowRisk: ws.preferences.ai_auto_run_low_risk,
    });

    const registry = toolRegistry();
    const approvalsNeeded = plan.steps
      .filter((s) => {
        const d = registry.get(s.toolId);
        return d && (d.sideEffect === "consequential" || (d.sideEffect === "reversible_write" && !ws.preferences.ai_auto_run_low_risk));
      })
      .map((s) => s.title);

    // Start execution after the response is sent; state is persisted, so a
    // restart is recovered by the cron runner or the user pressing Resume.
    after(async () => {
      try {
        await engine.run(exec.id);
      } catch (err) {
        console.error("execution run failed", exec.id, err);
      }
    });

    const provider = getAIProvider();
    const narration = provider && !fallbackReason ? provider.narrate({ request, plan, approvalsNeeded }) : ruleNarration(plan, approvalsNeeded);
    const encoder = new TextEncoder();
    let full = "";
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of narration) {
            full += chunk;
            controller.enqueue(encoder.encode(chunk));
          }
        } catch (err) {
          const fallback = `\n\n(Narration unavailable: ${(err as Error).message}. The plan below is running normally.)`;
          full += fallback;
          controller.enqueue(encoder.encode(fallback));
        } finally {
          await admin.from("messages").insert({ conversation_id: conversationId, organization_id: orgId, user_id: null, role: "assistant", content: full, execution_id: exec.id });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Execution-Id": exec.id,
        "X-Conversation-Id": conversationId,
        "X-Planner": plan.planner,
      },
    });
  } catch (err) {
    if (err instanceof PlanValidationError) return NextResponse.json({ error: err.message }, { status: 422 });
    const { error } = toUserError(err);
    return NextResponse.json({ error }, { status: 500 });
  }
}
