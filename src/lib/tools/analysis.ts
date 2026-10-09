import "server-only";
import { z } from "zod";
import { computeMargins, marginTrends, type ExpenseInput, type SaleInput, type SpoilageInput } from "@/lib/domain/margins";
import { forecastCashFlow, type ObligationInput, type ReceivableInput } from "@/lib/domain/cashflow";
import { assessRisk } from "@/lib/domain/risk";
import { safeBrowsingCheck } from "@/lib/integrations/safe-browsing";
import type { ToolDefinition } from "@/lib/execution/types";
import { must, today, type AppToolContext } from "./context";

// ---------------------------------------------------------------------------
// MarginGuard
// ---------------------------------------------------------------------------
export async function loadMarginInputs(ctx: Pick<AppToolContext, "db" | "orgId">, fromIso: string, toIso: string) {
  type SaleRow = Omit<SaleInput, "items"> & { sale_items: SaleInput["items"] };
  const sales = must(
    await ctx.db
      .from("sales")
      .select("id, currency, occurred_at, payment_fee_minor, shipping_cost_minor, discount_minor, sale_items(product_id, quantity, returned_quantity, unit_price_minor, unit_cost_minor)")
      .eq("organization_id", ctx.orgId)
      .gte("occurred_at", fromIso)
      .lt("occurred_at", toIso)
      .limit(5000),
    "load sales",
  ) as unknown as SaleRow[];
  const expenses = must(
    await ctx.db.from("expenses").select("id, product_id, cost_type, amount_minor, currency, incurred_at").eq("organization_id", ctx.orgId).gte("incurred_at", fromIso.slice(0, 10)).lt("incurred_at", toIso.slice(0, 10)).limit(5000),
    "load expenses",
  ) as ExpenseInput[];
  const spoilage = must(
    await ctx.db.from("inventory_movements").select("id, product_id, quantity, unit_cost_minor, currency, occurred_at").eq("organization_id", ctx.orgId).eq("movement_type", "spoilage").gte("occurred_at", fromIso).lt("occurred_at", toIso).limit(5000),
    "load spoilage",
  ) as SpoilageInput[];
  const num = (v: unknown) => Number(v);
  return {
    sales: sales.map((s) => ({ ...s, items: s.sale_items.map((i) => ({ ...i, quantity: num(i.quantity), returned_quantity: num(i.returned_quantity) })) })),
    expenses,
    spoilage: spoilage.map((s) => ({ ...s, quantity: num(s.quantity) })),
  };
}

const marginRow = z.object({
  productId: z.string(),
  name: z.string(),
  sku: z.string(),
  currency: z.string(),
  netRevenue: z.number(),
  grossProfit: z.number(),
  contribution: z.number(),
  grossMarginPct: z.number().nullable(),
  contributionMarginPct: z.number().nullable(),
  previousContributionMarginPct: z.number().nullable(),
  changePts: z.number().nullable(),
  declining: z.boolean(),
  sourceCounts: z.object({ sales: z.number(), expenses: z.number(), spoilage: z.number() }),
});

export const marginReport: ToolDefinition<{ periodDays: number; declineThresholdPts: number }, { period: { from: string; to: string }; products: z.infer<typeof marginRow>[]; decliningCount: number }, AppToolContext> = {
  id: "margins.product_report",
  title: "Analyze product margins",
  description: "Computes gross and contribution margin per product for the period and compares with the previous period to flag declining margins. Read-only.",
  module: "marginguard",
  sideEffect: "read",
  inputSchema: z.object({ periodDays: z.number().int().min(7).max(365).default(30), declineThresholdPts: z.number().min(0.5).max(50).default(3) }),
  outputSchema: z.object({ period: z.object({ from: z.string(), to: z.string() }), products: z.array(marginRow), decliningCount: z.number() }),
  minRole: "viewer",
  retry: { maxAttempts: 3, idempotent: true },
  timeoutMs: 30_000,
  summarize: (i) => `Compare product margins over the last ${i.periodDays} days with the prior ${i.periodDays} days`,
  async run(ctx, input) {
    const to = ctx.now.toISOString();
    const from = new Date(ctx.now.getTime() - input.periodDays * 86_400_000).toISOString();
    const prevFrom = new Date(ctx.now.getTime() - 2 * input.periodDays * 86_400_000).toISOString();
    const cur = await loadMarginInputs(ctx, from, to);
    const prev = await loadMarginInputs(ctx, prevFrom, from);
    const curM = computeMargins(cur.sales, cur.expenses, cur.spoilage);
    const prevM = computeMargins(prev.sales, prev.expenses, prev.spoilage);
    const trends = marginTrends(prevM, curM, input.declineThresholdPts);
    const ids = [...new Set(curM.map((m) => m.productId))];
    const names = ids.length ? (must(await ctx.db.from("products").select("id, name, sku").eq("organization_id", ctx.orgId).in("id", ids), "names") as { id: string; name: string; sku: string }[]) : [];
    const products = curM.map((m, idx) => {
      const t = trends[idx]!;
      const n = names.find((x) => x.id === m.productId);
      return {
        productId: m.productId, name: n?.name ?? "Unknown product", sku: n?.sku ?? "", currency: m.currency,
        netRevenue: m.netRevenue, grossProfit: m.grossProfit, contribution: m.contribution,
        grossMarginPct: m.grossMarginPct, contributionMarginPct: m.contributionMarginPct,
        previousContributionMarginPct: t.previousPct, changePts: t.changePts, declining: t.declining,
        sourceCounts: { sales: m.sources.sales.length, expenses: m.sources.expenses.length, spoilage: m.sources.spoilage.length },
      };
    });
    const declining = products.filter((p) => p.declining);
    return {
      output: { period: { from: from.slice(0, 10), to: to.slice(0, 10) }, products, decliningCount: declining.length },
      outcome: "analyzed",
      refs: declining.map((p) => ({ type: "product", id: p.productId, label: `${p.name}: ${p.changePts} pts`, href: `/app/profitability?product=${p.productId}` })),
    };
  },
};

// ---------------------------------------------------------------------------
// IncomePilot
// ---------------------------------------------------------------------------
const forecastInput = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/).default("NGN"),
  horizonDays: z.number().int().min(7).max(180).default(60),
  openingBalanceMinor: z.number().int().optional(),
  receivableCollectionRate: z.number().min(0).max(1).default(0.8),
  receivableDelayDays: z.number().int().min(0).max(90).default(7),
  variableIncomeFactor: z.number().min(0).max(2).default(1),
  minimumBalanceMinor: z.number().int().min(0).default(0),
});

export const cashflowForecast: ToolDefinition<z.infer<typeof forecastInput>, { currency: string; assumptions: Record<string, unknown>; lowestBalanceMinor: number; lowestBalanceDate: string; shortfallDays: number; firstShortfall: string | null; totalInflowMinor: number; totalOutflowMinor: number; notes: string[] }, AppToolContext> = {
  id: "cashflow.forecast",
  title: "Project cash flow",
  description: "Projects daily cash balance from recurring obligations, open receivables and average variable income, using explicit assumptions. Estimates only. Read-only.",
  module: "incomepilot",
  sideEffect: "read",
  inputSchema: forecastInput,
  outputSchema: z.object({
    currency: z.string(), assumptions: z.record(z.string(), z.unknown()), lowestBalanceMinor: z.number(), lowestBalanceDate: z.string(),
    shortfallDays: z.number(), firstShortfall: z.string().nullable(), totalInflowMinor: z.number(), totalOutflowMinor: z.number(), notes: z.array(z.string()),
  }),
  minRole: "viewer",
  retry: { maxAttempts: 3, idempotent: true },
  timeoutMs: 20_000,
  summarize: (i) => `Project ${i.currency} cash flow for ${i.horizonDays} days`,
  async run(ctx, input) {
    const notes: string[] = [];
    const start = today(ctx);
    const obligations = must(await ctx.db.from("recurring_obligations").select("id, name, amount_minor, frequency, next_due_on").eq("organization_id", ctx.orgId).eq("is_active", true).eq("currency", input.currency), "obligations") as ObligationInput[];
    const invs = must(await ctx.db.from("invoices").select("id, invoice_number, total_minor, amount_paid_minor, due_date").eq("organization_id", ctx.orgId).eq("currency", input.currency).in("status", ["issued", "partially_paid"]), "receivables") as { id: string; invoice_number: string; total_minor: number; amount_paid_minor: number; due_date: string }[];
    const receivables: ReceivableInput[] = invs.map((i) => ({ id: i.id, label: `Invoice ${i.invoice_number}`, balance_minor: i.total_minor - i.amount_paid_minor, due_date: i.due_date }));
    const since = new Date(ctx.now.getTime() - 90 * 86_400_000).toISOString().slice(0, 10);
    const income = must(await ctx.db.from("income_entries").select("amount_minor").eq("organization_id", ctx.orgId).eq("currency", input.currency).gte("received_on", since), "income") as { amount_minor: number }[];
    const variableMonthly = Math.round(income.reduce((s, x) => s + x.amount_minor, 0) / 3);
    if (input.openingBalanceMinor === undefined) notes.push("Opening balance was not provided and is assumed to be 0. Enter your current balance for a meaningful projection.");
    if (!income.length) notes.push("No non-invoice income recorded in the last 90 days; variable income assumed to be 0.");
    const assumptions = {
      openingBalanceMinor: input.openingBalanceMinor ?? 0,
      horizonDays: input.horizonDays,
      receivableCollectionRate: input.receivableCollectionRate,
      receivableDelayDays: input.receivableDelayDays,
      variableMonthlyIncomeMinor: variableMonthly,
      variableIncomeFactor: input.variableIncomeFactor,
      minimumBalanceMinor: input.minimumBalanceMinor,
    };
    const r = forecastCashFlow(start, assumptions, obligations, receivables);
    notes.push("This is a projection based on the assumptions shown, not a guarantee of future income.");
    return {
      output: {
        currency: input.currency, assumptions, lowestBalanceMinor: r.lowestBalanceMinor, lowestBalanceDate: r.lowestBalanceDate,
        shortfallDays: r.shortfallDays.length, firstShortfall: r.shortfallDays[0] ?? null, totalInflowMinor: r.totalInflowMinor, totalOutflowMinor: r.totalOutflowMinor, notes,
      },
      outcome: "analyzed",
      refs: [{ type: "cash_flow", id: "projection", label: "Open IncomePilot", href: "/app/income" }],
    };
  },
};

// ---------------------------------------------------------------------------
// BeforeYouPay
// ---------------------------------------------------------------------------
const screenInput = z.object({
  text: z.string().max(10_000).optional(),
  url: z.string().max(2_000).optional(),
  counterpartyName: z.string().max(200).optional(),
  accountName: z.string().max(200).optional(),
  paymentMethodRequested: z.string().max(200).optional(),
  save: z.boolean().default(false),
});

const signalSchema = z.object({ code: z.string(), label: z.string(), severity: z.string(), evidenceClass: z.string(), detail: z.string(), sourceName: z.string().optional(), sourceUrl: z.string().optional(), retrievedAt: z.string().optional() });

export const screenTransaction: ToolDefinition<z.infer<typeof screenInput>, { level: string; score: number; summary: string; signals: z.infer<typeof signalSchema>[]; limitations: string[]; thirdPartyNote: string | null; assessmentId: string | null }, AppToolContext> = {
  id: "risk.screen",
  title: "Screen a payment request",
  description: "Checks a message, link or seller details for common scam patterns (heuristics) and, if configured, Google Safe Browsing. Never concludes that anyone is fraudulent. Optionally saves the assessment.",
  module: "beforeyoupay",
  sideEffect: "reversible_write",
  inputSchema: screenInput,
  outputSchema: z.object({ level: z.string(), score: z.number(), summary: z.string(), signals: z.array(signalSchema), limitations: z.array(z.string()), thirdPartyNote: z.string().nullable(), assessmentId: z.string().nullable() }),
  minRole: "member",
  retry: { maxAttempts: 2, idempotent: true },
  timeoutMs: 30_000,
  summarize: (i) => `Screen ${i.url ? `link ${i.url}` : "message"} for scam patterns${i.save ? " and save the assessment" : ""}`,
  async run(ctx, input) {
    const result = assessRisk(input);
    let thirdPartyNote: string | null = null;
    if (input.url) {
      const gsb = await safeBrowsingCheck(input.url);
      thirdPartyNote = gsb.note;
      result.signals.push(...gsb.signals);
      if (gsb.signals.length) result.level = "high";
    }
    let assessmentId: string | null = null;
    if (input.save) {
      const key = ctx.idempotencyKey;
      const existing = must(await ctx.db.from("risk_assessments").select("id").eq("organization_id", ctx.orgId).eq("idempotency_key", key).maybeSingle(), "find") as { id: string } | null;
      if (existing) assessmentId = existing.id;
      else {
        const row = must(
          await ctx.db.from("risk_assessments").insert({
            organization_id: ctx.orgId, subject_type: input.url ? "url" : "message", title: input.counterpartyName ? `Payment to ${input.counterpartyName}` : input.url ?? "Screened message",
            subject_text: input.text ?? null, url: input.url ?? null, counterparty_name: input.counterpartyName ?? null, payment_method_requested: input.paymentMethodRequested ?? null,
            status: "assessed", risk_level: result.level, risk_score: result.score, summary: result.summary, method: result.method, assessed_at: new Date().toISOString(),
            idempotency_key: key, created_by: ctx.actorUserId,
          }).select("id").single(),
          "save assessment",
        ) as { id: string };
        assessmentId = row.id;
        if (result.signals.length) {
          must(await ctx.db.from("risk_signals").insert(result.signals.map((s) => ({
            organization_id: ctx.orgId, assessment_id: row.id, code: s.code, label: s.label, severity: s.severity, evidence_class: s.evidenceClass,
            detail: s.detail, source_name: s.sourceName ?? null, source_url: s.sourceUrl ?? null, retrieved_at: s.retrievedAt ?? null,
          }))), "save signals");
        }
        await ctx.audit("risk_assessment.created", "risk_assessment", row.id, { level: result.level });
      }
    }
    return {
      output: { level: result.level, score: result.score, summary: result.summary, signals: result.signals, limitations: result.limitations, thirdPartyNote, assessmentId },
      outcome: input.save ? "created" : "analyzed",
      refs: assessmentId ? [{ type: "risk_assessment", id: assessmentId, label: "Risk assessment", href: `/app/trust/${assessmentId}` }] : [],
    };
  },
};
