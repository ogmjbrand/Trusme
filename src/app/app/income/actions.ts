"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/context";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { parseMajor } from "@/lib/money";
import { forecastCashFlow, type ObligationInput, type ReceivableInput } from "@/lib/domain/cashflow";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cur = z.string().regex(/^[A-Z]{3}$/);
const opt = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

export async function addIncome(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const currency = cur.parse(form.get("currency"));
    const d = z.object({ source: z.string().trim().min(1).max(120), description: z.string().max(300).optional(), received_on: date }).parse({ source: form.get("source"), description: opt(form.get("description")), received_on: form.get("received_on") });
    unwrap(await ws.supabase.from("income_entries").insert({ ...d, currency, amount_minor: parseMajor(String(form.get("amount") ?? ""), currency), organization_id: ws.org.organizationId, created_by: ws.user.id }));
    revalidatePath("/app/income");
    return null;
  }, "Income recorded");
}

export async function addObligation(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const currency = cur.parse(form.get("currency"));
    const d = z.object({ name: z.string().trim().min(1).max(120), category: z.string().trim().max(60).default("bills"), frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]), next_due_on: date }).parse({ name: form.get("name"), category: opt(form.get("category")), frequency: form.get("frequency"), next_due_on: form.get("next_due_on") });
    unwrap(await ws.supabase.from("recurring_obligations").insert({ ...d, currency, amount_minor: parseMajor(String(form.get("amount") ?? ""), currency), organization_id: ws.org.organizationId, created_by: ws.user.id }));
    revalidatePath("/app/income");
    return null;
  }, "Obligation added");
}

export async function toggleObligation(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const id = z.string().uuid().parse(form.get("id"));
    const active = form.get("active") === "true";
    unwrap(await ws.supabase.from("recurring_obligations").update({ is_active: active }).eq("id", id).eq("organization_id", ws.org.organizationId));
    revalidatePath("/app/income");
    return null;
  });
}

export async function saveGoal(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const id = opt(form.get("id"));
    if (id) {
      const g = unwrap(await ws.supabase.from("savings_goals").select("currency").eq("id", id).eq("organization_id", ws.org.organizationId).single()) as { currency: string };
      unwrap(await ws.supabase.from("savings_goals").update({ saved_minor: parseMajor(String(form.get("saved") ?? "0"), g.currency) }).eq("id", id).eq("organization_id", ws.org.organizationId));
    } else {
      const currency = cur.parse(form.get("currency"));
      const d = z.object({ name: z.string().trim().min(1).max(120), target_date: date.optional() }).parse({ name: form.get("name"), target_date: opt(form.get("target_date")) });
      unwrap(await ws.supabase.from("savings_goals").insert({ ...d, currency, target_minor: parseMajor(String(form.get("target") ?? ""), currency), organization_id: ws.org.organizationId, created_by: ws.user.id }));
    }
    revalidatePath("/app/income");
    return null;
  }, "Goal saved");
}

export async function saveForecast(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const a = JSON.parse(String(form.get("assumptions"))) as Record<string, number>;
    const currency = cur.parse(form.get("currency"));
    const assumptions = z.object({
      openingBalanceMinor: z.number().int(), horizonDays: z.number().int().min(7).max(180), receivableCollectionRate: z.number().min(0).max(1),
      receivableDelayDays: z.number().int().min(0).max(90), variableMonthlyIncomeMinor: z.number().int().min(0), variableIncomeFactor: z.number().min(0).max(2), minimumBalanceMinor: z.number().int().min(0),
    }).parse(a);
    const org = ws.org.organizationId;
    const [{ data: obl }, { data: inv }] = await Promise.all([
      ws.supabase.from("recurring_obligations").select("id, name, amount_minor, frequency, next_due_on").eq("organization_id", org).eq("is_active", true).eq("currency", currency),
      ws.supabase.from("invoices").select("id, invoice_number, total_minor, amount_paid_minor, due_date").eq("organization_id", org).eq("currency", currency).in("status", ["issued", "partially_paid"]),
    ]);
    const receivables: ReceivableInput[] = (inv ?? []).map((i) => ({ id: i.id, label: `Invoice ${i.invoice_number}`, balance_minor: i.total_minor - i.amount_paid_minor, due_date: i.due_date }));
    const result = forecastCashFlow(new Date().toISOString().slice(0, 10), assumptions, (obl ?? []) as ObligationInput[], receivables);
    unwrap(await ws.supabase.from("cash_flow_forecasts").insert({
      organization_id: org, name: z.string().trim().min(1).max(120).parse(form.get("name") || `Forecast ${new Date().toISOString().slice(0, 10)}`), currency, horizon_days: assumptions.horizonDays,
      opening_balance_minor: assumptions.openingBalanceMinor, assumptions, result: { ...result, days: undefined, series: result.days.map((d) => [d.date, d.balanceMinor]) }, method: result.method, created_by: ws.user.id,
    }));
    revalidatePath("/app/income");
    return null;
  }, "Forecast snapshot saved");
}
