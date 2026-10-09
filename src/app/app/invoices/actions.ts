"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { getWorkspace, requirePermission } from "@/lib/auth/context";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { formatMoney, parseMajor } from "@/lib/money";
import { draftReminder } from "@/lib/domain/receivables";
import { getEngine } from "@/lib/execution/server";
import { env } from "@/lib/env";
import { paystack } from "@/lib/integrations/payments/paystack";
import { stripe } from "@/lib/integrations/payments/stripe";

const uuid = z.string().uuid();
const opt = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------
const customerSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().optional(),
  phone: z.string().trim().max(40).optional(),
  company: z.string().trim().max(200).optional(),
  address: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
  consent_email: z.boolean(),
  consent_sms: z.boolean(),
  consent_whatsapp: z.boolean(),
});

function readCustomer(form: FormData) {
  return customerSchema.parse({
    name: form.get("name"),
    email: opt(form.get("email")),
    phone: opt(form.get("phone")),
    company: opt(form.get("company")),
    address: opt(form.get("address")),
    notes: opt(form.get("notes")),
    consent_email: form.get("consent_email") === "on",
    consent_sms: form.get("consent_sms") === "on",
    consent_whatsapp: form.get("consent_whatsapp") === "on",
  });
}

export async function saveCustomer(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const data = readCustomer(form);
    const id = opt(form.get("id"));
    if (id) {
      uuid.parse(id);
      unwrap(await ws.supabase.from("customers").update(data).eq("id", id).eq("organization_id", ws.org.organizationId));
      await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "customer.updated", resourceType: "customer", resourceId: id, metadata: { consent_email: data.consent_email } });
      revalidatePath("/app/customers");
      return { id };
    }
    const row = unwrap(await ws.supabase.from("customers").insert({ ...data, organization_id: ws.org.organizationId, created_by: ws.user.id }).select("id").single()) as { id: string };
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "customer.created", resourceType: "customer", resourceId: row.id });
    revalidatePath("/app/customers");
    return { id: row.id };
  }, "Customer saved");
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------
export async function createInvoice(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const head = z
      .object({
        customer_id: uuid,
        currency: z.string().regex(/^[A-Z]{3}$/),
        issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().max(2000).optional(),
        discount: z.string().optional(),
      })
      .refine((v) => v.due_date >= v.issue_date, { message: "Due date must be on or after the issue date", path: ["due_date"] })
      .parse({ customer_id: form.get("customer_id"), currency: form.get("currency"), issue_date: form.get("issue_date"), due_date: form.get("due_date"), notes: opt(form.get("notes")), discount: opt(form.get("discount")) });

    const desc = form.getAll("item_description").map(String);
    const qty = form.getAll("item_quantity").map(String);
    const price = form.getAll("item_price").map(String);
    const tax = form.getAll("item_tax").map(String);
    const items = desc
      .map((d, i) => ({ description: d.trim(), quantity: qty[i] ?? "", price: price[i] ?? "", tax: tax[i] ?? "0" }))
      .filter((i) => i.description || i.price);
    if (!items.length) throw new z.ZodError([{ code: "custom", path: ["items"], message: "Add at least one line item", input: undefined }]);
    const lines = items.map((i, idx) =>
      z
        .object({
          description: z.string().min(1, `Line ${idx + 1}: description required`).max(500),
          quantity: z.coerce.number().positive(`Line ${idx + 1}: quantity must be positive`).max(1_000_000),
          unit_price_minor: z.number().int().min(0),
          tax_rate_bps: z.number().int().min(0).max(10000),
        })
        .parse({ description: i.description, quantity: i.quantity, unit_price_minor: parseMajor(i.price || "0", head.currency), tax_rate_bps: Math.round(Number(i.tax || 0) * 100) }),
    );

    const { data: cust } = await ws.supabase.from("customers").select("id").eq("id", head.customer_id).eq("organization_id", ws.org.organizationId).maybeSingle();
    if (!cust) throw new Error("Customer not found in this workspace");

    const number = unwrap(await ws.supabase.rpc("next_document_number", { p_org: ws.org.organizationId, p_kind: "invoice" })) as string;
    const inv = unwrap(
      await ws.supabase
        .from("invoices")
        .insert({
          organization_id: ws.org.organizationId,
          customer_id: head.customer_id,
          invoice_number: number,
          currency: head.currency,
          issue_date: head.issue_date,
          due_date: head.due_date,
          notes: head.notes ?? null,
          created_by: ws.user.id,
        })
        .select("id")
        .single(),
    ) as { id: string };
    unwrap(await ws.supabase.from("invoice_items").insert(lines.map((l, position) => ({ ...l, position, organization_id: ws.org.organizationId, invoice_id: inv.id }))));
    if (head.discount) {
      unwrap(await ws.supabase.from("invoices").update({ discount_minor: parseMajor(head.discount, head.currency) }).eq("id", inv.id));
    }
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "invoice.created", resourceType: "invoice", resourceId: inv.id, metadata: { number } });
    revalidatePath("/app/invoices");
    return { id: inv.id };
  }, "Draft invoice created");
}

export async function setInvoiceStatus(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const { id, status } = z.object({ id: uuid, status: z.enum(["issued", "void"]) }).parse({ id: form.get("id"), status: form.get("status") });
    const patch = status === "issued" ? { status, issued_at: new Date().toISOString() } : { status, voided_at: new Date().toISOString() };
    unwrap(await ws.supabase.from("invoices").update(patch).eq("id", id).eq("organization_id", ws.org.organizationId));
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: `invoice.${status}`, resourceType: "invoice", resourceId: id });
    revalidatePath(`/app/invoices/${id}`);
    return null;
  }, "Invoice updated");
}

export async function recordPayment(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("payments.record");
    const input = z
      .object({
        invoice_id: uuid,
        amount: z.string().min(1),
        method: z.enum(["cash", "bank_transfer", "pos", "card", "mobile_money", "other"]),
        received_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        notes: z.string().max(500).optional(),
        idempotency_key: z.string().min(8).max(100),
      })
      .parse({ invoice_id: form.get("invoice_id"), amount: form.get("amount"), method: form.get("method"), received_at: form.get("received_at"), notes: opt(form.get("notes")), idempotency_key: form.get("idempotency_key") });
    const inv = unwrap(await ws.supabase.from("invoices").select("id, currency, customer_id, total_minor, amount_paid_minor").eq("id", input.invoice_id).eq("organization_id", ws.org.organizationId).single()) as { id: string; currency: string; customer_id: string; total_minor: number; amount_paid_minor: number };
    const amount = parseMajor(input.amount, inv.currency);
    if (amount <= 0) throw new Error("Amount must be greater than zero");
    const balance = inv.total_minor - inv.amount_paid_minor;
    if (amount > balance) throw new Error(`Amount exceeds the outstanding balance of ${formatMoney(balance, inv.currency)}`);
    const { data: existing } = await ws.supabase.from("payments").select("id").eq("organization_id", ws.org.organizationId).eq("idempotency_key", input.idempotency_key).maybeSingle();
    if (existing) return null; // duplicate submit: already recorded
    const pay = unwrap(
      await ws.supabase
        .from("payments")
        .insert({
          organization_id: ws.org.organizationId,
          invoice_id: inv.id,
          customer_id: inv.customer_id,
          amount_minor: amount,
          currency: inv.currency,
          method: input.method,
          source: "manual",
          status: "succeeded",
          received_at: new Date(input.received_at + "T12:00:00Z").toISOString(),
          notes: input.notes ?? null,
          idempotency_key: input.idempotency_key,
          recorded_by: ws.user.id,
        })
        .select("id")
        .single(),
    ) as { id: string };
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "payment.recorded", resourceType: "payment", resourceId: pay.id, metadata: { invoice_id: inv.id, amount_minor: amount, currency: inv.currency, source: "manual" } });
    // Mark promises kept when the invoice is now settled.
    const { data: updated } = await ws.supabase.from("invoices").select("status").eq("id", inv.id).single();
    if (updated?.status === "paid") await ws.supabase.from("payment_promises").update({ status: "kept" }).eq("invoice_id", inv.id).eq("status", "open");
    revalidatePath(`/app/invoices/${inv.id}`);
    return null;
  }, "Manual payment recorded");
}

export async function reversePayment(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("payments.reverse");
    const id = uuid.parse(form.get("payment_id"));
    const reason = z.string().trim().min(3).max(300).parse(form.get("reason"));
    const p = unwrap(await ws.supabase.from("payments").update({ status: "reversed", notes: `Reversed: ${reason}` }).eq("id", id).eq("organization_id", ws.org.organizationId).select("invoice_id").single()) as { invoice_id: string };
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "payment.reversed", resourceType: "payment", resourceId: id, metadata: { reason } });
    revalidatePath(`/app/invoices/${p.invoice_id}`);
    return null;
  }, "Payment reversed");
}

export async function addPromise(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const input = z.object({ invoice_id: uuid, amount: z.string().min(1), promised_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), note: z.string().max(500).optional() }).parse({ invoice_id: form.get("invoice_id"), amount: form.get("amount"), promised_date: form.get("promised_date"), note: opt(form.get("note")) });
    const inv = unwrap(await ws.supabase.from("invoices").select("currency").eq("id", input.invoice_id).eq("organization_id", ws.org.organizationId).single()) as { currency: string };
    unwrap(await ws.supabase.from("payment_promises").insert({ organization_id: ws.org.organizationId, invoice_id: input.invoice_id, promised_amount_minor: parseMajor(input.amount, inv.currency), promised_date: input.promised_date, note: input.note ?? null, recorded_by: ws.user.id }));
    revalidatePath(`/app/invoices/${input.invoice_id}`);
    return null;
  }, "Payment promise recorded");
}

export async function setPromiseStatus(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const { id, status } = z.object({ id: uuid, status: z.enum(["kept", "broken", "cancelled"]) }).parse({ id: form.get("id"), status: form.get("status") });
    const p = unwrap(await ws.supabase.from("payment_promises").update({ status }).eq("id", id).eq("organization_id", ws.org.organizationId).select("invoice_id").single()) as { invoice_id: string };
    revalidatePath(`/app/invoices/${p.invoice_id}`);
    return null;
  });
}

// ---------------------------------------------------------------------------
// Reminders: draft directly (reversible); sending always goes through the
// execution engine and the approval inbox.
// ---------------------------------------------------------------------------
export async function draftInvoiceReminder(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const id = uuid.parse(form.get("invoice_id"));
    const inv = unwrap(await ws.supabase.from("invoices").select("id, invoice_number, currency, total_minor, amount_paid_minor, due_date, status, customers(name, email)").eq("id", id).eq("organization_id", ws.org.organizationId).single()) as unknown as {
      id: string; invoice_number: string; currency: string; total_minor: number; amount_paid_minor: number; due_date: string; status: string; customers: { name: string; email: string | null } | null;
    };
    if (!["issued", "partially_paid"].includes(inv.status)) throw new Error("Reminders can only be drafted for issued, unpaid invoices");
    const days = Math.max(0, Math.round((Date.now() - Date.parse(inv.due_date + "T00:00:00Z")) / 86_400_000));
    const { subject, body } = draftReminder({ businessName: ws.org.name, customerName: inv.customers?.name ?? "Customer", invoiceNumber: inv.invoice_number, balance: formatMoney(inv.total_minor - inv.amount_paid_minor, inv.currency), dueDate: inv.due_date, daysOverdue: days });
    unwrap(await ws.supabase.from("payment_reminders").insert({ organization_id: ws.org.organizationId, invoice_id: id, channel: "email", recipient: inv.customers?.email ?? null, subject, body, status: "draft", created_by: ws.user.id }));
    revalidatePath(`/app/invoices/${id}`);
    return null;
  }, "Reminder drafted (not sent)");
}

export async function updateReminderDraft(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const input = z.object({ id: uuid, subject: z.string().min(1).max(200), body: z.string().min(10).max(5000) }).parse({ id: form.get("id"), subject: form.get("subject"), body: form.get("body") });
    const r = unwrap(await ws.supabase.from("payment_reminders").update({ subject: input.subject, body: input.body }).eq("id", input.id).eq("organization_id", ws.org.organizationId).eq("status", "draft").select("invoice_id").single()) as { invoice_id: string };
    revalidatePath(`/app/invoices/${r.invoice_id}`);
    return null;
  }, "Draft updated");
}

export async function cancelReminder(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const id = uuid.parse(form.get("id"));
    const r = unwrap(await ws.supabase.from("payment_reminders").update({ status: "cancelled" }).eq("id", id).eq("organization_id", ws.org.organizationId).in("status", ["draft", "approved"]).select("invoice_id").single()) as { invoice_id: string };
    revalidatePath(`/app/invoices/${r.invoice_id}`);
    return null;
  }, "Reminder cancelled");
}

export async function requestReminderSend(_: ActionResult<{ executionId: string }> | null, form: FormData): Promise<ActionResult<{ executionId: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("executions.create");
    const id = uuid.parse(form.get("id"));
    const { data: r } = await ws.supabase.from("payment_reminders").select("id, invoice_id").eq("id", id).eq("organization_id", ws.org.organizationId).eq("status", "draft").maybeSingle();
    if (!r) throw new Error("Draft not found");
    const engine = getEngine();
    const exec = await engine.createExecution({
      orgId: ws.org.organizationId,
      actorUserId: ws.user.id,
      request: "Send payment reminder",
      autoRunLowRisk: ws.preferences.ai_auto_run_low_risk,
      idempotencyKey: `send-reminder-${id}`,
      plan: { goal: "Send a payment reminder", summary: "Send the selected reminder after approval", planner: "manual", steps: [{ toolId: "reminders.send", title: "Send payment reminder", input: { scope: "selected", reminderIds: [id] } }] },
    });
    after(async () => {
      await engine.run(exec.id);
    });
    return { executionId: exec.id };
  }, "Send requested — approve it to deliver the email");
}

// ---------------------------------------------------------------------------
// Payment links (provider-verified payments arrive via webhook)
// ---------------------------------------------------------------------------
export async function createPaymentLink(_: ActionResult<{ url: string }> | null, form: FormData): Promise<ActionResult<{ url: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("payments.record");
    const { invoice_id, provider } = z.object({ invoice_id: uuid, provider: z.enum(["paystack", "stripe"]) }).parse({ invoice_id: form.get("invoice_id"), provider: form.get("provider") });
    const p = provider === "paystack" ? paystack() : stripe();
    if (!p.configured) throw new Error(`${provider} is not configured (${p.missing.join(", ")})`);
    const inv = unwrap(await ws.supabase.from("invoices").select("id, invoice_number, currency, total_minor, amount_paid_minor, status, customers(email)").eq("id", invoice_id).eq("organization_id", ws.org.organizationId).single()) as unknown as {
      id: string; invoice_number: string; currency: string; total_minor: number; amount_paid_minor: number; status: string; customers: { email: string | null } | null;
    };
    if (!["issued", "partially_paid"].includes(inv.status)) throw new Error("Payment links are only available for issued, unpaid invoices");
    if (!inv.customers?.email) throw new Error("The customer needs an email address for a payment link");
    const reference = `inv_${inv.id.slice(0, 8)}_${randomBytes(6).toString("hex")}`;
    const { url } = await p.createCheckout({
      amountMinor: inv.total_minor - inv.amount_paid_minor,
      currency: inv.currency,
      email: inv.customers.email,
      reference,
      callbackUrl: `${env().NEXT_PUBLIC_APP_URL}/app/invoices/${inv.id}`,
      metadata: { organization_id: ws.org.organizationId, invoice_id: inv.id, description: `Invoice ${inv.invoice_number}` },
    });
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "payment_link.created", resourceType: "invoice", resourceId: inv.id, metadata: { provider, reference } });
    return { url };
  }, "Payment link created. The invoice updates only when the provider confirms payment.");
}
