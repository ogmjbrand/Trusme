import { notFound } from "next/navigation";
import { randomUUID } from "node:crypto";
import { Download, Mail } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney, toMajorString } from "@/lib/money";
import { daysOverdue, isOverdue, outstanding, type InvoiceLike } from "@/lib/domain/receivables";
import { PageHeader, DefinitionList, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, SampleBadge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { fmtDate, fmtDateTime, qty, todayIso } from "@/lib/format";
import { paystack } from "@/lib/integrations/payments/paystack";
import { stripe } from "@/lib/integrations/payments/stripe";
import { resendSender } from "@/lib/integrations/email";
import {
  addPromise, cancelReminder, draftInvoiceReminder, recordPayment, requestReminderSend, reversePayment, setInvoiceStatus, setPromiseStatus, updateReminderDraft,
} from "../actions";
import { PaymentLinkForm } from "./payment-link-form";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getWorkspace();
  const org = ws.org.organizationId;
  const { data: inv } = await ws.supabase
    .from("invoices")
    .select("*, customers(id, name, email, phone, consent_email)")
    .eq("id", id)
    .eq("organization_id", org)
    .maybeSingle();
  if (!inv) notFound();
  const [items, payments, promises, reminders] = await Promise.all([
    ws.supabase.from("invoice_items").select("*").eq("invoice_id", id).order("position"),
    ws.supabase.from("payments").select("*").eq("invoice_id", id).order("received_at", { ascending: false }),
    ws.supabase.from("payment_promises").select("*").eq("invoice_id", id).order("promised_date"),
    ws.supabase.from("payment_reminders").select("*").eq("invoice_id", id).order("created_at", { ascending: false }),
  ]);
  const i = inv as InvoiceLike & Record<string, unknown> & { customers: { id: string; name: string; email: string | null; consent_email: boolean } | null; is_sample: boolean; subtotal_minor: number; tax_minor: number; discount_minor: number; notes: string | null; source_execution_id: string | null };
  const today = todayIso();
  const bal = outstanding(i);
  const od = isOverdue(i, today);
  const canWrite = can(ws.role, "records.write");
  const canPay = can(ws.role, "payments.record");
  const open = ["issued", "partially_paid"].includes(i.status);
  const providers = [paystack(), stripe()].filter((p) => p.configured).map((p) => p.id);
  const email = resendSender();

  return (
    <>
      <PageHeader
        eyebrow="CollectIQ · Invoice"
        title={<span className="flex flex-wrap items-center gap-2">{i.invoice_number} <StatusBadge status={i.status} />{od ? <Badge tone="danger">{daysOverdue(i, today)} days overdue</Badge> : null}{i.is_sample ? <SampleBadge /> : null}</span>}
        description={`${i.customers?.name ?? "Customer"} · issued ${fmtDate(i.issue_date as string)} · due ${fmtDate(i.due_date)}`}
        actions={
          <>
            <a href={`/api/invoices/${i.id}/pdf`} className={buttonClass("secondary", "sm")}><Download className="h-3.5 w-3.5" />PDF</a>
            {canWrite && i.status === "draft" ? <InlineAction action={setInvoiceStatus} fields={{ id: i.id, status: "issued" }} label="Issue invoice" variant="primary" confirm="Issue this invoice? Line items and amounts will be locked." /> : null}
            {canWrite && (i.status === "draft" || (i.status === "issued" && i.amount_paid_minor === 0)) ? <InlineAction action={setInvoiceStatus} fields={{ id: i.id, status: "void" }} label="Void" variant="danger" confirm="Void this invoice? This cannot be undone." /> : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Line items" />
            <Table>
              <THead><TR><TH>Description</TH><TH className="text-right">Qty</TH><TH className="text-right">Unit price</TH><TH className="text-right">Tax</TH><TH className="text-right">Line total</TH></TR></THead>
              <TBody>
                {(items.data ?? []).map((l) => (
                  <TR key={l.id}>
                    <TD>{l.description}</TD>
                    <TD className="tabular text-right">{qty(l.quantity)}</TD>
                    <TD className="tabular text-right">{formatMoney(l.unit_price_minor, i.currency)}</TD>
                    <TD className="tabular text-right">{(l.tax_rate_bps / 100).toFixed(2)}%</TD>
                    <TD className="tabular text-right">{formatMoney(Math.round(Number(l.quantity) * l.unit_price_minor), i.currency)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            <CardBody className="border-t border-line">
              <dl className="ml-auto max-w-xs space-y-1 text-sm">
                <Row label="Subtotal" value={formatMoney(i.subtotal_minor, i.currency)} />
                <Row label="Tax" value={formatMoney(i.tax_minor, i.currency)} />
                {i.discount_minor ? <Row label="Discount" value={`−${formatMoney(i.discount_minor, i.currency)}`} /> : null}
                <Row label="Total" value={formatMoney(i.total_minor, i.currency)} strong />
                <Row label="Paid" value={formatMoney(i.amount_paid_minor, i.currency)} />
                <Row label="Balance due" value={formatMoney(bal, i.currency)} strong tone={od ? "danger" : undefined} />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payments" description="Manual payments are recorded by your team. Provider payments are recorded only after a verified webhook." />
            {(payments.data ?? []).length ? (
              <ul className="divide-y divide-line">
                {(payments.data ?? []).map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <span className="tabular font-medium text-fg">{formatMoney(p.amount_minor, p.currency)}</span>
                    <StatusBadge status={p.status} />
                    <Badge tone={p.source === "provider_verified" ? "brand" : "neutral"}>{p.source === "provider_verified" ? `verified by ${p.provider}` : `manual · ${p.method.replace("_", " ")}`}</Badge>
                    <span className="text-xs text-fg-subtle">{fmtDateTime(p.received_at)}</span>
                    {p.notes ? <span className="text-xs text-fg-muted">{p.notes}</span> : null}
                    {can(ws.role, "payments.reverse") && p.status === "succeeded" ? (
                      <ActionForm action={reversePayment} className="ml-auto flex gap-2">
                        <input type="hidden" name="payment_id" value={p.id} />
                        <Input name="reason" placeholder="Reason for reversal" className="h-8 w-44 text-xs" required minLength={3} />
                        <SubmitButton variant="danger" size="sm">Reverse</SubmitButton>
                      </ActionForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <CardBody><p className="text-sm text-fg-subtle">No payments recorded.</p></CardBody>
            )}
            {canPay && open ? (
              <CardBody className="border-t border-line">
                <ActionForm action={recordPayment} resetOnSuccess className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <input type="hidden" name="invoice_id" value={i.id} />
                  <input type="hidden" name="idempotency_key" value={randomUUID()} />
                  <Field label={`Amount (${i.currency})`} htmlFor="amount"><Input id="amount" name="amount" inputMode="decimal" defaultValue={toMajorString(bal, i.currency)} required /></Field>
                  <Field label="Method" htmlFor="method">
                    <Select id="method" name="method" defaultValue="bank_transfer">
                      <option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option><option value="pos">POS</option><option value="card">Card</option><option value="mobile_money">Mobile money</option><option value="other">Other</option>
                    </Select>
                  </Field>
                  <Field label="Date received" htmlFor="received_at"><Input id="received_at" name="received_at" type="date" defaultValue={today} max={today} required /></Field>
                  <Field label="Reference / note" htmlFor="pnotes"><Input id="pnotes" name="notes" maxLength={500} placeholder="Bank ref, teller no." /></Field>
                  <div className="sm:col-span-2 lg:col-span-4"><SubmitButton size="sm">Record manual payment</SubmitButton></div>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>

          <Card>
            <CardHeader title="Payment reminders" description="Drafts are never sent automatically. Sending requires consent and an approval." actions={canWrite && open ? <InlineAction action={draftInvoiceReminder} fields={{ invoice_id: i.id }} label={<><Mail className="h-3.5 w-3.5" />Draft reminder</>} /> : null} />
            {!email.configured ? <CardBody className="pb-0"><Notice tone="info">Email delivery is not configured ({email.missing.join(", ")}). Drafts can be prepared and copied, but not sent from TrustOS.</Notice></CardBody> : null}
            {i.customers && !i.customers.consent_email ? <CardBody className="pb-0"><Notice tone="warning">{i.customers.name} has not consented to email reminders. Update consent on the customer record before sending.</Notice></CardBody> : null}
            <ul className="divide-y divide-line">
              {(reminders.data ?? []).map((r) => (
                <li key={r.id} className="space-y-2 px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <StatusBadge status={r.status} />
                    <span className="text-fg-subtle">to {r.recipient ?? "no email on file"} · created {fmtDateTime(r.created_at)}{r.sent_at ? ` · sent ${fmtDateTime(r.sent_at)}` : ""}</span>
                    {r.failure_reason ? <span className="text-danger">{r.failure_reason}</span> : null}
                  </div>
                  {r.status === "draft" && canWrite ? (
                    <ActionForm action={updateReminderDraft} className="space-y-2">
                      <input type="hidden" name="id" value={r.id} />
                      <Input name="subject" defaultValue={r.subject ?? ""} aria-label="Subject" />
                      <Textarea name="body" defaultValue={r.body} aria-label="Message" className="min-h-40 text-xs" />
                      <div className="flex flex-wrap gap-2">
                        <SubmitButton variant="secondary" size="sm">Save draft</SubmitButton>
                      </div>
                    </ActionForm>
                  ) : (
                    <pre className="whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-xs text-fg-muted">{r.body}</pre>
                  )}
                  {r.status === "draft" && canWrite ? (
                    <div className="flex flex-wrap gap-2">
                      <ActionForm action={requestReminderSend} redirectTo={(d) => `/app/tasks/${d.executionId}`}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton size="sm" disabled={!email.configured || !r.recipient || !i.customers?.consent_email}>Request send (needs approval)</SubmitButton>
                      </ActionForm>
                      <InlineAction action={cancelReminder} fields={{ id: r.id }} label="Discard" variant="ghost" />
                    </div>
                  ) : null}
                </li>
              ))}
              {!reminders.data?.length ? <li className="px-5 py-4 text-sm text-fg-subtle">No reminders yet.</li> : null}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Customer" />
            <CardBody>
              <DefinitionList items={[
                { label: "Name", value: i.customers?.name },
                { label: "Email", value: i.customers?.email },
                { label: "Email consent", value: i.customers?.consent_email ? "Yes" : "No" },
                { label: "Currency", value: i.currency },
              ]} />
              {i.notes ? <p className="mt-4 whitespace-pre-wrap text-xs text-fg-muted">{i.notes}</p> : null}
              {i.source_execution_id ? <p className="mt-3 text-xs text-fg-subtle">Created by an execution.</p> : null}
            </CardBody>
          </Card>

          {open && canPay ? (
            <Card>
              <CardHeader title="Payment link" description="Customer pays online; TrustOS records it only after the provider's signed webhook is verified." />
              <CardBody>
                {providers.length ? <PaymentLinkForm invoiceId={i.id} providers={providers} /> : <p className="text-xs text-fg-muted">No payment provider is configured. Set PAYSTACK_SECRET_KEY or STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET to enable payment links. Until then, record payments manually.</p>}
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Payment promises" />
            <ul className="divide-y divide-line">
              {(promises.data ?? []).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm">
                  <span className="tabular">{formatMoney(p.promised_amount_minor, i.currency)}</span>
                  <span className="text-xs text-fg-subtle">by {fmtDate(p.promised_date)}</span>
                  <StatusBadge status={p.status === "open" && p.promised_date < today ? "overdue" : p.status} label={p.status === "open" && p.promised_date < today ? "due date passed" : p.status} />
                  {p.status === "open" && canWrite ? (
                    <span className="ml-auto flex gap-1">
                      <InlineAction action={setPromiseStatus} fields={{ id: p.id, status: "kept" }} label="Kept" variant="ghost" />
                      <InlineAction action={setPromiseStatus} fields={{ id: p.id, status: "broken" }} label="Broken" variant="ghost" />
                    </span>
                  ) : null}
                  {p.note ? <p className="w-full text-xs text-fg-muted">{p.note}</p> : null}
                </li>
              ))}
              {!promises.data?.length ? <li className="px-5 py-3 text-sm text-fg-subtle">None recorded.</li> : null}
            </ul>
            {canWrite && open ? (
              <CardBody className="border-t border-line">
                <ActionForm action={addPromise} resetOnSuccess className="grid grid-cols-2 gap-2">
                  <input type="hidden" name="invoice_id" value={i.id} />
                  <Field label="Amount" htmlFor="pamount"><Input id="pamount" name="amount" inputMode="decimal" required /></Field>
                  <Field label="Promised date" htmlFor="pdate"><Input id="pdate" name="promised_date" type="date" min={today} required /></Field>
                  <Input name="note" placeholder="Note (e.g. agreed on call)" className="col-span-2" maxLength={500} />
                  <SubmitButton size="sm" variant="secondary" className="col-span-2">Record promise</SubmitButton>
                </ActionForm>
              </CardBody>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: "danger" }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-fg-muted">{label}</dt>
      <dd className={`tabular ${strong ? "font-semibold" : ""} ${tone === "danger" ? "text-danger" : "text-fg"}`}>{value}</dd>
    </div>
  );
}
