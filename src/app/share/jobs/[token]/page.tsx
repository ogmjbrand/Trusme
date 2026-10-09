import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobByToken, loadJobRecord } from "@/lib/services/jobproof";
import { formatMoney } from "@/lib/money";
import { JobRecord, type JobRecordData } from "@/components/modules/job-record";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Input, Textarea } from "@/components/ui/field";
import { Wordmark } from "@/components/shell/brand";
import { Notice } from "@/components/ui/misc";
import { fmtDate } from "@/lib/format";
import { customerAcceptAgreement, customerConfirmCompletion, customerDecideChange, customerMessage, customerProposeChange } from "./actions";

export const metadata: Metadata = { title: "Job record", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function SharedJobPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const admin = createAdminClient();
  const job = await jobByToken(admin, token);
  if (!job) notFound();
  const rec = await loadJobRecord(admin, job.organization_id, job.id, (docId) => `/api/share/jobs/${token}/documents/${docId}`);
  if (!rec) notFound();
  const { data: org } = await admin.from("organizations").select("name").eq("id", job.organization_id).single();
  const latest = (rec.agreements as JobRecordData["agreements"])[0];
  const pendingProviderChanges = (rec.changes as JobRecordData["changes"]).filter((c) => c.status === "proposed" && c.requested_by_party === "provider");
  const closed = ["completed", "cancelled"].includes(job.status);
  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between"><Wordmark /><span className="text-xs text-fg-subtle">Shared job record</span></div>
      <h1 className="text-2xl font-semibold">{job.title}</h1>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-fg-muted">From {org?.name} · <StatusBadge status={job.status} /> · current price {formatMoney(job.price_minor, job.currency)} · deadline {fmtDate(job.deadline)}</p>
      <Notice className="my-6">This page shows the record kept by {org?.name} in TrustOS. Actions you take here are timestamped and attributed to the name you type. TrustOS records agreements and evidence; it does not judge disputes.</Notice>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <JobRecord data={rec as unknown as JobRecordData} />
        <div className="space-y-6">
          {latest && !latest.customer_accepted_at && !closed ? (
            <Card>
              <CardHeader title={`Accept agreement v${latest.version}`} />
              <CardBody>
                <ActionForm action={customerAcceptAgreement} className="space-y-2">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="agreement_id" value={latest.id} />
                  <input type="hidden" name="content_hash" value={latest.content_hash} />
                  <Input name="name" placeholder="Your full name" required aria-label="Your full name" />
                  <Checkbox name="confirm" label={`I have read version ${latest.version} and agree to the scope and price of ${formatMoney(latest.price_minor, latest.currency)}.`} required />
                  <SubmitButton size="sm">Accept agreement</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {pendingProviderChanges.map((c) => (
            <Card key={c.id}>
              <CardHeader title="Change request awaiting you" />
              <CardBody className="space-y-2 text-sm">
                <p>{c.description}</p>
                <p className="text-xs text-fg-muted">{c.price_delta_minor ? `Price change: ${c.price_delta_minor > 0 ? "+" : "−"}${formatMoney(Math.abs(c.price_delta_minor), job.currency)}` : "No price change"}{c.new_deadline ? ` · new deadline ${fmtDate(c.new_deadline)}` : ""}</p>
                <ActionForm action={customerDecideChange} className="space-y-2">
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="id" value={c.id} />
                  <Input name="name" placeholder="Your full name" required aria-label="Your full name" />
                  <div className="flex gap-2"><SubmitButton size="sm" name="decision" value="approved">Approve</SubmitButton><SubmitButton size="sm" variant="ghost" name="decision" value="rejected">Reject</SubmitButton></div>
                </ActionForm>
              </CardBody>
            </Card>
          ))}
          {job.status === "awaiting_confirmation" ? (
            <Card>
              <CardHeader title="Confirm the job is complete" />
              <CardBody>
                <ActionForm action={customerConfirmCompletion} className="space-y-2">
                  <input type="hidden" name="token" value={token} />
                  <Input name="name" placeholder="Your full name" required aria-label="Your full name" />
                  <Checkbox name="confirm" label="The work described in the agreement has been completed." required />
                  <SubmitButton size="sm">Confirm completion</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {!closed ? (
            <>
              <Card>
                <CardHeader title="Request a change" />
                <CardBody>
                  <ActionForm action={customerProposeChange} resetOnSuccess className="space-y-2">
                    <input type="hidden" name="token" value={token} />
                    <Textarea name="description" required placeholder="What would you like changed?" className="min-h-16" aria-label="Change request" />
                    <Input name="name" placeholder="Your full name" required aria-label="Your full name" />
                    <SubmitButton size="sm" variant="secondary">Send request</SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
            </>
          ) : null}
          <Card>
            <CardHeader title="Add a message to the record" />
            <CardBody>
              <ActionForm action={customerMessage} resetOnSuccess className="space-y-2">
                <input type="hidden" name="token" value={token} />
                <Textarea name="body" required className="min-h-16" aria-label="Message" />
                <Input name="name" placeholder="Your full name" required aria-label="Your full name" />
                <select name="kind" className="h-9 w-full rounded-lg border border-line-strong bg-surface-2 px-2 text-sm" aria-label="Message type"><option value="customer_message">Message</option><option value="dispute_note">Concern / dispute note</option></select>
                <SubmitButton size="sm" variant="secondary">Add message</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
