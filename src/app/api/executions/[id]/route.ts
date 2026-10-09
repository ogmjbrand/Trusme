import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspace } from "@/lib/auth/context";

export const runtime = "nodejs";

/** Live execution state for the timeline. Read through RLS as the signed-in user. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ws = await getWorkspace();
  const [exec, steps, events, approvals] = await Promise.all([
    ws.supabase.from("executions").select("*").eq("id", id).maybeSingle(),
    ws.supabase.from("execution_steps").select("*").eq("execution_id", id).order("position"),
    ws.supabase.from("execution_events").select("id, step_id, actor_type, event_type, message, created_at").eq("execution_id", id).order("id", { ascending: true }).limit(500),
    ws.supabase.from("approval_requests").select("*").eq("execution_id", id).order("created_at"),
  ]);
  if (!exec.data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { execution: exec.data, steps: steps.data ?? [], events: events.data ?? [], approvals: approvals.data ?? [], role: ws.role },
    { headers: { "Cache-Control": "no-store" } },
  );
}
