import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspace } from "@/lib/auth/context";
import type { ExecutionRow, StepRow } from "@/lib/execution/types";

export const runtime = "nodejs";

/** Downloadable Markdown record of an execution: plan, steps, approvals, outcomes. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ws = await getWorkspace();
  const { data: exec } = await ws.supabase.from("executions").select("*").eq("id", id).maybeSingle();
  if (!exec) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const e = exec as ExecutionRow;
  const { data: steps } = await ws.supabase.from("execution_steps").select("*").eq("execution_id", id).order("position");
  const { data: approvals } = await ws.supabase.from("approval_requests").select("step_id, status, summary, decided_by, decided_at, decision_note").eq("execution_id", id);

  const lines = [
    `# TrustOS execution report`,
    ``,
    `- Execution: ${e.id}`,
    `- Workspace: ${ws.org.name}`,
    `- Goal: ${e.goal}`,
    `- Status: ${e.status}`,
    `- Planner: ${e.planner}`,
    `- Created: ${e.created_at}`,
    `- Completed: ${e.completed_at ?? "—"}`,
    `- Result: ${e.result_summary ?? "—"}`,
    e.error_summary ? `- Errors: ${e.error_summary.replace(/\n/g, "; ")}` : "",
    ``,
    `## Original request`,
    ``,
    `> ${e.originating_request.replace(/\n/g, "\n> ")}`,
    ``,
    `## Steps`,
    ...((steps ?? []) as StepRow[]).flatMap((s) => {
      const a = (approvals ?? []).filter((x) => x.step_id === s.id);
      return [
        ``,
        `### ${s.position + 1}. ${s.title}`,
        `- Tool: \`${s.tool_id}\` (${s.side_effect.replace("_", " ")})`,
        `- Status: ${s.status}${s.outcome_label ? ` — outcome: ${s.outcome_label}` : ""}`,
        `- Attempts: ${s.attempt_count}`,
        `- Verification: ${s.verification}${s.verification_detail ? ` — ${s.verification_detail}` : ""}`,
        ...a.map((x) => `- Approval: ${x.status}${x.decided_at ? ` at ${x.decided_at}` : ""}${x.decision_note ? ` (${x.decision_note})` : ""} — ${x.summary}`),
        s.error ? `- Error: ${s.error.message}` : "",
        `- Input: \`${JSON.stringify(s.input)}\``,
        s.output ? `\n\`\`\`json\n${JSON.stringify(s.output, null, 2).slice(0, 8000)}\n\`\`\`` : "",
      ].filter(Boolean);
    }),
    ``,
    `---`,
    `Generated ${new Date().toISOString()}. "Prepared" means a draft was created; only steps with outcome "sent" or "submitted" reached an external party, and only as far as the provider confirmed.`,
  ].filter((l) => l !== "");

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="trustos-execution-${e.id.slice(0, 8)}.md"`,
      "Cache-Control": "no-store",
    },
  });
}
