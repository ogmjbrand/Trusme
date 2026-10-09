"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/context";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { assessRisk, draftScamReport, type RiskSignal } from "@/lib/domain/risk";
import { safeBrowsingCheck } from "@/lib/integrations/safe-browsing";
import { formatMoney, parseMajor } from "@/lib/money";

const opt = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v).trim());

export async function screenPayment(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const currency = z.string().regex(/^[A-Z]{3}$/).parse(form.get("currency") || ws.org.defaultCurrency);
    const input = z
      .object({
        text: z.string().max(10000).optional(),
        url: z.string().max(2000).optional(),
        counterpartyName: z.string().max(200).optional(),
        counterpartyContact: z.string().max(200).optional(),
        accountName: z.string().max(200).optional(),
        paymentMethodRequested: z.string().max(200).optional(),
        amount: z.string().optional(),
      })
      .refine((v) => v.text || v.url, { message: "Paste the message or a link to screen", path: ["text"] })
      .parse({ text: opt(form.get("text")), url: opt(form.get("url")), counterpartyName: opt(form.get("counterparty_name")), counterpartyContact: opt(form.get("counterparty_contact")), accountName: opt(form.get("account_name")), paymentMethodRequested: opt(form.get("payment_method")), amount: opt(form.get("amount")) });
    const result = assessRisk(input);
    let note: string | null = null;
    if (input.url) {
      const gsb = await safeBrowsingCheck(input.url);
      note = gsb.note;
      result.signals.push(...gsb.signals);
      if (gsb.signals.length) result.level = "high";
    }
    const org = ws.org.organizationId;
    const row = unwrap(
      await ws.supabase.from("risk_assessments").insert({
        organization_id: org, subject_type: input.url ? "url" : input.counterpartyName ? "seller" : "message",
        title: input.counterpartyName ? `Payment to ${input.counterpartyName}` : input.url ? `Link: ${input.url.slice(0, 80)}` : "Screened message",
        subject_text: input.text ?? null, url: input.url ?? null, counterparty_name: input.counterpartyName ?? null, counterparty_contact: input.counterpartyContact ?? null,
        amount_minor: input.amount ? parseMajor(input.amount, currency) : null, currency: input.amount ? currency : null, payment_method_requested: input.paymentMethodRequested ?? null,
        status: "assessed", risk_level: result.level, risk_score: result.score, summary: note ? `${result.summary} ${note}` : result.summary, method: result.method, assessed_at: new Date().toISOString(), created_by: ws.user.id,
      }).select("id").single(),
    ) as { id: string };
    if (result.signals.length) {
      unwrap(await ws.supabase.from("risk_signals").insert(result.signals.map((s) => ({
        organization_id: org, assessment_id: row.id, code: s.code, label: s.label, severity: s.severity, evidence_class: s.evidenceClass,
        detail: s.detail, source_name: s.sourceName ?? null, source_url: s.sourceUrl ?? null, retrieved_at: s.retrievedAt ?? null,
      }))));
    }
    await writeAudit(ws.supabase, { organizationId: org, actorUserId: ws.user.id, action: "risk_assessment.created", resourceType: "risk_assessment", resourceId: row.id, metadata: { level: result.level } });
    revalidatePath("/app/trust");
    return { id: row.id };
  }, "Screening complete");
}

export async function addUserClaim(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ id: z.string().uuid(), label: z.string().trim().min(3).max(200), detail: z.string().max(2000).optional() }).parse({ id: form.get("id"), label: form.get("label"), detail: opt(form.get("detail")) });
    unwrap(await ws.supabase.from("risk_signals").insert({ organization_id: ws.org.organizationId, assessment_id: d.id, code: "user_note", label: d.label, severity: "info", evidence_class: "user_claim", detail: d.detail ?? null }));
    revalidatePath(`/app/trust/${d.id}`);
    return null;
  }, "Note added");
}

export async function recordFeedback(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({
      id: z.string().uuid(),
      user_feedback: z.enum(["accurate", "partly_accurate", "inaccurate"]).optional(),
      user_feedback_note: z.string().max(1000).optional(),
      outcome: z.enum(["did_not_pay", "paid_ok", "paid_lost_money", "unknown"]).optional(),
    }).parse({ id: form.get("id"), user_feedback: opt(form.get("user_feedback")), user_feedback_note: opt(form.get("user_feedback_note")), outcome: opt(form.get("outcome")) });
    const { id, ...patch } = d;
    unwrap(await ws.supabase.from("risk_assessments").update(patch).eq("id", id).eq("organization_id", ws.org.organizationId));
    revalidatePath(`/app/trust/${id}`);
    return null;
  }, "Thanks — feedback saved");
}

export async function draftReport(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ id: z.string().uuid(), recipient: z.string().max(200).optional(), narrative: z.string().trim().min(20, "Describe what happened in at least a few sentences").max(8000) }).parse({ id: form.get("id"), recipient: opt(form.get("recipient")), narrative: form.get("narrative") });
    const a = unwrap(await ws.supabase.from("risk_assessments").select("title, counterparty_name, amount_minor, currency").eq("id", d.id).eq("organization_id", ws.org.organizationId).single()) as { title: string; counterparty_name: string | null; amount_minor: number | null; currency: string | null };
    const { data: sigs } = await ws.supabase.from("risk_signals").select("code, label, severity, evidence_class, detail").eq("assessment_id", d.id);
    const body = draftScamReport({
      title: a.title, counterparty: a.counterparty_name, amount: a.amount_minor && a.currency ? formatMoney(a.amount_minor, a.currency) : null, narrative: d.narrative,
      signals: (sigs ?? []).map((s) => ({ code: s.code, label: s.label, severity: s.severity, evidenceClass: s.evidence_class, detail: s.detail ?? "" }) as RiskSignal),
    });
    unwrap(await ws.supabase.from("scam_reports").insert({ organization_id: ws.org.organizationId, assessment_id: d.id, intended_recipient: d.recipient ?? null, title: `Report: ${a.title}`, body, status: "draft", created_by: ws.user.id }));
    revalidatePath(`/app/trust/${d.id}`);
    return null;
  }, "Report drafted — nothing has been sent");
}

export async function markReportSubmitted(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z.object({ id: z.string().uuid(), reference: z.string().max(200).optional() }).parse({ id: form.get("id"), reference: opt(form.get("reference")) });
    const r = unwrap(await ws.supabase.from("scam_reports").update({ status: "submitted_by_user", submitted_at: new Date().toISOString(), submission_reference: d.reference ?? null }).eq("id", d.id).eq("organization_id", ws.org.organizationId).select("assessment_id").single()) as { assessment_id: string };
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "scam_report.user_submitted", resourceType: "scam_report", resourceId: d.id });
    revalidatePath(`/app/trust/${r.assessment_id}`);
    return null;
  }, "Recorded as submitted by you");
}
