import Link from "next/link";
import { Users } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, SampleBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/field";
import { saveCustomer } from "../invoices/actions";

export const metadata = { title: "Customers" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ edit?: string; q?: string }> }) {
  const { edit, q } = await searchParams;
  const ws = await getWorkspace();
  let query = ws.supabase.from("customers").select("*").eq("organization_id", ws.org.organizationId).order("name").limit(500);
  if (q) query = query.ilike("name", `%${q.replace(/[%_]/g, "")}%`);
  const { data } = await query;
  const editing = edit ? data?.find((c) => c.id === edit) : null;
  const canWrite = can(ws.role, "records.write");
  return (
    <>
      <PageHeader title="Customers" description="Shared across CollectIQ, JobProof and sales. Contact consent controls what TrustOS may send." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title={`${data?.length ?? 0} customers`} actions={<form><Input name="q" defaultValue={q} placeholder="Search name" className="h-8 w-48 text-xs" /></form>} />
          {data?.length ? (
            <Table>
              <THead><TR><TH>Name</TH><TH>Contact</TH><TH>Consent</TH><TH /></TR></THead>
              <TBody>
                {data.map((c) => (
                  <TR key={c.id}>
                    <TD><span className="font-medium">{c.name}</span> {c.is_sample ? <SampleBadge /> : null}{c.company ? <div className="text-xs text-fg-subtle">{c.company}</div> : null}</TD>
                    <TD className="text-xs text-fg-muted">{c.email ?? "—"}<br />{c.phone ?? ""}</TD>
                    <TD><div className="flex flex-wrap gap-1">{c.consent_email ? <Badge tone="brand">email</Badge> : null}{c.consent_sms ? <Badge tone="brand">sms</Badge> : null}{c.consent_whatsapp ? <Badge tone="brand">whatsapp</Badge> : null}{!c.consent_email && !c.consent_sms && !c.consent_whatsapp ? <Badge>none</Badge> : null}</div></TD>
                    <TD className="text-right">{canWrite ? <Link href={`/app/customers?edit=${c.id}`} className="text-xs text-fg-muted hover:text-fg">Edit</Link> : null}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <EmptyState icon={Users} title="No customers yet" description="Add your first customer to start invoicing." />
          )}
        </Card>
        {canWrite ? (
          <Card>
            <CardHeader title={editing ? `Edit ${editing.name}` : "Add customer"} actions={editing ? <Link href="/app/customers" className="text-xs text-fg-muted hover:text-fg">Cancel</Link> : null} />
            <CardBody>
              <ActionForm key={editing?.id ?? "new"} action={saveCustomer} resetOnSuccess={!editing} redirectTo={() => (editing ? "/app/customers" : null)} className="space-y-3">
                {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
                <Field label="Name" htmlFor="cname"><Input id="cname" name="name" defaultValue={editing?.name} required maxLength={200} /></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Email" htmlFor="cemail"><Input id="cemail" name="email" type="email" defaultValue={editing?.email ?? ""} /></Field>
                  <Field label="Phone" htmlFor="cphone"><Input id="cphone" name="phone" defaultValue={editing?.phone ?? ""} /></Field>
                </div>
                <Field label="Company" htmlFor="ccompany"><Input id="ccompany" name="company" defaultValue={editing?.company ?? ""} /></Field>
                <Field label="Address" htmlFor="caddress"><Input id="caddress" name="address" defaultValue={editing?.address ?? ""} /></Field>
                <Field label="Notes" htmlFor="cnotes"><Textarea id="cnotes" name="notes" defaultValue={editing?.notes ?? ""} className="min-h-16" /></Field>
                <fieldset className="space-y-2 rounded-lg border border-line p-3">
                  <legend className="px-1 text-xs text-fg-muted">Contact consent (record only what the customer agreed to)</legend>
                  <Checkbox name="consent_email" label="Email reminders" defaultChecked={editing?.consent_email} />
                  <Checkbox name="consent_sms" label="SMS" defaultChecked={editing?.consent_sms} />
                  <Checkbox name="consent_whatsapp" label="WhatsApp" defaultChecked={editing?.consent_whatsapp} />
                </fieldset>
                <SubmitButton>{editing ? "Save changes" : "Add customer"}</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
