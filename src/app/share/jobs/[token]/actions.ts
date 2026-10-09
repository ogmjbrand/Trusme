"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { runAction, type ActionResult } from "@/lib/errors";
import { agreementHash, applyChange, jobByToken } from "@/lib/services/jobproof";

// Public customer actions. Authorization = possession of the share token
// (stored only as a hash). Every write is scoped to the token's job.

const name = z.string().trim().min(2, "Type your full name").max(120);

async function load(token: string) {
  const admin = createAdminClient();
  const job = await jobByToken(admin, token);
  if (!job) throw new Error("This link is invalid or has been revoked");
  return { admin, job };
}

async function audit(admin: ReturnType<typeof createAdminClient>, orgId: string, jobId: string, action: string, meta: Record<string, unknown>) {
  await admin.from("audit_logs").insert({ organization_id: orgId, actor_type: "system", action, resource_type: "service_job", resource_id: jobId, metadata: { via: "customer_share_link", ...meta } });
}

export async function customerAcceptAgreement(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const d = z.object({ token: z.string(), agreement_id: z.string().uuid(), content_hash: z.string().length(64), name, confirm: z.literal("on", { message: "Tick the box to confirm" }) })
      .parse({ token: form.get("token"), agreement_id: form.get("agreement_id"), content_hash: form.get("content_hash"), name: form.get("name"), confirm: form.get("confirm") });
    const { admin, job } = await load(d.token);
    const { data: latest } = await admin.from("service_agreements").select("*").eq("job_id", job.id).order("version", { ascending: false }).limit(1).single();
    if (!latest || latest.id !== d.agreement_id) throw new Error("A newer version of the agreement exists. Please review it.");
    const recomputed = agreementHash({ scope: latest.scope, materials: latest.materials, currency: latest.currency, price_minor: latest.price_minor, deadline: latest.deadline, terms: latest.terms });
    if (recomputed !== latest.content_hash || latest.content_hash !== d.content_hash) throw new Error("The agreement content changed. Please reload and review it.");
    if (latest.customer_accepted_at) return null;
    await admin.from("service_agreements").update({ customer_accepted_name: d.name, customer_accepted_at: new Date().toISOString() }).eq("id", latest.id).is("customer_accepted_at", null);
    if (["draft", "proposed"].includes(job.status)) await admin.from("service_jobs").update({ status: "agreed" }).eq("id", job.id);
    await audit(admin, job.organization_id, job.id, "agreement.customer_accepted", { version: latest.version, name: d.name, content_hash: latest.content_hash });
    revalidatePath(`/share/jobs/${d.token}`);
    return null;
  }, "Agreement accepted");
}

export async function customerDecideChange(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const d = z.object({ token: z.string(), id: z.string().uuid(), decision: z.enum(["approved", "rejected"]), name }).parse({ token: form.get("token"), id: form.get("id"), decision: form.get("decision"), name: form.get("name") });
    const { admin, job } = await load(d.token);
    const { data: c } = await admin.from("job_change_requests").select("*").eq("id", d.id).eq("job_id", job.id).maybeSingle();
    if (!c || c.status !== "proposed" || c.requested_by_party !== "provider") throw new Error("This change request is not open for your decision");
    const { data: updated } = await admin.from("job_change_requests").update({ status: d.decision, decided_by_party: "customer", decided_by_name: d.name, decided_at: new Date().toISOString() }).eq("id", d.id).eq("status", "proposed").select("id");
    if (!updated?.length) throw new Error("Already decided");
    if (d.decision === "approved") await applyChange(admin, job.organization_id, job.id, c);
    await audit(admin, job.organization_id, job.id, `change_request.customer_${d.decision}`, { change_id: d.id, name: d.name });
    revalidatePath(`/share/jobs/${d.token}`);
    return null;
  }, "Decision recorded");
}

export async function customerProposeChange(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const d = z.object({ token: z.string(), description: z.string().trim().min(5).max(2000), name }).parse({ token: form.get("token"), description: form.get("description"), name: form.get("name") });
    const { admin, job } = await load(d.token);
    if (["completed", "cancelled"].includes(job.status)) throw new Error("This job is closed");
    await admin.from("job_change_requests").insert({ organization_id: job.organization_id, job_id: job.id, description: `${d.description} (requested by ${d.name})`, price_delta_minor: 0, requested_by_party: "customer" });
    revalidatePath(`/share/jobs/${d.token}`);
    return null;
  }, "Request sent to the provider");
}

export async function customerConfirmCompletion(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const d = z.object({ token: z.string(), name, confirm: z.literal("on", { message: "Tick the box to confirm" }) }).parse({ token: form.get("token"), name: form.get("name"), confirm: form.get("confirm") });
    const { admin, job } = await load(d.token);
    if (job.status !== "awaiting_confirmation") throw new Error("The provider has not marked this job as ready for confirmation");
    await admin.from("service_jobs").update({ status: "completed", customer_confirmed_at: new Date().toISOString(), customer_confirmed_name: d.name }).eq("id", job.id).eq("status", "awaiting_confirmation");
    await audit(admin, job.organization_id, job.id, "job.customer_confirmed_completion", { name: d.name });
    revalidatePath(`/share/jobs/${d.token}`);
    return null;
  }, "Completion confirmed");
}

export async function customerMessage(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const d = z.object({ token: z.string(), body: z.string().trim().min(2).max(2000), name, kind: z.enum(["customer_message", "dispute_note"]) }).parse({ token: form.get("token"), body: form.get("body"), name: form.get("name"), kind: form.get("kind") || "customer_message" });
    const { admin, job } = await load(d.token);
    await admin.from("job_updates").insert({ organization_id: job.organization_id, job_id: job.id, kind: d.kind, body: d.body, author_party: "customer", author_name: d.name });
    revalidatePath(`/share/jobs/${d.token}`);
    return null;
  }, "Message added to the job record");
}
