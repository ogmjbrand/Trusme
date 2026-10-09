import "server-only";
import { z } from "zod";
import { formatMoney, totalsByCurrency } from "@/lib/money";
import { draftReminder, overdueList, type InvoiceLike } from "@/lib/domain/receivables";
import { ToolError, type ToolDefinition } from "@/lib/execution/types";
import { must, today, type AppToolContext } from "./context";

const overdueItem = z.object({
  invoiceId: z.string(),
  invoiceNumber: z.string(),
  customerId: z.string(),
  customerName: z.string().nullable(),
  currency: z.string(),
  balanceMinor: z.number(),
  daysOverdue: z.number(),
  bucket: z.string(),
});

async function loadOpenInvoices(ctx: AppToolContext, ids?: string[]): Promise<InvoiceLike[]> {
  let q = ctx.db
    .from("invoices")
    .select("id, invoice_number, customer_id, status, currency, total_minor, amount_paid_minor, due_date, issue_date, customers(name)")
    .eq("organization_id", ctx.orgId)
    .in("status", ["issued", "partially_paid"]);
  if (ids?.length) q = q.in("id", ids);
  const rows = must(await q.limit(500), "load invoices") as unknown as (InvoiceLike & { customers: { name: string } | null })[];
  return rows.map((r) => ({ ...r, customer_name: r.customers?.name ?? null }));
}

export const findOverdueInvoices: ToolDefinition<{ minDaysOverdue: number; limit: number }, { asOf: string; items: z.infer<typeof overdueItem>[]; totals: { currency: string; amountMinor: number }[] }, AppToolContext> = {
  id: "invoices.find_overdue",
  title: "Find overdue invoices",
  description: "Lists issued invoices past their due date with outstanding balances, grouped by aging bucket. Read-only.",
  module: "collectiq",
  sideEffect: "read",
  inputSchema: z.object({
    minDaysOverdue: z.number().int().min(1).max(365).default(1),
    limit: z.number().int().min(1).max(200).default(50),
  }),
  outputSchema: z.object({
    asOf: z.string(),
    items: z.array(overdueItem),
    totals: z.array(z.object({ currency: z.string(), amountMinor: z.number() })),
  }),
  minRole: "viewer",
  retry: { maxAttempts: 3, idempotent: true },
  timeoutMs: 20_000,
  summarize: (i) => `Read invoices overdue by at least ${i.minDaysOverdue} day(s)`,
  async run(ctx, input) {
    const asOf = today(ctx);
    const items = overdueList(await loadOpenInvoices(ctx), asOf)
      .filter((i) => i.daysOverdue >= input.minDaysOverdue)
      .slice(0, input.limit);
    const totals = totalsByCurrency(items.map((i) => ({ amountMinor: i.balanceMinor, currency: i.currency })));
    return {
      output: { asOf, items, totals },
      outcome: "analyzed",
      refs: items.slice(0, 10).map((i) => ({ type: "invoice", id: i.invoiceId, label: i.invoiceNumber, href: `/app/invoices/${i.invoiceId}` })),
    };
  },
};

type DraftInput = { scope: "all_overdue" | "selected"; invoiceIds: string[]; channel: "email"; minDaysOverdue: number };
type DraftOutput = {
  drafts: { reminderId: string; invoiceId: string; invoiceNumber: string; recipient: string | null; canSend: boolean; blocker: string | null }[];
  skipped: { invoiceId: string; reason: string }[];
};

export const draftReminders: ToolDefinition<DraftInput, DraftOutput, AppToolContext> = {
  id: "reminders.draft",
  title: "Draft payment reminders",
  description: "Prepares (does not send) polite payment reminder drafts for overdue invoices. Reversible: drafts can be edited or cancelled.",
  module: "collectiq",
  sideEffect: "reversible_write",
  inputSchema: z.object({
    scope: z.enum(["all_overdue", "selected"]).default("all_overdue"),
    invoiceIds: z.array(z.string().uuid()).max(50).default([]),
    channel: z.literal("email").default("email"),
    minDaysOverdue: z.number().int().min(0).max(365).default(1),
  }),
  outputSchema: z.object({
    drafts: z.array(z.object({ reminderId: z.string(), invoiceId: z.string(), invoiceNumber: z.string(), recipient: z.string().nullable(), canSend: z.boolean(), blocker: z.string().nullable() })),
    skipped: z.array(z.object({ invoiceId: z.string(), reason: z.string() })),
  }),
  minRole: "member",
  retry: { maxAttempts: 3, idempotent: true },
  timeoutMs: 30_000,
  summarize: (i) => (i.scope === "selected" ? `Draft email reminders for ${i.invoiceIds.length} selected invoice(s)` : `Draft email reminders for all invoices overdue by ${i.minDaysOverdue}+ day(s)`),
  async run(ctx, input) {
    const asOf = today(ctx);
    const invoices = await loadOpenInvoices(ctx, input.scope === "selected" ? input.invoiceIds : undefined);
    const targets = input.scope === "selected" ? invoices : invoices.filter((i) => overdueList([i], asOf).some((o) => o.daysOverdue >= input.minDaysOverdue));
    const skipped: DraftOutput["skipped"] = [];
    if (input.scope === "selected") {
      for (const id of input.invoiceIds) if (!invoices.some((i) => i.id === id)) skipped.push({ invoiceId: id, reason: "Not found, already paid, void or still a draft" });
    }
    const org = must(await ctx.db.from("organizations").select("name").eq("id", ctx.orgId).single(), "load org") as { name: string };
    const custIds = [...new Set(targets.map((t) => t.customer_id))];
    const customers = custIds.length
      ? (must(await ctx.db.from("customers").select("id, name, email, consent_email").eq("organization_id", ctx.orgId).in("id", custIds), "load customers") as { id: string; name: string; email: string | null; consent_email: boolean }[])
      : [];

    const drafts: DraftOutput["drafts"] = [];
    for (const inv of targets) {
      const c = customers.find((x) => x.id === inv.customer_id);
      const balance = inv.total_minor - inv.amount_paid_minor;
      const days = Math.max(0, Math.round((Date.parse(asOf) - Date.parse(inv.due_date)) / 86_400_000));
      const { subject, body } = draftReminder({
        businessName: org.name,
        customerName: c?.name ?? "Customer",
        invoiceNumber: inv.invoice_number,
        balance: formatMoney(balance, inv.currency),
        dueDate: inv.due_date,
        daysOverdue: days,
      });
      const key = `${ctx.idempotencyKey}:${inv.id}`;
      const blocker = !c?.email ? "Customer has no email address" : !c.consent_email ? "Customer has not consented to email reminders" : null;
      const upsert = await ctx.db
        .from("payment_reminders")
        .upsert(
          {
            organization_id: ctx.orgId,
            invoice_id: inv.id,
            channel: "email",
            recipient: c?.email ?? null,
            subject,
            body,
            status: "draft",
            execution_id: ctx.executionId,
            idempotency_key: key,
            created_by: ctx.actorUserId,
          },
          { onConflict: "organization_id,idempotency_key", ignoreDuplicates: true },
        );
      must(upsert, "create reminder draft");
      const row = must(await ctx.db.from("payment_reminders").select("id").eq("organization_id", ctx.orgId).eq("idempotency_key", key).single(), "read reminder") as { id: string };
      drafts.push({ reminderId: row.id, invoiceId: inv.id, invoiceNumber: inv.invoice_number, recipient: c?.email ?? null, canSend: !blocker, blocker });
    }
    await ctx.audit("reminders.drafted", "payment_reminder", null, { count: drafts.length });
    return {
      output: { drafts, skipped },
      outcome: drafts.length ? "prepared" : "no_op",
      refs: drafts.map((d) => ({ type: "payment_reminder", id: d.reminderId, label: `Reminder · ${d.invoiceNumber}`, href: `/app/invoices/${d.invoiceId}` })),
    };
  },
  async verify(ctx, _input, result) {
    const ids = result.output.drafts.map((d) => d.reminderId);
    if (!ids.length) return { status: "verified", detail: "No reminders were needed." };
    const rows = must(await ctx.db.from("payment_reminders").select("id").eq("organization_id", ctx.orgId).in("id", ids), "verify reminders") as unknown[];
    return rows.length === ids.length
      ? { status: "verified", detail: `${rows.length} draft(s) present in the database.` }
      : { status: "failed", detail: `Expected ${ids.length} drafts, found ${rows.length}.` };
  },
};

const resolvedReminder = z.object({
  reminderId: z.string().uuid(),
  invoiceNumber: z.string(),
  recipient: z.string().email(),
  balance: z.string(),
});
type SendInput = { scope: "execution_drafts" | "selected"; reminderIds: string[]; reminders: z.infer<typeof resolvedReminder>[] };
type SendOutput = { sent: { reminderId: string; recipient: string; providerMessageId: string }[]; failed: { reminderId: string; reason: string }[] };

export const sendReminders: ToolDefinition<SendInput, SendOutput, AppToolContext> = {
  id: "reminders.send",
  title: "Send payment reminders",
  description: "Emails previously drafted payment reminders to customers who consented to email. Consequential: always requires approval of the exact recipients.",
  module: "collectiq",
  sideEffect: "consequential",
  inputSchema: z.object({
    scope: z.enum(["execution_drafts", "selected"]).default("execution_drafts"),
    reminderIds: z.array(z.string().uuid()).max(50).default([]),
    reminders: z.array(resolvedReminder).max(50).default([]),
  }),
  outputSchema: z.object({
    sent: z.array(z.object({ reminderId: z.string(), recipient: z.string(), providerMessageId: z.string() })),
    failed: z.array(z.object({ reminderId: z.string(), reason: z.string() })),
  }),
  minRole: "member",
  approverMinRole: "member",
  retry: { maxAttempts: 1, idempotent: false },
  timeoutMs: 60_000,
  summarize: (i) =>
    i.reminders.length
      ? `Email ${i.reminders.length} payment reminder(s): ${i.reminders.map((r) => `${r.invoiceNumber} → ${r.recipient} (${r.balance})`).join("; ")}`
      : i.scope === "execution_drafts"
        ? "Email the payment reminders drafted in this execution (recipients resolved before approval)"
        : `Email ${i.reminderIds.length} selected reminder(s)`,
  async resolve(ctx, input) {
    if (!ctx.email.configured) {
      throw new ToolError("Email delivery is not configured. Reminders remain as drafts and can be sent once email is set up.", { code: "setup_required", setupRequired: ctx.email.missing });
    }
    let q = ctx.db
      .from("payment_reminders")
      .select("id, recipient, status, invoices(invoice_number, currency, total_minor, amount_paid_minor, customers(consent_email))")
      .eq("organization_id", ctx.orgId)
      .in("status", ["draft", "approved"]);
    q = input.scope === "selected" ? q.in("id", input.reminderIds.length ? input.reminderIds : ["00000000-0000-0000-0000-000000000000"]) : q.eq("execution_id", ctx.executionId);
    type Row = { id: string; recipient: string | null; invoices: { invoice_number: string; currency: string; total_minor: number; amount_paid_minor: number; customers: { consent_email: boolean } | null } | null };
    const rows = must(await q, "resolve reminders") as unknown as Row[];
    const reminders = rows
      .filter((r) => r.recipient && r.invoices?.customers?.consent_email && r.invoices.total_minor > r.invoices.amount_paid_minor)
      .map((r) => ({
        reminderId: r.id,
        invoiceNumber: r.invoices!.invoice_number,
        recipient: r.recipient!,
        balance: formatMoney(r.invoices!.total_minor - r.invoices!.amount_paid_minor, r.invoices!.currency),
      }));
    if (!reminders.length) throw new ToolError("No sendable reminders: drafts are missing, already sent, lack a recipient email, or the customer has not consented to email.", { code: "nothing_to_send" });
    return { scope: "selected", reminderIds: reminders.map((r) => r.reminderId), reminders };
  },
  async run(ctx, input) {
    const sent: SendOutput["sent"] = [];
    const failed: SendOutput["failed"] = [];
    for (const r of input.reminders) {
      // Re-check state immediately before sending: never send twice, never send without consent.
      const row = must(
        await ctx.db
          .from("payment_reminders")
          .select("id, status, recipient, subject, body, invoices(customers(consent_email))")
          .eq("organization_id", ctx.orgId)
          .eq("id", r.reminderId)
          .maybeSingle(),
        "load reminder",
      ) as unknown as { id: string; status: string; recipient: string; subject: string; body: string; invoices: { customers: { consent_email: boolean } | null } | null } | null;
      if (!row || !["draft", "approved"].includes(row.status)) { failed.push({ reminderId: r.reminderId, reason: `Not sendable (status ${row?.status ?? "missing"})` }); continue; }
      if (row.recipient !== r.recipient) { failed.push({ reminderId: r.reminderId, reason: "Recipient changed after approval" }); continue; }
      if (!row.invoices?.customers?.consent_email) { failed.push({ reminderId: r.reminderId, reason: "Customer consent was withdrawn" }); continue; }
      try {
        const res = await ctx.email.send({ to: row.recipient, subject: row.subject ?? "Payment reminder", text: row.body, idempotencyKey: `reminder-${row.id}` });
        must(await ctx.db.from("payment_reminders").update({ status: "sent", sent_at: new Date().toISOString(), provider: res.provider, provider_message_id: res.messageId }).eq("organization_id", ctx.orgId).eq("id", row.id), "mark sent");
        sent.push({ reminderId: row.id, recipient: row.recipient, providerMessageId: res.messageId });
        await ctx.audit("reminder.sent", "payment_reminder", row.id, { recipient: row.recipient, provider: res.provider, provider_message_id: res.messageId });
      } catch (err) {
        const reason = (err as Error).message;
        must(await ctx.db.from("payment_reminders").update({ status: "failed", failure_reason: reason }).eq("organization_id", ctx.orgId).eq("id", row.id), "mark failed");
        failed.push({ reminderId: row.id, reason });
      }
    }
    if (!sent.length) throw new ToolError(`No reminders were sent. ${failed.map((f) => f.reason).join("; ")}`, { code: "send_failed" });
    return {
      output: { sent, failed },
      outcome: "sent",
      refs: sent.map((s) => ({ type: "payment_reminder", id: s.reminderId, label: `Sent to ${s.recipient}` })),
    };
  },
  async verify(_ctx, _input, result) {
    const { sent, failed } = result.output;
    return failed.length
      ? { status: "unverified", detail: `${sent.length} accepted by the email provider; ${failed.length} not sent: ${failed.map((f) => f.reason).join("; ")}` }
      : { status: "verified", detail: `${sent.length} message(s) accepted by the email provider (delivery to inbox is not confirmed).` };
  },
};
