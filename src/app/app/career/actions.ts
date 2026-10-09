"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspace, requirePermission } from "@/lib/auth/context";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { buildCoverLetter, buildCv, interviewQuestions, skillsGap, type CareerData } from "@/lib/domain/career";

const uuid = z.string().uuid();
const opt = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v).trim());
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function ctx() {
  const ws = await requirePermission("records.write");
  return { ws, base: { organization_id: ws.org.organizationId, user_id: ws.user.id } };
}

export async function saveProfile(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ws, base } = await ctx();
    const d = z.object({ headline: z.string().max(200).optional(), summary: z.string().max(3000).optional(), location: z.string().max(120).optional(), target_roles: z.array(z.string().max(80)).max(10) })
      .parse({ headline: opt(form.get("headline")), summary: opt(form.get("summary")), location: opt(form.get("location")), target_roles: String(form.get("target_roles") ?? "").split(",").map((s) => s.trim()).filter(Boolean) });
    unwrap(await ws.supabase.from("career_profiles").upsert({ ...base, ...d }, { onConflict: "organization_id,user_id" }));
    revalidatePath("/app/career");
    return null;
  }, "Profile saved");
}

export async function addSkill(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ws, base } = await ctx();
    const d = z.object({ name: z.string().trim().min(1).max(80), level: z.enum(["beginner", "intermediate", "advanced", "expert"]), years: z.coerce.number().min(0).max(60).optional(), evidence_note: z.string().max(500).optional() })
      .parse({ name: form.get("name"), level: form.get("level"), years: opt(form.get("years")), evidence_note: opt(form.get("evidence_note")) });
    unwrap(await ws.supabase.from("career_skills").upsert({ ...base, ...d }, { onConflict: "organization_id,user_id,name" }));
    revalidatePath("/app/career");
    return null;
  }, "Skill saved");
}

export async function removeRecord(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ws } = await ctx();
    const { table, id } = z.object({ table: z.enum(["career_skills", "employment_history", "credentials", "portfolio_projects", "application_documents"]), id: uuid }).parse({ table: form.get("table"), id: form.get("id") });
    unwrap(await ws.supabase.from(table).delete().eq("id", id).eq("user_id", ws.user.id).eq("organization_id", ws.org.organizationId));
    revalidatePath("/app/career");
    return null;
  }, "Removed");
}

export async function addEmployment(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ws, base } = await ctx();
    const d = z.object({ employer: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(200), start_date: date.optional(), end_date: date.optional(), description: z.string().max(3000).optional() })
      .parse({ employer: form.get("employer"), title: form.get("title"), start_date: opt(form.get("start_date")), end_date: opt(form.get("end_date")), description: opt(form.get("description")) });
    unwrap(await ws.supabase.from("employment_history").insert({ ...base, ...d }));
    revalidatePath("/app/career");
    return null;
  }, "Experience added");
}

export async function addCredential(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ws, base } = await ctx();
    const d = z.object({ name: z.string().trim().min(1).max(200), issuer: z.string().max(200).optional(), issued_on: date.optional(), expires_on: date.optional(), credential_url: z.string().url().optional() })
      .parse({ name: form.get("name"), issuer: opt(form.get("issuer")), issued_on: opt(form.get("issued_on")), expires_on: opt(form.get("expires_on")), credential_url: opt(form.get("credential_url")) });
    // Verification status starts as self-reported; TrustOS never marks issuer verification without an issuer integration.
    unwrap(await ws.supabase.from("credentials").insert({ ...base, ...d, verification_status: "self_reported" }));
    revalidatePath("/app/career");
    return null;
  }, "Credential added (self-reported)");
}

export async function addProject(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ws, base } = await ctx();
    const d = z.object({ title: z.string().trim().min(1).max(200), description: z.string().max(3000).optional(), role: z.string().max(120).optional(), outcomes: z.string().max(2000).optional(), url: z.string().url().optional(), skills: z.array(z.string().max(60)).max(20) })
      .parse({ title: form.get("title"), description: opt(form.get("description")), role: opt(form.get("role")), outcomes: opt(form.get("outcomes")), url: opt(form.get("url")), skills: String(form.get("skills") ?? "").split(",").map((s) => s.trim()).filter(Boolean) });
    unwrap(await ws.supabase.from("portfolio_projects").insert({ ...base, ...d, source: "manual" }));
    revalidatePath("/app/career");
    return null;
  }, "Project added — confirm its accuracy to use it as evidence");
}

export async function confirmProject(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ws } = await ctx();
    const id = uuid.parse(form.get("id"));
    unwrap(await ws.supabase.from("portfolio_projects").update({ confirmed_accurate: true, confirmed_at: new Date().toISOString() }).eq("id", id).eq("user_id", ws.user.id));
    revalidatePath("/app/career");
    return null;
  }, "Confirmed as accurate");
}

export async function importJobAsProject(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { ws, base } = await ctx();
    const id = uuid.parse(form.get("job_id"));
    const job = unwrap(await ws.supabase.from("service_jobs").select("id, title, description, status, customer_confirmed_at").eq("id", id).eq("organization_id", ws.org.organizationId).single()) as { id: string; title: string; description: string | null; status: string; customer_confirmed_at: string | null };
    if (job.status !== "completed") throw new Error("Only completed jobs can become portfolio evidence");
    unwrap(await ws.supabase.from("portfolio_projects").insert({ ...base, title: job.title, description: job.description, outcomes: job.customer_confirmed_at ? "Completion confirmed by the customer in JobProof." : null, source: "jobproof", source_id: job.id, confirmed_accurate: false }));
    revalidatePath("/app/career");
    return null;
  }, "Imported — review and confirm before using it");
}

export async function saveApplication(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const { ws, base } = await ctx();
    const d = z.object({
      company: z.string().trim().min(1).max(200), role_title: z.string().trim().min(1).max(200), job_url: z.string().url().optional(), job_description: z.string().max(20000).optional(),
      status: z.enum(["saved", "preparing", "applied", "interviewing", "offer", "rejected", "withdrawn"]).default("saved"), follow_up_on: date.optional(), notes: z.string().max(3000).optional(),
      submission_confirmation: z.string().max(500).optional(), interview_at: z.string().optional(),
    }).parse({
      company: form.get("company"), role_title: form.get("role_title"), job_url: opt(form.get("job_url")), job_description: opt(form.get("job_description")), status: opt(form.get("status")),
      follow_up_on: opt(form.get("follow_up_on")), notes: opt(form.get("notes")), submission_confirmation: opt(form.get("submission_confirmation")), interview_at: opt(form.get("interview_at")),
    });
    if (d.status === "applied" && !d.submission_confirmation) {
      throw new z.ZodError([{ code: "custom", path: ["submission_confirmation"], message: "Record how you submitted (e.g. confirmation email or reference) — TrustOS only marks applications as applied with your confirmation", input: undefined }]);
    }
    const row = { ...d, interview_at: d.interview_at ? new Date(d.interview_at).toISOString() : null, applied_at: d.status === "applied" ? new Date().toISOString() : undefined };
    const id = opt(form.get("id"));
    if (id) {
      unwrap(await ws.supabase.from("job_applications").update(row).eq("id", id).eq("user_id", ws.user.id));
      revalidatePath("/app/career");
      return { id };
    }
    const created = unwrap(await ws.supabase.from("job_applications").insert({ ...base, ...row }).select("id").single()) as { id: string };
    revalidatePath("/app/career");
    return { id: created.id };
  }, "Application saved");
}

async function loadCareerData(): Promise<{ ws: Awaited<ReturnType<typeof getWorkspace>>; data: CareerData }> {
  const ws = await getWorkspace();
  const o = ws.org.organizationId;
  const u = ws.user.id;
  const [cp, skills, emp, creds, projects] = await Promise.all([
    ws.supabase.from("career_profiles").select("*").eq("organization_id", o).eq("user_id", u).maybeSingle(),
    ws.supabase.from("career_skills").select("name, level, years").eq("organization_id", o).eq("user_id", u),
    ws.supabase.from("employment_history").select("employer, title, start_date, end_date, description").eq("organization_id", o).eq("user_id", u).order("start_date", { ascending: false }),
    ws.supabase.from("credentials").select("name, issuer, issued_on, verification_status").eq("organization_id", o).eq("user_id", u),
    ws.supabase.from("portfolio_projects").select("title, description, outcomes, url, confirmed_accurate").eq("organization_id", o).eq("user_id", u),
  ]);
  return {
    ws,
    data: {
      fullName: ws.profile.full_name ?? ws.profile.email, email: ws.profile.email, headline: cp.data?.headline, summary: cp.data?.summary, location: cp.data?.location,
      skills: skills.data ?? [], employment: emp.data ?? [], credentials: creds.data ?? [], projects: projects.data ?? [],
    },
  };
}

export async function generateDocuments(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    await requirePermission("records.write");
    const id = uuid.parse(form.get("application_id"));
    const kinds = form.getAll("kind").map(String);
    const { ws, data } = await loadCareerData();
    if (!data.skills.length && !data.employment.length) throw new Error("Add skills or experience first — TrustOS will not invent your history.");
    const app = unwrap(await ws.supabase.from("job_applications").select("id, company, role_title, job_description").eq("id", id).eq("user_id", ws.user.id).single()) as { id: string; company: string; role_title: string; job_description: string | null };
    const gap = skillsGap(app.job_description ?? "", data.skills);
    const docs: { kind: string; title: string; content: string }[] = [];
    if (kinds.includes("cv")) docs.push({ kind: "cv", title: `CV — ${app.role_title}`, content: buildCv(data, gap.matched) });
    if (kinds.includes("cover_letter")) docs.push({ kind: "cover_letter", title: `Cover letter — ${app.company}`, content: buildCoverLetter(data, app, gap.matched) });
    if (kinds.includes("interview_prep")) docs.push({ kind: "interview_prep", title: `Interview prep — ${app.company}`, content: interviewQuestions(app, gap.missing).map((q, i) => `${i + 1}. ${q}`).join("\n\n") });
    if (kinds.includes("skills_gap")) docs.push({ kind: "skills_gap", title: `Skills gap — ${app.role_title}`, content: app.job_description ? `Method: keyword overlap (approximate).\nCoverage: ${gap.coveragePct}%\n\nMatched: ${gap.matched.join(", ") || "—"}\n\nNot found in your skills: ${gap.missing.join(", ") || "—"}\n\nThese are keywords from the posting, not confirmed requirements. Review before acting.` : "Add the job description to run a skills-gap analysis." });
    if (!docs.length) throw new Error("Choose at least one document");
    unwrap(await ws.supabase.from("application_documents").insert(docs.map((d) => ({ ...d, organization_id: ws.org.organizationId, user_id: ws.user.id, application_id: id, generated_by: "template" }))));
    await ws.supabase.from("job_applications").update({ status: "preparing" }).eq("id", id).eq("status", "saved");
    revalidatePath("/app/career");
    return null;
  }, "Drafts created from your own records — review before using");
}
