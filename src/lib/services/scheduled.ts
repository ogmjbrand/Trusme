import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatMoney } from "@/lib/money";
import { draftReminder, overdueList, type InvoiceLike } from "@/lib/domain/receivables";
import { addDays, occurrences } from "@/lib/domain/cashflow";

/**
 * Daily scheduled work (service role). Idempotent per org per day.
 *  - Reminder cadence: DRAFTS reminders for overdue invoices whose last
 *    reminder is older than the org's cadence. Never sends.
 *  - Obligation alerts: notifies owners/admins of obligations due within 3 days.
 */
export async function runDailyJobs(db: SupabaseClient, today: string): Promise<Record<string, unknown>> {
  const summary: Record<string, unknown> = { reminders: 0, obligationAlerts: 0 };

  const { data: orgs } = await db.from("organizations").select("id, name, reminder_cadence_days").not("reminder_cadence_days", "is", null);
  for (const org of orgs ?? []) {
    const claimed = await db.from("scheduled_job_runs").insert({ job: "reminder_cadence", organization_id: org.id, run_date: today }).select("job");
    if (claimed.error) continue; // already ran today (unique violation) or failed
    const { data: invs } = await db.from("invoices").select("id, invoice_number, customer_id, status, currency, total_minor, amount_paid_minor, due_date, customers(name, email, consent_email)").eq("organization_id", org.id).in("status", ["issued", "partially_paid"]);
    type Inv = InvoiceLike & { customers: { name: string; email: string | null; consent_email: boolean } | null };
    const overdue = overdueList((invs ?? []) as unknown as Inv[], today);
    let drafted = 0;
    for (const o of overdue) {
      const cutoff = addDays(today, -(org.reminder_cadence_days as number));
      const { data: recent } = await db.from("payment_reminders").select("id").eq("invoice_id", o.invoiceId).in("status", ["draft", "approved", "sent"]).gte("created_at", cutoff).limit(1);
      if (recent?.length) continue;
      const inv = (invs as unknown as Inv[]).find((i) => i.id === o.invoiceId)!;
      const { subject, body } = draftReminder({ businessName: org.name, customerName: inv.customers?.name ?? "Customer", invoiceNumber: o.invoiceNumber, balance: formatMoney(o.balanceMinor, o.currency), dueDate: inv.due_date, daysOverdue: o.daysOverdue });
      const ins = await db.from("payment_reminders").insert({ organization_id: org.id, invoice_id: o.invoiceId, channel: "email", recipient: inv.customers?.email ?? null, subject, body, status: "draft", idempotency_key: `cadence:${today}:${o.invoiceId}` });
      if (!ins.error) drafted += 1;
    }
    if (drafted) {
      await notifyAdmins(db, org.id, "reminders.drafted", `${drafted} payment reminder draft(s) prepared`, "Scheduled drafting found overdue invoices. Review and request sending from each invoice — nothing has been sent.", "/app/invoices?filter=overdue");
      await db.from("audit_logs").insert({ organization_id: org.id, actor_type: "system", action: "reminders.scheduled_drafts", resource_type: "organization", resource_id: org.id, metadata: { drafted } });
    }
    await db.from("scheduled_job_runs").update({ result: { drafted } }).eq("job", "reminder_cadence").eq("organization_id", org.id).eq("run_date", today);
    (summary.reminders as number) += drafted;
  }

  // Roll recurring obligations forward to their next occurrence on/after today.
  const { data: stale } = await db.from("recurring_obligations").select("id, name, amount_minor, frequency, next_due_on").eq("is_active", true).lt("next_due_on", today).limit(2000);
  let rolled = 0;
  for (const o of stale ?? []) {
    const next = occurrences(o as never, today, addDays(today, 400))[0];
    if (next && next !== o.next_due_on) {
      const up = await db.from("recurring_obligations").update({ next_due_on: next }).eq("id", o.id).eq("next_due_on", o.next_due_on);
      if (!up.error) rolled += 1;
    }
  }
  summary.obligationsRolledForward = rolled;

  const soon = addDays(today, 3);
  const { data: due } = await db.from("recurring_obligations").select("organization_id, name, amount_minor, currency, next_due_on").eq("is_active", true).gte("next_due_on", today).lte("next_due_on", soon).limit(2000);
  const byOrg = new Map<string, typeof due>();
  for (const d of due ?? []) byOrg.set(d.organization_id, [...(byOrg.get(d.organization_id) ?? []), d]);
  for (const [orgId, list] of byOrg) {
    const claimed = await db.from("scheduled_job_runs").insert({ job: "obligation_alerts", organization_id: orgId, run_date: today }).select("job");
    if (claimed.error) continue;
    const lines = (list ?? []).map((o) => `${o.name}: ${formatMoney(o.amount_minor, o.currency)} on ${o.next_due_on}`).join("; ");
    await notifyAdmins(db, orgId, "obligations.due_soon", `${list!.length} obligation(s) due within 3 days`, lines, "/app/income");
    (summary.obligationAlerts as number) += 1;
  }
  return summary;
}

async function notifyAdmins(db: SupabaseClient, orgId: string, kind: string, title: string, body: string, link: string) {
  const { data: members } = await db.from("organization_members").select("user_id").eq("organization_id", orgId).eq("status", "active").in("role", ["owner", "admin"]);
  if (!members?.length) return;
  await db.from("notifications").insert(members.map((m) => ({ organization_id: orgId, user_id: m.user_id, kind, title, body: body.slice(0, 1000), link })));
}
