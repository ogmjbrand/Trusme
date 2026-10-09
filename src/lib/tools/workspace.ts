import "server-only";
import { z } from "zod";
import { buildCoverLetter, buildCv, skillsGap, type CareerData } from "@/lib/domain/career";
import { classifyIdea, launchPlan } from "@/lib/domain/launch";
import { addDays } from "@/lib/domain/cashflow";
import { ToolError, type ToolDefinition } from "@/lib/execution/types";
import { must, today, type AppToolContext } from "./context";

// ---------------------------------------------------------------------------
// Workspace overview (used by planners and the command center)
// ---------------------------------------------------------------------------
export const workspaceSummary: ToolDefinition<Record<string, never>, { counts: Record<string, number> }, AppToolContext> = {
  id: "workspace.summary",
  title: "Summarize workspace data",
  description: "Counts records in each module so the plan can tell the user what data exists. Read-only.",
  module: "core",
  sideEffect: "read",
  inputSchema: z.object({}).strict() as unknown as z.ZodType<Record<string, never>>,
  outputSchema: z.object({ counts: z.record(z.string(), z.number()) }),
  minRole: "viewer",
  retry: { maxAttempts: 3, idempotent: true },
  timeoutMs: 15_000,
  summarize: () => "Count records in each module",
  async run(ctx) {
    const tables = ["customers", "invoices", "products", "suppliers", "sales", "expenses", "service_jobs", "risk_assessments", "launch_projects", "recurring_obligations"];
    const counts: Record<string, number> = {};
    await Promise.all(
      tables.map(async (t) => {
        const r = await ctx.db.from(t).select("id", { count: "exact", head: true }).eq("organization_id", ctx.orgId);
        if (r.error) throw new Error(r.error.message);
        counts[t] = r.count ?? 0;
      }),
    );
    return { output: { counts }, outcome: "analyzed" };
  },
};

// ---------------------------------------------------------------------------
// CareerVault
// ---------------------------------------------------------------------------
async function loadCareer(ctx: AppToolContext): Promise<CareerData> {
  const uid = ctx.actorUserId;
  const [profile, cp, skills, employment, credentials, projects] = await Promise.all([
    ctx.db.from("profiles").select("full_name, email").eq("id", uid).single(),
    ctx.db.from("career_profiles").select("headline, summary, location").eq("organization_id", ctx.orgId).eq("user_id", uid).maybeSingle(),
    ctx.db.from("career_skills").select("name, level, years").eq("organization_id", ctx.orgId).eq("user_id", uid),
    ctx.db.from("employment_history").select("employer, title, start_date, end_date, description").eq("organization_id", ctx.orgId).eq("user_id", uid).order("start_date", { ascending: false }),
    ctx.db.from("credentials").select("name, issuer, issued_on, verification_status").eq("organization_id", ctx.orgId).eq("user_id", uid),
    ctx.db.from("portfolio_projects").select("title, description, outcomes, url, confirmed_accurate").eq("organization_id", ctx.orgId).eq("user_id", uid),
  ]);
  const p = must(profile, "profile") as { full_name: string | null; email: string };
  const c = must(cp, "career profile") as { headline: string | null; summary: string | null; location: string | null } | null;
  return {
    fullName: p.full_name ?? p.email,
    email: p.email,
    headline: c?.headline,
    summary: c?.summary,
    location: c?.location,
    skills: must(skills, "skills") as CareerData["skills"],
    employment: must(employment, "employment") as CareerData["employment"],
    credentials: must(credentials, "credentials") as CareerData["credentials"],
    projects: must(projects, "projects") as CareerData["projects"],
  };
}

async function loadApplication(ctx: AppToolContext, id: string) {
  const app = must(
    await ctx.db.from("job_applications").select("id, company, role_title, job_description").eq("organization_id", ctx.orgId).eq("user_id", ctx.actorUserId).eq("id", id).maybeSingle(),
    "application",
  ) as { id: string; company: string; role_title: string; job_description: string | null } | null;
  if (!app) throw new ToolError("Application not found in your CareerVault", { code: "not_found" });
  return app;
}

export const careerSkillsGap: ToolDefinition<{ applicationId: string }, { company: string; role: string; coveragePct: number; matched: string[]; missing: string[]; method: string }, AppToolContext> = {
  id: "career.skills_gap",
  title: "Analyze skills gap",
  description: "Compares the user's recorded skills with a saved job application's description using keyword overlap. Read-only.",
  module: "careervault",
  sideEffect: "read",
  inputSchema: z.object({ applicationId: z.string().uuid() }),
  outputSchema: z.object({ company: z.string(), role: z.string(), coveragePct: z.number(), matched: z.array(z.string()), missing: z.array(z.string()), method: z.string() }),
  minRole: "viewer",
  retry: { maxAttempts: 2, idempotent: true },
  timeoutMs: 15_000,
  summarize: () => "Compare your skills with the job description",
  async run(ctx, input) {
    const app = await loadApplication(ctx, input.applicationId);
    if (!app.job_description) throw new ToolError("Add the job description to this application first", { code: "missing_job_description" });
    const career = await loadCareer(ctx);
    const gap = skillsGap(app.job_description, career.skills);
    return { output: { company: app.company, role: app.role_title, coveragePct: gap.coveragePct, matched: gap.matched, missing: gap.missing, method: gap.method }, outcome: "analyzed", refs: [{ type: "job_application", id: app.id, label: `${app.role_title} · ${app.company}`, href: `/app/career?application=${app.id}` }] };
  },
};

export const careerDraftDocuments: ToolDefinition<{ applicationId: string }, { documentIds: string[] }, AppToolContext> = {
  id: "career.draft_documents",
  title: "Draft CV and cover letter",
  description: "Builds a tailored CV and cover letter draft from the user's own CareerVault records only (no invented history). Saves them as application documents.",
  module: "careervault",
  sideEffect: "reversible_write",
  inputSchema: z.object({ applicationId: z.string().uuid() }),
  outputSchema: z.object({ documentIds: z.array(z.string()) }),
  minRole: "member",
  retry: { maxAttempts: 2, idempotent: true },
  timeoutMs: 20_000,
  summarize: () => "Draft a tailored CV and cover letter for the application",
  async run(ctx, input) {
    const app = await loadApplication(ctx, input.applicationId);
    const career = await loadCareer(ctx);
    if (!career.skills.length && !career.employment.length) {
      throw new ToolError("Your CareerVault has no skills or employment history yet. Add them first — TrustOS will not invent experience.", { code: "insufficient_data" });
    }
    const gap = skillsGap(app.job_description ?? "", career.skills);
    const docs = [
      { kind: "cv", title: `CV — ${app.role_title} at ${app.company}`, content: buildCv(career, gap.matched) },
      { kind: "cover_letter", title: `Cover letter — ${app.company}`, content: buildCoverLetter(career, app, gap.matched) },
    ];
    const ids: string[] = [];
    for (const d of docs) {
      const key = `${ctx.idempotencyKey}:${d.kind}`;
      must(await ctx.db.from("application_documents").upsert({ organization_id: ctx.orgId, user_id: ctx.actorUserId, application_id: app.id, kind: d.kind, title: d.title, content: d.content, generated_by: "template", idempotency_key: key }, { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true }), "save document");
      const row = must(await ctx.db.from("application_documents").select("id").eq("organization_id", ctx.orgId).eq("idempotency_key", key).single(), "read document") as { id: string };
      ids.push(row.id);
    }
    await ctx.db.from("job_applications").update({ status: "preparing" }).eq("id", app.id).eq("status", "saved");
    return { output: { documentIds: ids }, outcome: "prepared", refs: [{ type: "job_application", id: app.id, label: "Review drafts", href: `/app/career?application=${app.id}` }] };
  },
};

// ---------------------------------------------------------------------------
// LaunchReady
// ---------------------------------------------------------------------------
export const launchCreatePlan: ToolDefinition<{ name: string; idea: string; targetLaunchDate?: string }, { projectId: string; category: string; taskCount: number; verificationTasks: number }, AppToolContext> = {
  id: "launch.create_plan",
  title: "Create launch plan",
  description: "Classifies a business idea and creates a launch project with a checklist. Regulatory tasks link to official authority sites and are marked 'verify at source'.",
  module: "launchready",
  sideEffect: "reversible_write",
  inputSchema: z.object({ name: z.string().min(2).max(120), idea: z.string().min(10).max(4000), targetLaunchDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
  outputSchema: z.object({ projectId: z.string(), category: z.string(), taskCount: z.number(), verificationTasks: z.number() }),
  minRole: "member",
  retry: { maxAttempts: 2, idempotent: true },
  timeoutMs: 20_000,
  summarize: (i) => `Create launch project "${i.name}" with a starter checklist`,
  async run(ctx, input) {
    const key = ctx.idempotencyKey;
    const existing = must(await ctx.db.from("launch_projects").select("id, product_category").eq("organization_id", ctx.orgId).eq("idempotency_key", key).maybeSingle(), "find project") as { id: string; product_category: string } | null;
    const cls = classifyIdea(input.idea);
    const tasks = launchPlan(cls.category);
    let projectId = existing?.id;
    if (!projectId) {
      const p = must(await ctx.db.from("launch_projects").insert({ organization_id: ctx.orgId, name: input.name, idea: input.idea, product_category: cls.category, classification: cls, target_launch_date: input.targetLaunchDate ?? null, idempotency_key: key, created_by: ctx.actorUserId }).select("id").single(), "create project") as { id: string };
      projectId = p.id;
      const sources = must(await ctx.db.from("regulatory_sources").select("id, authority").is("organization_id", null), "sources") as { id: string; authority: string }[];
      const start = today(ctx);
      must(await ctx.db.from("launch_tasks").insert(tasks.map((t, i) => ({
        organization_id: ctx.orgId, project_id: projectId, title: t.title, description: t.description, category: t.category,
        due_on: addDays(start, t.offsetDays), regulatory_source_id: sources.find((s) => s.authority === t.authority)?.id ?? null,
        needs_verification: t.needsVerification, requires_expert: t.requiresExpert, position: i,
      }))), "create tasks");
      await ctx.audit("launch_project.created", "launch_project", projectId, { category: cls.category });
    }
    return {
      output: { projectId, category: cls.category, taskCount: tasks.length, verificationTasks: tasks.filter((t) => t.needsVerification).length },
      outcome: existing ? "no_op" : "created",
      refs: [{ type: "launch_project", id: projectId, label: input.name, href: `/app/launch/${projectId}` }],
    };
  },
};

// ---------------------------------------------------------------------------
// JobProof & CareerVault summaries (read-only)
// ---------------------------------------------------------------------------
const jobItem = z.object({ jobId: z.string(), title: z.string(), status: z.string(), paymentStatus: z.string(), deadline: z.string().nullable(), reason: z.string() });

export const jobsAttention: ToolDefinition<{ deadlineWithinDays: number }, { items: z.infer<typeof jobItem>[] }, AppToolContext> = {
  id: "jobs.attention_report",
  title: "Review service jobs needing attention",
  description: "Lists JobProof jobs that are disputed, awaiting customer confirmation, completed but unpaid, awaiting agreement, or near/over their deadline. Read-only.",
  module: "jobproof",
  sideEffect: "read",
  inputSchema: z.object({ deadlineWithinDays: z.number().int().min(0).max(60).default(3) }),
  outputSchema: z.object({ items: z.array(jobItem) }),
  minRole: "viewer",
  retry: { maxAttempts: 3, idempotent: true },
  timeoutMs: 15_000,
  summarize: (i) => `Review jobs needing attention (deadlines within ${i.deadlineWithinDays} days)`,
  async run(ctx, input) {
    const jobs = must(await ctx.db.from("service_jobs").select("id, title, status, payment_status, deadline").eq("organization_id", ctx.orgId).not("status", "in", "(cancelled)").limit(500), "jobs") as { id: string; title: string; status: string; payment_status: string; deadline: string | null }[];
    const horizon = addDays(today(ctx), input.deadlineWithinDays);
    const items = jobs
      .map((j) => {
        const reason =
          j.status === "disputed" ? "Disputed — review the record and dispute notes"
          : j.status === "awaiting_confirmation" ? "Waiting for the customer to confirm completion"
          : j.status === "completed" && j.payment_status !== "paid" ? `Completed but ${j.payment_status.replace("_", " ")}`
          : j.status === "proposed" ? "Agreement proposed; customer has not accepted"
          : j.deadline && ["agreed", "in_progress"].includes(j.status) && j.deadline <= horizon ? (j.deadline < today(ctx) ? "Past its deadline" : "Deadline approaching")
          : null;
        return reason ? { jobId: j.id, title: j.title, status: j.status, paymentStatus: j.payment_status, deadline: j.deadline, reason } : null;
      })
      .filter((x): x is z.infer<typeof jobItem> => x !== null);
    return { output: { items }, outcome: "analyzed", refs: items.slice(0, 10).map((i) => ({ type: "service_job", id: i.jobId, label: i.title, href: `/app/jobs/${i.jobId}` })) };
  },
};

const appItem = z.object({ applicationId: z.string(), company: z.string(), role: z.string(), status: z.string(), followUpOn: z.string().nullable(), interviewAt: z.string().nullable(), reason: z.string() });

export const careerFollowUps: ToolDefinition<{ withinDays: number }, { items: z.infer<typeof appItem>[] }, AppToolContext> = {
  id: "career.follow_ups",
  title: "Check application follow-ups",
  description: "Lists the requesting user's job applications with follow-ups due or interviews coming up. Private to that user. Read-only.",
  module: "careervault",
  sideEffect: "read",
  inputSchema: z.object({ withinDays: z.number().int().min(0).max(60).default(7) }),
  outputSchema: z.object({ items: z.array(appItem) }),
  minRole: "viewer",
  retry: { maxAttempts: 3, idempotent: true },
  timeoutMs: 15_000,
  summarize: (i) => `Check your application follow-ups and interviews in the next ${i.withinDays} days`,
  async run(ctx, input) {
    const apps = must(await ctx.db.from("job_applications").select("id, company, role_title, status, follow_up_on, interview_at").eq("organization_id", ctx.orgId).eq("user_id", ctx.actorUserId).not("status", "in", "(rejected,withdrawn,offer)"), "applications") as { id: string; company: string; role_title: string; status: string; follow_up_on: string | null; interview_at: string | null }[];
    const horizon = addDays(today(ctx), input.withinDays);
    const items = apps
      .map((a) => {
        const reason = a.interview_at && a.interview_at.slice(0, 10) >= today(ctx) && a.interview_at.slice(0, 10) <= horizon ? "Interview coming up — prepare" : a.follow_up_on && a.follow_up_on <= horizon ? (a.follow_up_on < today(ctx) ? "Follow-up overdue" : "Follow-up due soon") : null;
        return reason ? { applicationId: a.id, company: a.company, role: a.role_title, status: a.status, followUpOn: a.follow_up_on, interviewAt: a.interview_at, reason } : null;
      })
      .filter((x): x is z.infer<typeof appItem> => x !== null);
    return { output: { items }, outcome: "analyzed", refs: items.map((i) => ({ type: "job_application", id: i.applicationId, label: `${i.role} · ${i.company}`, href: `/app/career?application=${i.applicationId}` })) };
  },
};
