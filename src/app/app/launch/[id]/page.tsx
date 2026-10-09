import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney, totalsByCurrency } from "@/lib/money";
import { PageHeader, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ActionForm, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { EvidenceUpload } from "@/components/modules/evidence-upload";
import { fmtDate, fmtDateTime, todayIso } from "@/lib/format";
import { recordExpense } from "../../profitability/actions";
import { addExpertHandoff, addTask, linkSupplier, saveApplicationStatus, setStage, startLabelReview, updateLabelReview, updateTask } from "../actions";

export const metadata = { title: "Launch project" };
const NEXT_STATUS: Record<string, string> = { todo: "in_progress", in_progress: "done", blocked: "in_progress", done: "todo" };

export default async function LaunchProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getWorkspace();
  const o = ws.org.organizationId;
  const { data: p } = await ws.supabase.from("launch_projects").select("*").eq("id", id).eq("organization_id", o).maybeSingle();
  if (!p) notFound();
  const [tasks, sources, apps, labels, experts, expenses, linked, suppliers, docs] = await Promise.all([
    ws.supabase.from("launch_tasks").select("*, regulatory_sources(authority, title, url, retrieved_at)").eq("project_id", id).order("position"),
    ws.supabase.from("regulatory_sources").select("*").or(`organization_id.is.null,organization_id.eq.${o}`),
    ws.supabase.from("launch_applications").select("*").eq("project_id", id).order("created_at"),
    ws.supabase.from("label_reviews").select("*").eq("project_id", id).order("created_at", { ascending: false }),
    ws.supabase.from("expert_handoffs").select("*").eq("project_id", id).order("created_at"),
    ws.supabase.from("expenses").select("id, description, amount_minor, currency, incurred_at").eq("launch_project_id", id).order("incurred_at", { ascending: false }),
    ws.supabase.from("launch_suppliers").select("role, suppliers(id, name, lead_time_days)").eq("project_id", id),
    ws.supabase.from("suppliers").select("id, name").eq("organization_id", o).order("name"),
    ws.supabase.from("uploaded_documents").select("id, file_name, description, created_at").eq("entity_type", "launch_project").eq("entity_id", id),
  ]);
  const canWrite = can(ws.role, "records.write");
  const spent = totalsByCurrency((expenses.data ?? []).map((e) => ({ amountMinor: e.amount_minor, currency: e.currency })));
  const spentSame = spent.find((s) => s.currency === p.currency)?.amountMinor ?? 0;
  type T = { id: string; title: string; description: string | null; category: string; status: string; due_on: string | null; needs_verification: boolean; requires_expert: boolean; regulatory_sources: { authority: string; title: string; url: string; retrieved_at: string | null } | null };
  const taskList = (tasks.data ?? []) as unknown as T[];
  const cls = p.classification as { category?: string; confidence?: string; matched?: string; confirmed_by_user?: boolean };

  return (
    <>
      <PageHeader
        eyebrow="LaunchReady"
        title={<span className="flex flex-wrap items-center gap-2">{p.name} <StatusBadge status={p.stage} /></span>}
        description={`${p.product_category.replace("_", " ")} · target ${fmtDate(p.target_launch_date)}`}
        actions={canWrite ? (
          <ActionForm action={setStage} className="flex gap-2">
            <input type="hidden" name="id" value={p.id} />
            <Select name="stage" defaultValue={p.stage} className="h-8 text-xs" aria-label="Stage">{["idea", "planning", "registering", "pre_launch", "launched", "paused"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select>
            <SubmitButton size="sm" variant="secondary">Update stage</SubmitButton>
          </ActionForm>
        ) : null}
      />
      {!cls.confirmed_by_user ? <Notice tone="warning" className="mb-4" title="Category was auto-detected">{cls.confidence === "keyword_match" ? `Matched “${cls.matched}” in your description.` : "No category keywords matched; defaulted to general goods."} If this is wrong, create the plan again with the correct category — the checklist depends on it.</Notice> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={`Checklist · ${taskList.filter((t) => t.status === "done").length}/${taskList.length} done`} />
            <ul className="divide-y divide-line">
              {taskList.map((t) => (
                <li key={t.id} className="flex items-start gap-3 px-5 py-3">
                  {canWrite ? <InlineAction action={updateTask} fields={{ id: t.id, status: NEXT_STATUS[t.status]! }} label={t.status === "done" ? "Reopen" : t.status === "todo" ? "Start" : "Done"} variant={t.status === "done" ? "ghost" : "secondary"} /> : null}
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><span className={t.status === "done" ? "text-fg-subtle line-through" : "font-medium"}>{t.title}</span><StatusBadge status={t.status} /><Badge>{t.category}</Badge>{t.needs_verification ? <Badge tone="gold">verify at source</Badge> : null}{t.requires_expert ? <Badge tone="info">expert advised</Badge> : null}</div>
                    {t.description ? <p className="mt-1 text-xs text-fg-muted">{t.description}</p> : null}
                    <p className="mt-1 text-xs text-fg-subtle">Due {fmtDate(t.due_on)}{t.regulatory_sources ? <> · Source: <a href={t.regulatory_sources.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 underline">{t.regulatory_sources.authority}<ExternalLink className="h-3 w-3" /></a> {t.regulatory_sources.retrieved_at ? `(retrieved ${fmtDate(t.regulatory_sources.retrieved_at)})` : "(official site — content not retrieved by TrustOS)"}</> : null}</p>
                  </div>
                </li>
              ))}
            </ul>
            {canWrite ? (
              <CardBody className="border-t border-line">
                <ActionForm action={addTask} resetOnSuccess className="flex flex-wrap gap-2">
                  <input type="hidden" name="project_id" value={p.id} />
                  <Input name="title" placeholder="New task" required className="min-w-48 flex-1" aria-label="Task" />
                  <Select name="category" defaultValue="operations" className="w-36" aria-label="Category">{["registration", "compliance", "product", "labeling", "suppliers", "marketing", "finance", "operations"].map((c) => <option key={c}>{c}</option>)}</Select>
                  <Input name="due_on" type="date" className="w-40" aria-label="Due" />
                  <SubmitButton size="md" variant="secondary">Add</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Registrations & applications" description="Status as reported by you after submitting on the official portal." />
            <ul className="divide-y divide-line">
              {(apps.data ?? []).map((a) => (
                <li key={a.id} className="px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{a.authority} · {a.application_type}</span><StatusBadge status={a.status} />{a.reference_number ? <span className="font-mono text-xs text-fg-subtle">ref {a.reference_number}</span> : null}</div>
                  <p className="text-xs text-fg-subtle">Submitted {fmtDate(a.submitted_on)} · last updated {fmtDate(a.last_checked_on)}</p>
                  {a.notes ? <p className="text-xs text-fg-muted">{a.notes}</p> : null}
                  {canWrite ? (
                    <ActionForm action={saveApplicationStatus} className="mt-2 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={a.id} /><input type="hidden" name="project_id" value={p.id} /><input type="hidden" name="authority" value={a.authority} /><input type="hidden" name="application_type" value={a.application_type} />
                      <Select name="status" defaultValue={a.status} className="h-8 w-44 text-xs" aria-label="Status">{["preparing", "submitted_by_user", "under_review", "query_raised", "approved", "rejected"].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</Select>
                      <Input name="reference_number" defaultValue={a.reference_number ?? ""} placeholder="Reference" className="h-8 w-36 text-xs" aria-label="Reference" />
                      <Input name="submitted_on" type="date" defaultValue={a.submitted_on ?? ""} className="h-8 w-36 text-xs" aria-label="Submitted on" />
                      <SubmitButton size="sm" variant="ghost">Update</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            {canWrite ? (
              <CardBody className="border-t border-line">
                <ActionForm action={saveApplicationStatus} resetOnSuccess className="grid gap-2 sm:grid-cols-2">
                  <input type="hidden" name="project_id" value={p.id} />
                  <Select name="authority" defaultValue="CAC" aria-label="Authority"><option>CAC</option><option>NAFDAC</option><option>SON</option><option>FIRS</option><option>State</option><option>Other</option></Select>
                  <Input name="application_type" placeholder="e.g. Business name registration" required aria-label="Application type" />
                  <Select name="status" defaultValue="preparing" aria-label="Status"><option value="preparing">Preparing</option><option value="submitted_by_user">Submitted by me</option><option value="under_review">Under review</option></Select>
                  <Input name="reference_number" placeholder="Reference (if any)" aria-label="Reference" />
                  <SubmitButton size="sm" variant="secondary" className="sm:col-span-2">Track application</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Product label review" description="Record which official guideline (URL) supports each item. Final sign-off should come from a qualified expert." />
            {(labels.data ?? []).map((l) => (
              <CardBody key={l.id} className="border-b border-line">
                <ActionForm action={updateLabelReview} className="space-y-2">
                  <input type="hidden" name="id" value={l.id} />
                  {(l.checklist as { item: string; present: boolean | null; source_url: string | null }[]).map((c, i) => (
                    <div key={i} className="grid items-center gap-2 sm:grid-cols-[1fr_260px]">
                      <Checkbox name={`present_${i}`} label={c.item} defaultChecked={Boolean(c.present)} />
                      <Input name={`source_${i}`} defaultValue={c.source_url ?? ""} placeholder="Official source URL" className="h-8 text-xs" aria-label={`Source for ${c.item}`} />
                    </div>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    <Select name="status" defaultValue={l.status} className="h-8 w-48 text-xs" aria-label="Review status"><option value="in_review">In review</option><option value="changes_needed">Changes needed</option><option value="ready_for_expert">Ready for expert</option><option value="expert_approved">Expert approved</option></Select>
                    <Input name="reviewer_note" defaultValue={l.reviewer_note ?? ""} placeholder="Note" className="h-8 flex-1 text-xs" aria-label="Note" />
                    {canWrite ? <SubmitButton size="sm" variant="secondary">Save review</SubmitButton> : null}
                  </div>
                </ActionForm>
              </CardBody>
            ))}
            {canWrite ? (
              <CardBody>
                <ActionForm action={startLabelReview} className="space-y-2">
                  <input type="hidden" name="project_id" value={p.id} />
                  <Textarea name="label_text" placeholder="Paste the label text (optional)" className="min-h-16" aria-label="Label text" />
                  <SubmitButton size="sm" variant="secondary">Start label review</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Budget" />
            <CardBody className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-fg-muted">Budget</span><span className="tabular">{p.budget_minor ? formatMoney(p.budget_minor, p.currency) : "Not set"}</span></div>
              <div className="flex justify-between"><span className="text-fg-muted">Recorded spend</span><span className={`tabular ${p.budget_minor && spentSame > p.budget_minor ? "text-danger" : ""}`}>{spent.length ? spent.map((s) => formatMoney(s.amountMinor, s.currency)).join(" · ") : formatMoney(0, p.currency)}</span></div>
              {p.budget_minor ? <div className="h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.min(100, Math.round((spentSame / p.budget_minor) * 100))}%` }} /></div> : null}
              <ul className="space-y-1 text-xs text-fg-muted">{(expenses.data ?? []).map((e) => <li key={e.id} className="flex justify-between gap-2"><span className="truncate">{e.description}</span><span className="tabular">{formatMoney(e.amount_minor, e.currency)}</span></li>)}</ul>
              {canWrite ? (
                <ActionForm action={recordExpense} resetOnSuccess className="grid grid-cols-2 gap-2 border-t border-line pt-3">
                  <input type="hidden" name="launch_project_id" value={p.id} />
                  <input type="hidden" name="currency" value={p.currency} />
                  <input type="hidden" name="cost_type" value="overhead" />
                  <input type="hidden" name="category" value="Launch" />
                  <Input name="description" placeholder="Expense" required className="col-span-2" aria-label="Expense" />
                  <Input name="amount" placeholder={`Amount (${p.currency})`} inputMode="decimal" required aria-label="Amount" />
                  <Input name="incurred_at" type="date" defaultValue={todayIso()} required aria-label="Date" />
                  <SubmitButton size="sm" variant="secondary" className="col-span-2">Record approved spend</SubmitButton>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Suppliers" />
            <ul className="divide-y divide-line">
              {((linked.data ?? []) as unknown as { role: string | null; suppliers: { id: string; name: string; lead_time_days: number | null } | null }[]).map((l) => <li key={l.suppliers?.id} className="px-5 py-2 text-sm">{l.suppliers?.name} <span className="text-xs text-fg-subtle">{l.role ?? ""}{l.suppliers?.lead_time_days ? ` · ${l.suppliers.lead_time_days}d lead` : ""}</span></li>)}
            </ul>
            {canWrite && (suppliers.data ?? []).length ? (
              <CardBody className="border-t border-line">
                <ActionForm action={linkSupplier} className="flex gap-2">
                  <input type="hidden" name="project_id" value={p.id} />
                  <Select name="supplier_id" aria-label="Supplier">{(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
                  <Input name="role" placeholder="Role" className="w-28" aria-label="Role" />
                  <SubmitButton size="sm" variant="secondary">Link</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : <CardBody className="text-xs text-fg-subtle">Add suppliers in StockSense to link them here.</CardBody>}
          </Card>
          <Card>
            <CardHeader title="Expert handoffs" />
            <ul className="divide-y divide-line">
              {(experts.data ?? []).map((e) => <li key={e.id} className="px-5 py-2.5 text-sm"><span className="font-medium">{e.expert_name}</span> <span className="text-xs text-fg-subtle">· {e.expertise}</span> <StatusBadge status={e.status === "requested" ? "pending" : e.status} label={e.status} /><p className="text-xs text-fg-muted">{e.scope}</p></li>)}
            </ul>
            {canWrite ? (
              <CardBody className="border-t border-line">
                <ActionForm action={addExpertHandoff} resetOnSuccess className="space-y-2">
                  <input type="hidden" name="project_id" value={p.id} />
                  <Input name="expert_name" placeholder="Name" required aria-label="Expert name" />
                  <Input name="expertise" placeholder="e.g. Regulatory consultant, lawyer" required aria-label="Expertise" />
                  <Input name="contact" placeholder="Contact" aria-label="Contact" />
                  <Textarea name="scope" placeholder="What you need from them" required className="min-h-14" aria-label="Scope" />
                  <SubmitButton size="sm" variant="secondary">Record handoff</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>
          <Card>
            <CardHeader title="Documents" />
            <ul className="divide-y divide-line">{(docs.data ?? []).map((d) => <li key={d.id} className="px-5 py-2 text-sm"><a href={`/api/documents/${d.id}`} className="text-brand hover:underline">{d.file_name}</a> <span className="text-xs text-fg-subtle">{fmtDateTime(d.created_at)}</span></li>)}</ul>
            {canWrite ? <CardBody className="border-t border-line"><EvidenceUpload entityType="launch_project" entityId={p.id} withClass={false} /></CardBody> : null}
          </Card>
          <Card>
            <CardHeader title="Official sources" />
            <ul className="divide-y divide-line">
              {(sources.data ?? []).map((s) => <li key={s.id} className="px-5 py-2.5 text-xs"><a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">{s.authority}</a> <span className="text-fg-muted">{s.summary}</span> <span className="block text-fg-subtle">{s.retrieved_at ? `Retrieved ${fmtDate(s.retrieved_at)}` : "Not retrieved by TrustOS — check the official site"}</span></li>)}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
