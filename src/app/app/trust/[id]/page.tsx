import { notFound } from "next/navigation";
import { FileText } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/money";
import { PageHeader, DefinitionList, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EvidenceUpload } from "@/components/modules/evidence-upload";
import { PrintButton } from "@/components/ui/print-button";
import { fmtDateTime } from "@/lib/format";
import { addUserClaim, draftReport, markReportSubmitted, recordFeedback } from "../actions";

export const metadata = { title: "Risk assessment" };

const CLASS_LABEL: Record<string, string> = {
  verified_evidence: "Verified evidence",
  third_party_report: "Third-party reports",
  user_claim: "Your statements",
  heuristic_observation: "Heuristic observations (unverified)",
  ai_hypothesis: "AI hypotheses (unverified)",
};

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getWorkspace();
  const { data: a } = await ws.supabase.from("risk_assessments").select("*").eq("id", id).eq("organization_id", ws.org.organizationId).maybeSingle();
  if (!a) notFound();
  const [{ data: signals }, { data: docs }, { data: reports }] = await Promise.all([
    ws.supabase.from("risk_signals").select("*").eq("assessment_id", id).order("created_at"),
    ws.supabase.from("uploaded_documents").select("id, file_name, evidence_class, description, created_at, sha256").eq("entity_type", "risk_assessment").eq("entity_id", id),
    ws.supabase.from("scam_reports").select("*").eq("assessment_id", id).order("created_at", { ascending: false }),
  ]);
  const grouped = Object.keys(CLASS_LABEL).map((k) => ({ k, items: (signals ?? []).filter((s) => s.evidence_class === k) })).filter((g) => g.items.length);
  const canWrite = can(ws.role, "records.write");
  return (
    <>
      <PageHeader
        eyebrow="BeforeYouPay · Assessment"
        title={a.title}
        description={`Screened ${fmtDateTime(a.assessed_at ?? a.created_at)} · method ${a.method ?? "—"}`}
        actions={<PrintButton label="Export / print" />}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title={<span className="flex items-center gap-2">Indicator level <StatusBadge status={a.risk_level} /> <span className="text-xs font-normal text-fg-subtle">score {a.risk_score ?? "—"}/100 (heuristic)</span></span>} />
            <CardBody className="space-y-3">
              <p className="text-sm text-fg">{a.summary}</p>
              <Notice tone="warning">This is not a finding that anyone acted fraudulently. It lists patterns that warrant independent verification through official channels before you pay.</Notice>
            </CardBody>
          </Card>
          {grouped.map((g) => (
            <Card key={g.k}>
              <CardHeader title={CLASS_LABEL[g.k]} />
              <ul className="divide-y divide-line">
                {g.items.map((s) => (
                  <li key={s.id} className="px-5 py-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{s.label}</span><Badge tone={s.severity === "high" ? "danger" : s.severity === "medium" ? "warning" : "neutral"}>{s.severity}</Badge></div>
                    {s.detail ? <p className="mt-1 text-xs text-fg-muted">{s.detail}</p> : null}
                    {s.source_name ? <p className="mt-1 text-xs text-fg-subtle">Source: {s.source_url ? <a href={s.source_url} className="underline" target="_blank" rel="noreferrer">{s.source_name}</a> : s.source_name}{s.retrieved_at ? `, retrieved ${fmtDateTime(s.retrieved_at)}` : ""}</p> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
          {!grouped.length ? <Card><CardBody><p className="text-sm text-fg-muted">No warning patterns were matched. That does not confirm the counterparty is legitimate.</p></CardBody></Card> : null}

          <Card>
            <CardHeader title="Scam report drafts" description="TrustOS never sends or publishes reports. Submit through the official channel yourself, then record it here." />
            <ul className="divide-y divide-line">
              {(reports ?? []).map((r) => (
                <li key={r.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs"><StatusBadge status={r.status} />{r.intended_recipient ? <span className="text-fg-subtle">for {r.intended_recipient}</span> : null}{r.submitted_at ? <span className="text-fg-subtle">submitted {fmtDateTime(r.submitted_at)}{r.submission_reference ? ` · ref ${r.submission_reference}` : ""}</span> : null}</div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-fg-muted">{r.body}</pre>
                  {r.status === "draft" && canWrite ? (
                    <ActionForm action={markReportSubmitted} className="flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <Input name="reference" placeholder="Reference number you received (optional)" className="h-8 max-w-xs text-xs" />
                      <SubmitButton size="sm" variant="secondary">I submitted this myself</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
            {canWrite ? (
              <CardBody className="border-t border-line">
                <ActionForm action={draftReport} resetOnSuccess className="space-y-2">
                  <input type="hidden" name="id" value={a.id} />
                  <Field label="Intended recipient (optional)" htmlFor="rr"><Input id="rr" name="recipient" placeholder="e.g. your bank, the platform, police" /></Field>
                  <Field label="What happened, in your words" htmlFor="rn"><Textarea id="rn" name="narrative" required minLength={20} className="min-h-28" /></Field>
                  <SubmitButton size="sm"><FileText className="h-3.5 w-3.5" />Draft report</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Details you provided" />
            <CardBody>
              <DefinitionList items={[
                { label: "Seller", value: a.counterparty_name },
                { label: "Contact", value: a.counterparty_contact },
                { label: "Amount", value: a.amount_minor && a.currency ? formatMoney(a.amount_minor, a.currency) : null },
                { label: "Payment method", value: a.payment_method_requested },
                { label: "Link", value: a.url ? <span className="break-all font-mono text-xs">{a.url}</span> : null },
              ]} />
              {a.subject_text ? <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-2 text-xs text-fg-muted">{a.subject_text}</pre> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Evidence" description="Files are stored privately with a SHA-256 fingerprint." />
            <ul className="divide-y divide-line">
              {(docs ?? []).map((d) => (
                <li key={d.id} className="px-5 py-2.5 text-sm">
                  <a href={`/api/documents/${d.id}`} className="text-brand hover:underline">{d.file_name}</a> <Badge>{CLASS_LABEL[d.evidence_class ?? "user_claim"] ?? d.evidence_class}</Badge>
                  {d.description ? <p className="text-xs text-fg-muted">{d.description}</p> : null}
                  <p className="font-mono text-[10px] text-fg-subtle">sha256 {d.sha256?.slice(0, 16)}… · {fmtDateTime(d.created_at)}</p>
                </li>
              ))}
            </ul>
            {canWrite ? <CardBody className="border-t border-line"><EvidenceUpload entityType="risk_assessment" entityId={a.id} /></CardBody> : null}
          </Card>
          {canWrite ? (
            <Card>
              <CardHeader title="Add a note" />
              <CardBody>
                <ActionForm action={addUserClaim} resetOnSuccess className="space-y-2">
                  <input type="hidden" name="id" value={a.id} />
                  <Input name="label" placeholder="e.g. Seller refused a video call" required aria-label="Note" />
                  <Textarea name="detail" placeholder="Details (optional)" className="min-h-16" aria-label="Details" />
                  <SubmitButton size="sm" variant="secondary">Add note</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {canWrite ? (
            <Card>
              <CardHeader title="Feedback & outcome" description="Helps you keep an honest record and improve screening." />
              <CardBody>
                <ActionForm action={recordFeedback} className="space-y-2">
                  <input type="hidden" name="id" value={a.id} />
                  <Select name="user_feedback" defaultValue={a.user_feedback ?? ""} aria-label="Was this assessment accurate?"><option value="">Was this assessment accurate?</option><option value="accurate">Accurate</option><option value="partly_accurate">Partly accurate</option><option value="inaccurate">Inaccurate</option></Select>
                  <Select name="outcome" defaultValue={a.outcome ?? ""} aria-label="Outcome"><option value="">What happened?</option><option value="did_not_pay">I did not pay</option><option value="paid_ok">I paid and it went fine</option><option value="paid_lost_money">I paid and lost money</option><option value="unknown">Not sure yet</option></Select>
                  <Textarea name="user_feedback_note" defaultValue={a.user_feedback_note ?? ""} placeholder="Corrections or notes" className="min-h-16" aria-label="Notes" />
                  <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
