import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { PageHeader, Forbidden, Notice } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { LinkButton } from "@/components/ui/button";
import { todayIso } from "@/lib/format";
import { addDays } from "@/lib/domain/cashflow";
import { createInvoice } from "../actions";
import { LineItemsEditor } from "../line-items";

export const metadata = { title: "New invoice" };

export default async function NewInvoicePage() {
  const ws = await getWorkspace();
  if (!can(ws.role, "records.write")) return <Forbidden requirement="member" />;
  const { data: customers } = await ws.supabase.from("customers").select("id, name, is_sample").eq("organization_id", ws.org.organizationId).order("name");
  const today = todayIso();
  return (
    <>
      <PageHeader eyebrow="CollectIQ" title="New invoice" description="Invoices start as drafts. Issue them when ready; totals are calculated on the server." />
      {!customers?.length ? (
        <Notice tone="warning" title="Add a customer first">
          Invoices must belong to a customer. <LinkButton href="/app/customers" size="sm" variant="secondary" className="ml-2">Add customer</LinkButton>
        </Notice>
      ) : (
        <Card>
          <CardBody>
            <ActionForm action={createInvoice} redirectTo={(d) => `/app/invoices/${d.id}`} className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Customer" htmlFor="customer_id">
                  <Select id="customer_id" name="customer_id" required defaultValue="">
                    <option value="" disabled>Select customer</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_sample ? " (sample)" : ""}</option>)}
                  </Select>
                </Field>
                <Field label="Currency" htmlFor="currency">
                  <Select id="currency" name="currency" defaultValue={ws.org.defaultCurrency}>
                    {SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}
                  </Select>
                </Field>
                <Field label="Issue date" htmlFor="issue_date"><Input id="issue_date" name="issue_date" type="date" defaultValue={today} required /></Field>
                <Field label="Due date" htmlFor="due_date"><Input id="due_date" name="due_date" type="date" defaultValue={addDays(today, 14)} required /></Field>
              </div>
              <LineItemsEditor currency={ws.org.defaultCurrency} />
              <div className="grid gap-4 sm:grid-cols-[200px_1fr]">
                <Field label="Discount (amount)" htmlFor="discount" hint="Applied to the invoice total"><Input id="discount" name="discount" inputMode="decimal" placeholder="0.00" /></Field>
                <Field label="Notes" htmlFor="notes"><Textarea id="notes" name="notes" className="min-h-10" maxLength={2000} placeholder="Payment instructions, bank details…" /></Field>
              </div>
              <div className="flex justify-end gap-2">
                <LinkButton href="/app/invoices" variant="ghost">Cancel</LinkButton>
                <SubmitButton pendingLabel="Saving…">Create draft</SubmitButton>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      )}
    </>
  );
}
