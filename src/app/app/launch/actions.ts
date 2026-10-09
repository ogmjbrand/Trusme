"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/context";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { parseMajor } from "@/lib/money";
import { classifyIdea, launchPlan, LABEL_CHECKLIST_PROMPTS, type ProductCategory } from "@/lib/domain/launch";
import { addDays } from "@/lib/domain/cashflow";

const uuid = z.string().uuid();
const opt = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v).trim());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const CATEGORIES = ["food_beverage", "cosmetics", "drugs_health", "electrical", "chemicals", "services", "general_goods"] as const;

export async function createLaunchProject(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const currency = z.string().regex(/^[A-Z]{3}$/).parse(form.get("currency") || ws.org.defaultCurrency);
    const d = z.object({ name: z.string().trim().min(2).max(120), idea: z.string().trim().min(10).max(4000), target_launch_date: date.optional(), category: z.enum(CATEGORIES).optional(), budget: z.string().optional() })
      .parse({ name: form.get("name"), idea: form.get("idea"), target_launch_date: opt(form.get("target_launch_date")), category: opt(form.get("category")), budget: opt(form.get("budget")) });
    const auto = classifyIdea(d.idea);
    const category: ProductCategory = d.category ?? auto.category;
    const org = ws.org.organizationId;
    const p = unwrap(await ws.supabase.from("launch_projects").insert({
      organization_id: org, name: d.name, idea: d.idea, product_category: category, classification: { ...auto, confirmed_by_user: Boolean(d.category), chosen: category },
      target_launch_date: d.target_launch_date ?? null, currency, budget_minor: d.budget ? parseMajor(d.budget, currency) : null, created_by: ws.user.id,
    }).select("id").single()) as { id: string };
    const { data: sources } = await ws.supabase.from("regulatory_sources").select("id, authority").is("organization_id", null);
    const today = new Date().toISOString().slice(0, 10);
    unwrap(await ws.supabase.from("launch_tasks").insert(launchPlan(category).map((t, i) => ({
      organization_id: org, project_id: p.id, title: t.title, description: t.description, category: t.category, due_on: addDays(today, t.offsetDays),
      regulatory_source_id: (sources ?? []).find((s) => s.authority === t.authority)?.id ?? null, needs_verification: t.needsVerification, requires_expert: t.requiresExpert, position: i,
    }))));
    await writeAudit(ws.supabase, { organizationId: org, actorUserId: ws.user.id, action: "launch_project.created", resourceType: "launch_project", resourceId: p.id, metadata: { category } });
    revalidatePath("/app/launch");
    return { id: p.id };
  }, "Launch plan created");
}

export async function updateTask(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ id: uuid, status: z.enum(["todo", "in_progress", "blocked", "done"]) }).parse({ id: form.get("id"), status: form.get("status") });
    const t = unwrap(await ws.supabase.from("launch_tasks").update({ status: d.status }).eq("id", d.id).eq("organization_id", ws.org.organizationId).select("project_id").single()) as { project_id: string };
    revalidatePath(`/app/launch/${t.project_id}`);
    return null;
  });
}

export async function addTask(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ project_id: uuid, title: z.string().trim().min(2).max(200), category: z.enum(["registration", "compliance", "product", "labeling", "suppliers", "marketing", "finance", "operations"]), due_on: date.optional() })
      .parse({ project_id: form.get("project_id"), title: form.get("title"), category: form.get("category"), due_on: opt(form.get("due_on")) });
    unwrap(await ws.supabase.from("launch_tasks").insert({ ...d, organization_id: ws.org.organizationId, position: 999 }));
    revalidatePath(`/app/launch/${d.project_id}`);
    return null;
  }, "Task added");
}

export async function saveApplicationStatus(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({
      id: uuid.optional(), project_id: uuid, authority: z.string().trim().min(2).max(60), application_type: z.string().trim().min(2).max(120),
      reference_number: z.string().max(120).optional(), status: z.enum(["preparing", "submitted_by_user", "under_review", "query_raised", "approved", "rejected"]), submitted_on: date.optional(), notes: z.string().max(2000).optional(),
    }).parse({ id: opt(form.get("id")), project_id: form.get("project_id"), authority: form.get("authority"), application_type: form.get("application_type"), reference_number: opt(form.get("reference_number")), status: form.get("status"), submitted_on: opt(form.get("submitted_on")), notes: opt(form.get("notes")) });
    const { id, ...row } = d;
    const patch = { ...row, last_checked_on: new Date().toISOString().slice(0, 10) };
    if (id) unwrap(await ws.supabase.from("launch_applications").update(patch).eq("id", id).eq("organization_id", ws.org.organizationId));
    else unwrap(await ws.supabase.from("launch_applications").insert({ ...patch, organization_id: ws.org.organizationId }));
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "launch_application.updated", resourceType: "launch_project", resourceId: d.project_id, metadata: { authority: d.authority, status: d.status } });
    revalidatePath(`/app/launch/${d.project_id}`);
    return null;
  }, "Application status recorded (as reported by you)");
}

export async function startLabelReview(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ project_id: uuid, label_text: z.string().max(8000).optional() }).parse({ project_id: form.get("project_id"), label_text: opt(form.get("label_text")) });
    const checklist = LABEL_CHECKLIST_PROMPTS.map((item) => ({ item, present: null as boolean | null, source_url: null as string | null }));
    unwrap(await ws.supabase.from("label_reviews").insert({ ...d, checklist, organization_id: ws.org.organizationId, created_by: ws.user.id }));
    revalidatePath(`/app/launch/${d.project_id}`);
    return null;
  }, "Label review started");
}

export async function updateLabelReview(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const id = uuid.parse(form.get("id"));
    const r = unwrap(await ws.supabase.from("label_reviews").select("project_id, checklist").eq("id", id).eq("organization_id", ws.org.organizationId).single()) as { project_id: string; checklist: { item: string; present: boolean | null; source_url: string | null }[] };
    const checklist = r.checklist.map((c, i) => ({ ...c, present: form.get(`present_${i}`) === "on", source_url: opt(form.get(`source_${i}`)) ?? null }));
    const status = z.enum(["in_review", "changes_needed", "ready_for_expert", "expert_approved"]).parse(form.get("status"));
    unwrap(await ws.supabase.from("label_reviews").update({ checklist, status, reviewer_note: opt(form.get("reviewer_note")) ?? null }).eq("id", id));
    revalidatePath(`/app/launch/${r.project_id}`);
    return null;
  }, "Label review saved");
}

export async function addExpertHandoff(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ project_id: uuid, expert_name: z.string().trim().min(2).max(120), expertise: z.string().trim().min(2).max(120), contact: z.string().max(200).optional(), scope: z.string().trim().min(5).max(2000) })
      .parse({ project_id: form.get("project_id"), expert_name: form.get("expert_name"), expertise: form.get("expertise"), contact: opt(form.get("contact")), scope: form.get("scope") });
    unwrap(await ws.supabase.from("expert_handoffs").insert({ ...d, organization_id: ws.org.organizationId }));
    revalidatePath(`/app/launch/${d.project_id}`);
    return null;
  }, "Expert handoff recorded");
}

export async function linkSupplier(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ project_id: uuid, supplier_id: uuid, role: z.string().max(120).optional() }).parse({ project_id: form.get("project_id"), supplier_id: form.get("supplier_id"), role: opt(form.get("role")) });
    unwrap(await ws.supabase.from("launch_suppliers").upsert({ ...d, organization_id: ws.org.organizationId }, { onConflict: "project_id,supplier_id" }));
    revalidatePath(`/app/launch/${d.project_id}`);
    return null;
  }, "Supplier linked");
}

export async function setStage(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ id: uuid, stage: z.enum(["idea", "planning", "registering", "pre_launch", "launched", "paused"]) }).parse({ id: form.get("id"), stage: form.get("stage") });
    unwrap(await ws.supabase.from("launch_projects").update({ stage: d.stage }).eq("id", d.id).eq("organization_id", ws.org.organizationId));
    revalidatePath(`/app/launch/${d.id}`);
    return null;
  }, "Stage updated");
}
