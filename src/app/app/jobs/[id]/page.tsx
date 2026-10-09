import { notFound } from "next/navigation";
import Link from "next/link";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/money";
import { loadJobRecord } from "@/lib/services/jobproof";
import { PageHeader, DefinitionList } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { ActionForm, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EvidenceUpload } from "@/components/modules/evidence-upload";
import { JobRecord, type JobRecordData } from "@/components/modules/job-record";
import { PrintButton } from "@/components/ui/print-button";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { addJobUpdate, decideCustomerChange, invoiceFromJob, proposeAgreement, proposeChange, setJobStatus } from "../actions";
import { ShareLink } from "./share-link";

export const metadata = { title: "Job" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getWorkspace();
  const rec = await loadJobRecord(ws.supabase, ws.org.organizationId, id, (docId) => `/api/documents/${docId}`);
  if (!rec) notFound();
  const job = rec.job as JobRecordData["job"] & { id: string; invoice_id: string | null; share_token_hash: string | null; customers: { name: string; email: string | null; phone: string | null } | null };
  const canWrite = can(ws.role, "records.write");
  const openCustomerChanges = (rec.changes as JobRecordData["changes"]).filter((c) => c.status === "proposed" && c.requested_by_party === "customer");
  return (
    <>
      <PageHeader eyebrow="JobProof" title={<span className="flex flex-wrap items-center gap-2">{job.title} <StatusBadge status={job.status} /></span>} description={`${job.customers?.name ?? "No customer"} · ${formatMoney(job.price_minor, job.currency)} · deadline ${fmtDate(job.deadline)}`} actions={<PrintButton label="Dispute / record pack" />} />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <JobRecord data={rec as unknown as JobRecordData} />
        <div className="no-print space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <CardBody>
              <DefinitionList items={[
                { label: "Current price", value: <span className="tabular">{formatMoney(job.price_minor, job.currency)}</span> },
                { label: "Payment", value: <StatusBadge status={job.payment_status === "unpaid" ? "pending" : job.payment_status} label={job.payment_status.replace("_", " ")} /> },
                { label: "Location", value: job.location },
                { label: "Warranty", value: job.warranty_terms },
                { label: "Customer confirmation", value: job.customer_confirmed_at ? `${job.customer_confirmed_name}, ${fmtDateTime(job.customer_confirmed_at)}` : "Not confirmed" },
                { label: "Invoice", value: job.invoice_id ? <Link href={`/app/invoices/${job.invoice_id}`} className="text-brand hover:underline">View invoice</Link> : "None" },
              ]} />
            </CardBody>
          </Card>
          {canWrite ? (
            <>
              <Card>
                <CardHeader title="Customer access" />
                <CardBody><ShareLink jobId={job.id} active={Boolean(job.share_token_hash)} /></CardBody>
              </Card>
              <Card>
                <CardHeader title="Actions" />
                <CardBody className="flex flex-wrap gap-2">
                  {job.status === "agreed" || job.status === "disputed" ? <InlineAction action={setJobStatus} fields={{ id: job.id, status: "in_progress" }} label="Start work" variant="primary" /> : null}
                  {job.status === "in_progress" ? <InlineAction action={setJobStatus} fields={{ id: job.id, status: "awaiting_confirmation" }} label="Mark done — ask customer to confirm" variant="primary" /> : null}
                  {["in_progress", "awaiting_confirmation", "agreed"].includes(job.status) ? <InlineAction action={setJobStatus} fields={{ id: job.id, status: "disputed" }} label="Mark disputed" variant="danger" confirm="Mark this job as disputed? This is recorded in the job history." /> : null}
                  {["draft", "proposed", "agreed", "in_progress"].includes(job.status) ? <InlineAction action={setJobStatus} fields={{ id: job.id, status: "cancelled" }} label="Cancel job" variant="ghost" confirm="Cancel this job?" /> : null}
                  {!job.invoice_id ? <ActionForm action={invoiceFromJob} redirectTo={(d) => `/app/invoices/${d.id}`}><input type="hidden" name="job_id" value={job.id} /><SubmitButton size="sm" variant="secondary">Create invoice</SubmitButton></ActionForm> : null}
                </CardBody>
              </Card>
              {!["completed", "cancelled"].includes(job.status) ? (
                <Card>
                  <CardHeader title="Propose agreement" description="Creates a new version at the current price and deadline; the customer accepts it via their link." />
                  <CardBody>
                    <ActionForm action={proposeAgreement} className="space-y-2">
                      <input type="hidden" name="job_id" value={job.id} />
                      <Textarea name="scope" required defaultValue={job.description ?? ""} placeholder="Exactly what will be done" className="min-h-24" aria-label="Scope" />
                      <Input name="materials" placeholder="Materials included (optional)" aria-label="Materials" />
                      <Textarea name="terms" placeholder="Payment terms, exclusions (optional)" className="min-h-16" aria-label="Terms" />
                      <SubmitButton size="sm">Propose version</SubmitButton>
                    </ActionForm>
                  </CardBody>
                </Card>
              ) : null}
              {openCustomerChanges.length ? (
                <Card>
                  <CardHeader title="Customer requests to decide" />
                  <ul className="divide-y divide-line">
                    {openCustomerChanges.map((c) => (
                      <li key={c.id} className="space-y-2 px-5 py-3 text-sm">
                        <p>{c.description}</p>
                        <div className="flex gap-2">
                          <InlineAction action={decideCustomerChange} fields={{ id: c.id, decision: "approved" }} label="Approve" variant="primary" />
                          <InlineAction action={decideCustomerChange} fields={{ id: c.id, decision: "rejected" }} label="Reject" variant="ghost" />
                        </div>
                      </li>
                    ))}
                  </ul>
                </Card>
              ) : null}
              <Card>
                <CardHeader title="Request a change" />
                <CardBody>
                  <ActionForm action={proposeChange} resetOnSuccess className="space-y-2">
                    <input type="hidden" name="job_id" value={job.id} />
                    <Textarea name="description" required placeholder="What changes and why" className="min-h-16" aria-label="Change description" />
                    <div className="grid grid-cols-2 gap-2">
                      <Input name="delta" placeholder="Price change (e.g. 15000 or -5000)" aria-label="Price change" />
                      <Input name="new_deadline" type="date" aria-label="New deadline" />
                    </div>
                    <SubmitButton size="sm" variant="secondary">Send for customer approval</SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Add update" />
                <CardBody>
                  <ActionForm action={addJobUpdate} resetOnSuccess className="space-y-2">
                    <input type="hidden" name="job_id" value={job.id} />
                    <Select name="kind" defaultValue="progress" aria-label="Update type"><option value="progress">Progress</option><option value="material">Materials used</option><option value="additional_cost">Additional cost</option><option value="note">Note</option><option value="completion">Completion note</option><option value="dispute_note">Dispute note</option></Select>
                    <Textarea name="body" required className="min-h-16" aria-label="Update" />
                    <Input name="amount" placeholder="Amount (for materials/costs)" inputMode="decimal" aria-label="Amount" />
                    <SubmitButton size="sm" variant="secondary">Add to record</SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Upload photo / document" />
                <CardBody><EvidenceUpload entityType="service_job" entityId={job.id} withPhase withClass={false} /></CardBody>
              </Card>
            </>
          ) : null}
        </div>
      </div>
    </>
  );
}
