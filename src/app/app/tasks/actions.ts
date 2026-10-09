"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspace } from "@/lib/auth/context";
import { assertCan } from "@/lib/auth/permissions";
import { getEngine } from "@/lib/execution/server";
import { runAction, type ActionResult } from "@/lib/errors";

function runInBackground(executionId: string) {
  after(async () => {
    try {
      await getEngine().run(executionId);
    } catch (err) {
      console.error("background run failed", executionId, err);
    }
  });
}

export async function decideApproval(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    assertCan(ws.role, "approvals.decide");
    const input = z
      .object({ approvalId: z.string().uuid(), decision: z.enum(["approve", "reject"]), note: z.string().max(500).optional() })
      .parse({ approvalId: form.get("approvalId"), decision: form.get("decision"), note: form.get("note") || undefined });
    const exec = await getEngine().decideApproval(input.approvalId, ws.user.id, input.decision, input.note);
    runInBackground(exec.id);
    revalidatePath("/app", "layout");
    return null;
  }, "Decision recorded");
}

export async function cancelExecution(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    assertCan(ws.role, "executions.cancel");
    const id = z.string().uuid().parse(form.get("executionId"));
    await getEngine().cancel(id, ws.user.id);
    revalidatePath(`/app/tasks/${id}`);
    return null;
  }, "Cancellation requested");
}

export async function resumeExecution(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    assertCan(ws.role, "executions.create");
    const id = z.string().uuid().parse(form.get("executionId"));
    const { data } = await ws.supabase.from("executions").select("id").eq("id", id).eq("organization_id", ws.org.organizationId).maybeSingle();
    if (!data) throw new Error("Execution not found in this workspace");
    runInBackground(id);
    return null;
  }, "Resuming");
}

export async function retryStep(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    assertCan(ws.role, "executions.create");
    const stepId = z.string().uuid().parse(form.get("stepId"));
    const exec = await getEngine().retryStep(stepId, ws.user.id);
    runInBackground(exec.id);
    return null;
  }, "Retry scheduled");
}
