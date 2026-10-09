"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/context";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { parseMajor } from "@/lib/money";
import { newToken } from "@/lib/domain/hash";
import { agreementHash, applyChange, tokenHash } from "@/lib/services/jobproof";
import { env } from "@/lib/env";

const uuid = z.string().uuid();
const opt = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v).trim());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function createJob(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const currency = z.string().regex(/^[A-Z]{3}$/).parse(form.get("currency"));
    const d = z.object({
      title: z.string().trim().min(2).max(200), customer_id: uuid.optional(), description: z.string().max(5000).optional(), location: z.string().max(300).optional(),
      deadline: date.optional(), warranty_terms: z.string().max(2000).optional(),
    }).parse({ title: form.get("title"), customer_id: opt(form.get("customer_id")), description: opt(form.get("description")), location: opt(form.get("location")), deadline: opt(form.get("deadline")), warranty_terms: opt(form.get("warranty_terms")) });
    const row = unwrap(await ws.supabase.from("service_jobs").insert({ ...d, currency, price_minor: parseMajor(String(form.get("price") || "0"), currency), organization_id: ws.org.organizationId, created_by: ws.user.id }).select("id").single()) as { id: string };
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "job.created", resourceType: "service_job", resourceId: row.id });
    revalidatePath("/app/jobs");
    return { id: row.id };
  }, "Job created");
}

export async function proposeAgreement(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ job_id: uuid, scope: z.string().trim().min(10, "Describe the agreed scope").max(8000), materials: z.string().max(4000).optional(), terms: z.string().max(4000).optional() })
      .parse({ job_id: form.get("job_id"), scope: form.get("scope"), materials: opt(form.get("materials")), terms: opt(form.get("terms")) });
    const org = ws.org.organizationId;
    const job = unwrap(await ws.supabase.from("service_jobs").select("currency, price_minor, deadline, status").eq("id", d.job_id).eq("organization_id", org).single()) as { currency: string; price_minor: number; deadline: string | null; status: string };
    if (["completed", "cancelled"].includes(job.status)) throw new Error(`Cannot change the agreement of a ${job.status} job`);
    const content = { scope: d.scope, materials: d.materials ?? null, currency: job.currency, price_minor: job.price_minor, deadline: job.deadline, terms: d.terms ?? null };
    const { data: last } = await ws.supabase.from("service_agreements").select("version").eq("job_id", d.job_id).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = (last?.version ?? 0) + 1;
    unwrap(await ws.supabase.from("service_agreements").insert({ ...content, organization_id: org, job_id: d.job_id, version, content_hash: agreementHash(content), provider_accepted_by: ws.user.id, provider_accepted_at: new Date().toISOString() }));
    unwrap(await ws.supabase.from("service_jobs").update({ status: "proposed" }).eq("id", d.job_id).eq("organization_id", org));
    await writeAudit(ws.supabase, { organizationId: org, actorUserId: ws.user.id, action: "agreement.proposed", resourceType: "service_job", resourceId: d.job_id, metadata: { version } });
    revalidatePath(`/app/jobs/${d.job_id}`);
    return null;
  }, "Agreement version proposed — share it with the customer to accept");
}

export async function createShareLink(_: ActionResult<{ url: string }> | null, form: FormData): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const id = uuid.parse(form.get("job_id"));
    const token = newToken(24);
    unwrap(await ws.supabase.from("service_jobs").update({ share_token_hash: tokenHash(token) }).eq("id", id).eq("organization_id", ws.org.organizationId));
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "job.share_link_created", resourceType: "service_job", resourceId: id });
    revalidatePath(`/app/jobs/${id}`);
    return { url: `${env().NEXT_PUBLIC_APP_URL}/share/jobs/${token}` };
  }, "New share link created. Any previous link no longer works.");
}

export async function revokeShareLink(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const id = uuid.parse(form.get("job_id"));
    unwrap(await ws.supabase.from("service_jobs").update({ share_token_hash: null }).eq("id", id).eq("organization_id", ws.org.organizationId));
    revalidatePath(`/app/jobs/${id}`);
    return null;
  }, "Share link revoked");
}

export async function addJobUpdate(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ job_id: uuid, kind: z.enum(["progress", "material", "additional_cost", "note", "completion", "dispute_note"]), body: z.string().trim().min(2).max(4000), amount: z.string().optional() })
      .parse({ job_id: form.get("job_id"), kind: form.get("kind"), body: form.get("body"), amount: opt(form.get("amount")) });
    const job = unwrap(await ws.supabase.from("service_jobs").select("currency").eq("id", d.job_id).eq("organization_id", ws.org.organizationId).single()) as { currency: string };
    unwrap(await ws.supabase.from("job_updates").insert({ organization_id: ws.org.organizationId, job_id: d.job_id, kind: d.kind, body: d.body, amount_minor: d.amount ? parseMajor(d.amount, job.currency) : null, author_party: "provider", author_name: ws.profile.full_name ?? ws.profile.email, created_by: ws.user.id }));
    revalidatePath(`/app/jobs/${d.job_id}`);
    return null;
  }, "Update recorded");
}

export async function proposeChange(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ job_id: uuid, description: z.string().trim().min(5).max(2000), delta: z.string().optional(), new_deadline: date.optional() })
      .parse({ job_id: form.get("job_id"), description: form.get("description"), delta: opt(form.get("delta")), new_deadline: opt(form.get("new_deadline")) });
    const job = unwrap(await ws.supabase.from("service_jobs").select("currency").eq("id", d.job_id).eq("organization_id", ws.org.organizationId).single()) as { currency: string };
    const sign = d.delta?.startsWith("-") ? -1 : 1;
    const delta = d.delta ? sign * parseMajor(d.delta.replace(/^[-+]/, ""), job.currency) : 0;
    unwrap(await ws.supabase.from("job_change_requests").insert({ organization_id: ws.org.organizationId, job_id: d.job_id, description: d.description, price_delta_minor: delta, new_deadline: d.new_deadline ?? null, requested_by_party: "provider", requested_by: ws.user.id }));
    revalidatePath(`/app/jobs/${d.job_id}`);
    return null;
  }, "Change request sent for the customer's approval");
}

/** Provider decides a change the customer proposed. */
export async function decideCustomerChange(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const { id, decision } = z.object({ id: uuid, decision: z.enum(["approved", "rejected"]) }).parse({ id: form.get("id"), decision: form.get("decision") });
    const org = ws.org.organizationId;
    const c = unwrap(await ws.supabase.from("job_change_requests").select("job_id, status, requested_by_party, price_delta_minor, new_deadline").eq("id", id).eq("organization_id", org).single()) as { job_id: string; status: string; requested_by_party: string; price_delta_minor: number; new_deadline: string | null };
    if (c.status !== "proposed" || c.requested_by_party !== "customer") throw new Error("Only open customer requests can be decided here");
    unwrap(await ws.supabase.from("job_change_requests").update({ status: decision, decided_by_party: "provider", decided_by_name: ws.profile.full_name ?? ws.profile.email, decided_at: new Date().toISOString() }).eq("id", id).eq("status", "proposed"));
    if (decision === "approved") await applyChange(ws.supabase, org, c.job_id, c);
    await writeAudit(ws.supabase, { organizationId: org, actorUserId: ws.user.id, action: `change_request.${decision}`, resourceType: "service_job", resourceId: c.job_id });
    revalidatePath(`/app/jobs/${c.job_id}`);
    return null;
  }, "Decision recorded");
}

export async function setJobStatus(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const { id, status } = z.object({ id: uuid, status: z.enum(["in_progress", "awaiting_confirmation", "disputed", "cancelled"]) }).parse({ id: form.get("id"), status: form.get("status") });
    const job = unwrap(await ws.supabase.from("service_jobs").select("status").eq("id", id).eq("organization_id", ws.org.organizationId).single()) as { status: string };
    const allowed: Record<string, string[]> = { in_progress: ["agreed", "disputed"], awaiting_confirmation: ["in_progress"], disputed: ["in_progress", "awaiting_confirmation", "agreed"], cancelled: ["draft", "proposed", "agreed", "in_progress"] };
    if (!allowed[status]!.includes(job.status)) throw new Error(`Cannot move a ${job.status.replace("_", " ")} job to ${status.replace("_", " ")}`);
    unwrap(await ws.supabase.from("service_jobs").update({ status }).eq("id", id).eq("organization_id", ws.org.organizationId));
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: `job.${status}`, resourceType: "service_job", resourceId: id });
    revalidatePath(`/app/jobs/${id}`);
    return null;
  }, "Job status updated");
}

export async function invoiceFromJob(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const id = uuid.parse(form.get("job_id"));
    const org = ws.org.organizationId;
    const job = unwrap(await ws.supabase.from("service_jobs").select("id, title, customer_id, currency, price_minor, invoice_id").eq("id", id).eq("organization_id", org).single()) as { id: string; title: string; customer_id: string | null; currency: string; price_minor: number; invoice_id: string | null };
    if (job.invoice_id) throw new Error("This job already has an invoice");
    if (!job.customer_id) throw new Error("Assign a customer to the job first");
    const number = unwrap(await ws.supabase.rpc("next_document_number", { p_org: org, p_kind: "invoice" })) as string;
    const inv = unwrap(await ws.supabase.from("invoices").insert({ organization_id: org, customer_id: job.customer_id, invoice_number: number, currency: job.currency, service_job_id: job.id, notes: `For job: ${job.title}`, created_by: ws.user.id }).select("id").single()) as { id: string };
    unwrap(await ws.supabase.from("invoice_items").insert({ organization_id: org, invoice_id: inv.id, description: job.title, quantity: 1, unit_price_minor: job.price_minor }));
    unwrap(await ws.supabase.from("service_jobs").update({ invoice_id: inv.id }).eq("id", job.id));
    revalidatePath(`/app/jobs/${id}`);
    return { id: inv.id };
  }, "Draft invoice created from the agreed price");
}
