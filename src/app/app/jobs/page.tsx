import Link from "next/link";
import { Hammer } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney, SUPPORTED_CURRENCIES } from "@/lib/money";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { fmtDate } from "@/lib/format";
import { createJob } from "./actions";

export const metadata = { title: "JobProof" };

export default async function JobsPage() {
  const ws = await getWorkspace();
  const org = ws.org.organizationId;
  const [{ data: jobs }, { data: customers }] = await Promise.all([
    ws.supabase.from("service_jobs").select("id, title, status, payment_status, price_minor, currency, deadline, customers(name)").eq("organization_id", org).order("created_at", { ascending: false }).limit(200),
    ws.supabase.from("customers").select("id, name").eq("organization_id", org).order("name"),
  ]);
  type J = { id: string; title: string; status: string; payment_status: string; price_minor: number; currency: string; deadline: string | null; customers: { name: string } | null };
  return (
    <>
      <PageHeader eyebrow="JobProof" title="Service jobs" description="Agree scope and price, record changes and evidence, and keep a shared record both parties can see. TrustOS keeps records; it does not adjudicate disputes." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          {jobs?.length ? (
            <Table>
              <THead><TR><TH>Job</TH><TH>Status</TH><TH>Payment</TH><TH>Deadline</TH><TH className="text-right">Price</TH></TR></THead>
              <TBody>
                {(jobs as unknown as J[]).map((j) => (
                  <TR key={j.id}>
                    <TD><Link href={`/app/jobs/${j.id}`} className="font-medium hover:text-brand">{j.title}</Link><div className="text-xs text-fg-subtle">{j.customers?.name ?? "No customer"}</div></TD>
                    <TD><StatusBadge status={j.status} /></TD>
                    <TD><StatusBadge status={j.payment_status === "unpaid" ? "pending" : j.payment_status} label={j.payment_status.replace("_", " ")} /></TD>
                    <TD className="text-fg-muted">{fmtDate(j.deadline)}</TD>
                    <TD className="tabular text-right">{formatMoney(j.price_minor, j.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : <EmptyState icon={Hammer} title="No jobs yet" description="Create a job to start an agreement with your customer." />}
        </Card>
        {can(ws.role, "records.write") ? (
          <Card>
            <CardHeader title="New job" />
            <CardBody>
              <ActionForm action={createJob} redirectTo={(d) => `/app/jobs/${d.id}`} className="space-y-3">
                <Field label="Title" htmlFor="jt"><Input id="jt" name="title" required placeholder="e.g. Kitchen re-tiling" /></Field>
                <Field label="Customer" htmlFor="jc"><Select id="jc" name="customer_id" defaultValue=""><option value="">Select later</option>{(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                <Field label="Description" htmlFor="jd"><Textarea id="jd" name="description" className="min-h-20" /></Field>
                <Field label="Location" htmlFor="jl"><Input id="jl" name="location" /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Price" htmlFor="jp"><Input id="jp" name="price" inputMode="decimal" required /></Field>
                  <Field label="Currency" htmlFor="jcur"><Select id="jcur" name="currency" defaultValue={ws.org.defaultCurrency}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                </div>
                <Field label="Deadline" htmlFor="jdl"><Input id="jdl" name="deadline" type="date" /></Field>
                <Field label="Warranty terms" htmlFor="jw"><Textarea id="jw" name="warranty_terms" className="min-h-16" /></Field>
                <SubmitButton>Create job</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
