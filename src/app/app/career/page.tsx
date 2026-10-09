import Link from "next/link";
import { Briefcase } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { skillsGap } from "@/lib/domain/career";
import { PageHeader, EmptyState, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ActionForm, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { fmtDate, todayIso } from "@/lib/format";
import { cn } from "@/lib/cn";
import { addCredential, addEmployment, addProject, addSkill, confirmProject, generateDocuments, importJobAsProject, removeRecord, saveApplication, saveProfile } from "./actions";

export const metadata = { title: "CareerVault" };
const TABS = ["applications", "profile", "experience", "portfolio"] as const;
const STATUSES = ["saved", "preparing", "applied", "interviewing", "offer", "rejected", "withdrawn"];

export default async function CareerPage({ searchParams }: { searchParams: Promise<{ tab?: string; application?: string }> }) {
  const sp = await searchParams;
  const tab = sp.application ? "applications" : (sp.tab ?? "applications");
  const ws = await getWorkspace();
  const o = ws.org.organizationId;
  const u = ws.user.id;
  const [profile, skills, emp, creds, projects, apps, jobs] = await Promise.all([
    ws.supabase.from("career_profiles").select("*").eq("organization_id", o).eq("user_id", u).maybeSingle(),
    ws.supabase.from("career_skills").select("*").eq("organization_id", o).eq("user_id", u).order("name"),
    ws.supabase.from("employment_history").select("*").eq("organization_id", o).eq("user_id", u).order("start_date", { ascending: false }),
    ws.supabase.from("credentials").select("*").eq("organization_id", o).eq("user_id", u).order("issued_on", { ascending: false }),
    ws.supabase.from("portfolio_projects").select("*").eq("organization_id", o).eq("user_id", u).order("created_at", { ascending: false }),
    ws.supabase.from("job_applications").select("*").eq("organization_id", o).eq("user_id", u).order("updated_at", { ascending: false }),
    ws.supabase.from("service_jobs").select("id, title").eq("organization_id", o).eq("status", "completed").limit(50),
  ]);
  const canWrite = can(ws.role, "records.write");
  const selected = sp.application ? (apps.data ?? []).find((a) => a.id === sp.application) : null;
  const docs = selected ? (await ws.supabase.from("application_documents").select("*").eq("application_id", selected.id).order("created_at", { ascending: false })).data ?? [] : [];
  const gap = selected?.job_description ? skillsGap(selected.job_description, skills.data ?? []) : null;
  const dueFollowUps = (apps.data ?? []).filter((a) => a.follow_up_on && a.follow_up_on <= todayIso() && !["rejected", "withdrawn", "offer"].includes(a.status));

  return (
    <>
      <PageHeader eyebrow="CareerVault" title="Career workspace" description="Your skills, evidence and applications. Documents are assembled only from what you record here — TrustOS never invents experience or qualifications. This data is private to you." />
      {dueFollowUps.length ? <Notice tone="warning" className="mb-4" title="Follow-ups due">{dueFollowUps.map((a) => `${a.role_title} at ${a.company}`).join("; ")}</Notice> : null}
      <nav className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => <Link key={t} href={`/app/career?tab=${t}`} className={cn("rounded-lg border px-3 py-1.5 text-xs capitalize", tab === t ? "border-brand/40 bg-brand-soft text-brand" : "border-line text-fg-muted hover:text-fg")}>{t}</Link>)}
      </nav>

      {tab === "applications" ? (
        <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
          <Card>
            <CardHeader title="Applications" actions={<Link href="/app/career?tab=applications" className="text-xs text-fg-muted hover:text-fg">New</Link>} />
            {(apps.data ?? []).length ? (
              <ul className="divide-y divide-line">
                {(apps.data ?? []).map((a) => (
                  <li key={a.id}><Link href={`/app/career?application=${a.id}`} className={cn("block px-5 py-3 text-sm hover:bg-surface-2/60", selected?.id === a.id && "bg-surface-2")}><div className="font-medium">{a.role_title}</div><div className="flex items-center gap-2 text-xs text-fg-subtle">{a.company} <StatusBadge status={a.status} /></div></Link></li>
                ))}
              </ul>
            ) : <EmptyState icon={Briefcase} title="No applications yet" />}
          </Card>
          <div className="space-y-6">
            {canWrite ? (
              <Card>
                <CardHeader title={selected ? `${selected.role_title} · ${selected.company}` : "Track a new application"} description={selected ? "Submission happens on the employer's site; record the confirmation here." : "No job-board integration is configured, so discovery and submission are manual."} />
                <CardBody>
                  <ActionForm key={selected?.id ?? "new"} action={saveApplication} redirectTo={(d) => `/app/career?application=${d.id}`} className="grid gap-3 sm:grid-cols-2">
                    {selected ? <input type="hidden" name="id" value={selected.id} /> : null}
                    <Field label="Company" htmlFor="ac"><Input id="ac" name="company" defaultValue={selected?.company} required /></Field>
                    <Field label="Role" htmlFor="ar"><Input id="ar" name="role_title" defaultValue={selected?.role_title} required /></Field>
                    <Field label="Job link" htmlFor="au"><Input id="au" name="job_url" type="url" defaultValue={selected?.job_url ?? ""} /></Field>
                    <Field label="Status" htmlFor="as"><Select id="as" name="status" defaultValue={selected?.status ?? "saved"}>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
                    <Field label="Job description" htmlFor="ad" className="sm:col-span-2"><Textarea id="ad" name="job_description" defaultValue={selected?.job_description ?? ""} className="min-h-28" /></Field>
                    <Field label="Submission confirmation" htmlFor="asc" hint="Required when marking as applied (e.g. confirmation email subject or reference)"><Input id="asc" name="submission_confirmation" defaultValue={selected?.submission_confirmation ?? ""} /></Field>
                    <Field label="Follow up on" htmlFor="af"><Input id="af" name="follow_up_on" type="date" defaultValue={selected?.follow_up_on ?? ""} /></Field>
                    <Field label="Interview at" htmlFor="ai"><Input id="ai" name="interview_at" type="datetime-local" defaultValue={selected?.interview_at ? selected.interview_at.slice(0, 16) : ""} /></Field>
                    <Field label="Notes" htmlFor="an"><Input id="an" name="notes" defaultValue={selected?.notes ?? ""} /></Field>
                    <SubmitButton className="sm:col-span-2">{selected ? "Save changes" : "Add application"}</SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
            ) : null}
            {selected ? (
              <>
                {gap ? (
                  <Card>
                    <CardHeader title={`Skills match: ${gap.coveragePct}%`} description="Keyword overlap between the posting and your recorded skills (approximate)." />
                    <CardBody className="space-y-2 text-sm">
                      <div className="flex flex-wrap gap-1">{gap.matched.map((m) => <Badge key={m} tone="brand">{m}</Badge>)}</div>
                      <div className="flex flex-wrap gap-1">{gap.missing.map((m) => <Badge key={m}>{m}</Badge>)}</div>
                    </CardBody>
                  </Card>
                ) : null}
                <Card>
                  <CardHeader title="Application documents" />
                  {canWrite ? (
                    <CardBody className="border-b border-line">
                      <ActionForm action={generateDocuments} className="flex flex-wrap items-center gap-4">
                        <input type="hidden" name="application_id" value={selected.id} />
                        <Checkbox name="kind" value="cv" label="Tailored CV" defaultChecked />
                        <Checkbox name="kind" value="cover_letter" label="Cover letter" defaultChecked />
                        <Checkbox name="kind" value="interview_prep" label="Interview prep" />
                        <Checkbox name="kind" value="skills_gap" label="Skills gap report" />
                        <SubmitButton size="sm">Generate drafts</SubmitButton>
                      </ActionForm>
                    </CardBody>
                  ) : null}
                  <ul className="divide-y divide-line">
                    {docs.map((d) => (
                      <li key={d.id} className="px-5 py-3">
                        <details>
                          <summary className="flex cursor-pointer items-center gap-2 text-sm"><span className="font-medium">{d.title}</span><Badge>{d.kind.replace("_", " ")}</Badge><span className="text-xs text-fg-subtle">{fmtDate(d.created_at)}</span></summary>
                          <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-fg">{d.content}</pre>
                          {canWrite ? <div className="mt-2"><InlineAction action={removeRecord} fields={{ table: "application_documents", id: d.id }} label="Delete" variant="ghost" /></div> : null}
                        </details>
                      </li>
                    ))}
                    {!docs.length ? <li className="px-5 py-4 text-sm text-fg-subtle">No documents yet.</li> : null}
                  </ul>
                </Card>
              </>
            ) : null}
          </div>
        </div>
      ) : null}

      {tab === "profile" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Profile" />
            <CardBody>
              <ActionForm action={saveProfile} className="space-y-3">
                <Field label="Headline" htmlFor="ph"><Input id="ph" name="headline" defaultValue={profile.data?.headline ?? ""} placeholder="e.g. Frontend engineer, fintech" /></Field>
                <Field label="Location" htmlFor="pl"><Input id="pl" name="location" defaultValue={profile.data?.location ?? ""} /></Field>
                <Field label="Target roles (comma separated)" htmlFor="pt"><Input id="pt" name="target_roles" defaultValue={(profile.data?.target_roles ?? []).join(", ")} /></Field>
                <Field label="Summary" htmlFor="ps"><Textarea id="ps" name="summary" defaultValue={profile.data?.summary ?? ""} className="min-h-28" /></Field>
                {canWrite ? <SubmitButton>Save profile</SubmitButton> : null}
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Skills" />
            <ul className="flex flex-wrap gap-2 px-5 py-4">
              {(skills.data ?? []).map((s) => (
                <li key={s.id} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs">
                  {s.name} <span className="text-fg-subtle">· {s.level}{s.years ? ` · ${s.years}y` : ""}</span>
                  {canWrite ? <InlineAction action={removeRecord} fields={{ table: "career_skills", id: s.id }} label="×" variant="ghost" /> : null}
                </li>
              ))}
              {!skills.data?.length ? <li className="text-sm text-fg-subtle">No skills yet.</li> : null}
            </ul>
            {canWrite ? (
              <CardBody className="border-t border-line">
                <ActionForm action={addSkill} resetOnSuccess className="grid grid-cols-2 gap-2">
                  <Input name="name" placeholder="Skill" required aria-label="Skill" />
                  <Select name="level" defaultValue="intermediate" aria-label="Level"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option></Select>
                  <Input name="years" placeholder="Years" inputMode="decimal" aria-label="Years" />
                  <Input name="evidence_note" placeholder="Where you used it" aria-label="Evidence" />
                  <SubmitButton size="sm" variant="secondary" className="col-span-2">Add skill</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "experience" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Employment history" />
            <ul className="divide-y divide-line">
              {(emp.data ?? []).map((e) => (
                <li key={e.id} className="px-5 py-3 text-sm"><div className="flex justify-between gap-2"><span className="font-medium">{e.title} — {e.employer}</span>{canWrite ? <InlineAction action={removeRecord} fields={{ table: "employment_history", id: e.id }} label="Remove" variant="ghost" /> : null}</div><div className="text-xs text-fg-subtle">{fmtDate(e.start_date)} – {e.end_date ? fmtDate(e.end_date) : "present"}</div>{e.description ? <p className="mt-1 text-xs text-fg-muted">{e.description}</p> : null}</li>
              ))}
            </ul>
            {canWrite ? (
              <CardBody className="border-t border-line">
                <ActionForm action={addEmployment} resetOnSuccess className="grid grid-cols-2 gap-2">
                  <Input name="title" placeholder="Job title" required aria-label="Job title" />
                  <Input name="employer" placeholder="Employer" required aria-label="Employer" />
                  <Input name="start_date" type="date" aria-label="Start date" />
                  <Input name="end_date" type="date" aria-label="End date" />
                  <Textarea name="description" placeholder="What you did and achieved" className="col-span-2 min-h-16" aria-label="Description" />
                  <SubmitButton size="sm" variant="secondary" className="col-span-2">Add experience</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>
          <Card>
            <CardHeader title="Certificates & credentials" description="Shown as self-reported unless the issuer is verified." />
            <ul className="divide-y divide-line">
              {(creds.data ?? []).map((c) => (
                <li key={c.id} className="flex items-center gap-2 px-5 py-3 text-sm"><span className="flex-1">{c.name}{c.issuer ? `, ${c.issuer}` : ""}</span><Badge tone={c.verification_status === "issuer_verified" ? "brand" : "neutral"}>{c.verification_status.replace("_", " ")}</Badge>{canWrite ? <InlineAction action={removeRecord} fields={{ table: "credentials", id: c.id }} label="Remove" variant="ghost" /> : null}</li>
              ))}
            </ul>
            {canWrite ? (
              <CardBody className="border-t border-line">
                <ActionForm action={addCredential} resetOnSuccess className="grid grid-cols-2 gap-2">
                  <Input name="name" placeholder="Certificate name" required className="col-span-2" aria-label="Certificate name" />
                  <Input name="issuer" placeholder="Issuer" aria-label="Issuer" />
                  <Input name="issued_on" type="date" aria-label="Issued on" />
                  <Input name="credential_url" type="url" placeholder="Verification URL (optional)" className="col-span-2" aria-label="Verification URL" />
                  <SubmitButton size="sm" variant="secondary" className="col-span-2">Add credential</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>
        </div>
      ) : null}

      {tab === "portfolio" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Card>
            <CardHeader title="Portfolio projects" description="Only projects you confirm as accurate appear in generated CVs." />
            <ul className="divide-y divide-line">
              {(projects.data ?? []).map((p) => (
                <li key={p.id} className="space-y-1 px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{p.title}</span><Badge tone={p.confirmed_accurate ? "brand" : "gold"}>{p.confirmed_accurate ? "confirmed" : "unconfirmed"}</Badge>{p.source !== "manual" ? <Badge>from {p.source}</Badge> : null}</div>
                  {p.description ? <p className="text-xs text-fg-muted">{p.description}</p> : null}
                  {canWrite ? <div className="flex gap-2">{!p.confirmed_accurate ? <InlineAction action={confirmProject} fields={{ id: p.id }} label="I confirm this is accurate" /> : null}<InlineAction action={removeRecord} fields={{ table: "portfolio_projects", id: p.id }} label="Remove" variant="ghost" /></div> : null}
                </li>
              ))}
              {!projects.data?.length ? <li className="px-5 py-4 text-sm text-fg-subtle">No projects yet.</li> : null}
            </ul>
          </Card>
          {canWrite ? (
            <div className="space-y-6">
              <Card>
                <CardHeader title="Add project" />
                <CardBody>
                  <ActionForm action={addProject} resetOnSuccess className="space-y-2">
                    <Input name="title" placeholder="Project title" required aria-label="Title" />
                    <Input name="role" placeholder="Your role" aria-label="Role" />
                    <Textarea name="description" placeholder="What was built" className="min-h-16" aria-label="Description" />
                    <Textarea name="outcomes" placeholder="Measurable outcomes" className="min-h-12" aria-label="Outcomes" />
                    <Input name="url" type="url" placeholder="Link" aria-label="Link" />
                    <Input name="skills" placeholder="Skills used (comma separated)" aria-label="Skills" />
                    <SubmitButton size="sm">Add project</SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
              {(jobs.data ?? []).length ? (
                <Card>
                  <CardHeader title="From completed JobProof jobs" />
                  <CardBody>
                    <ActionForm action={importJobAsProject} className="flex gap-2">
                      <Select name="job_id" aria-label="Completed job">{(jobs.data ?? []).map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</Select>
                      <SubmitButton size="sm" variant="secondary">Import</SubmitButton>
                    </ActionForm>
                  </CardBody>
                </Card>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
