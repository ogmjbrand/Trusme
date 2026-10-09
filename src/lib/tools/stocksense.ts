import "server-only";
import { z } from "zod";
import { recommendRestock, type ProductStock, type SalesHistoryPoint } from "@/lib/domain/inventory";
import type { ToolDefinition } from "@/lib/execution/types";
import { must, type AppToolContext } from "./context";

const rec = z.object({
  productId: z.string(),
  sku: z.string(),
  name: z.string(),
  stockOnHand: z.number(),
  reorderPoint: z.number(),
  avgDailySales: z.number().nullable(),
  daysOfCover: z.number().nullable(),
  leadTimeDays: z.number(),
  stockoutRisk: z.string(),
  recommendedQuantity: z.number(),
  estimatedCostMinor: z.number(),
  currency: z.string(),
  supplierId: z.string().nullable(),
  reasons: z.array(z.string()),
  method: z.string(),
});

async function computeRecommendations(ctx: AppToolContext, windowDays: number) {
  const products = must(
    await ctx.db
      .from("products")
      .select("id, sku, name, stock_on_hand, reorder_point, reorder_quantity, lead_time_days, unit_cost_minor, currency, preferred_supplier_id, suppliers:preferred_supplier_id(lead_time_days)")
      .eq("organization_id", ctx.orgId)
      .eq("is_active", true)
      .limit(1000),
    "load products",
  ) as unknown as (ProductStock & { suppliers: { lead_time_days: number | null } | null })[];
  const since = new Date(ctx.now.getTime() - Math.max(windowDays, 60) * 86_400_000).toISOString();
  const movements = must(
    await ctx.db.from("inventory_movements").select("product_id, quantity, occurred_at").eq("organization_id", ctx.orgId).eq("movement_type", "sale").gte("occurred_at", since).limit(10000),
    "load sales history",
  ) as { product_id: string; quantity: number; occurred_at: string }[];
  const history: SalesHistoryPoint[] = movements.map((m) => ({ product_id: m.product_id, quantity: Math.abs(Number(m.quantity)), occurred_at: m.occurred_at }));
  const normalized = products.map((p) => ({
    ...p,
    stock_on_hand: Number(p.stock_on_hand),
    reorder_point: Number(p.reorder_point),
    reorder_quantity: Number(p.reorder_quantity),
    lead_time_days: p.lead_time_days ?? p.suppliers?.lead_time_days ?? null,
  }));
  return recommendRestock(normalized, history, { now: ctx.now, windowDays });
}

export const restockReport: ToolDefinition<{ windowDays: number }, { recommendations: z.infer<typeof rec>[] }, AppToolContext> = {
  id: "inventory.restock_report",
  title: "Analyze stock levels",
  description: "Finds low-stock and stockout-risk products and computes deterministic restock quantities from reorder points, lead times and recent sales velocity. Read-only.",
  module: "stocksense",
  sideEffect: "read",
  inputSchema: z.object({ windowDays: z.number().int().min(7).max(180).default(30) }),
  outputSchema: z.object({ recommendations: z.array(rec) }),
  minRole: "viewer",
  retry: { maxAttempts: 3, idempotent: true },
  timeoutMs: 20_000,
  summarize: (i) => `Analyze stock using the last ${i.windowDays} days of sales`,
  async run(ctx, input) {
    const recommendations = await computeRecommendations(ctx, input.windowDays);
    return {
      output: { recommendations },
      outcome: "analyzed",
      refs: recommendations.slice(0, 10).map((r) => ({ type: "product", id: r.productId, label: `${r.sku} · ${r.name}`, href: `/app/inventory?product=${r.productId}` })),
    };
  },
};

type PoInput = { windowDays: number; includeRisk: ("out_of_stock" | "high" | "medium" | "low")[] };
type PoOutput = { purchaseOrders: { id: string; poNumber: string; supplierId: string | null; currency: string; lineCount: number; totalMinor: number }[] };

export const draftPurchaseOrders: ToolDefinition<PoInput, PoOutput, AppToolContext> = {
  id: "purchase_orders.create_drafts",
  title: "Draft restock purchase orders",
  description: "Creates DRAFT purchase orders (one per supplier and currency) from current restock recommendations. Drafts commit no money and are not sent to suppliers.",
  module: "stocksense",
  sideEffect: "reversible_write",
  inputSchema: z.object({
    windowDays: z.number().int().min(7).max(180).default(30),
    includeRisk: z.array(z.enum(["out_of_stock", "high", "medium", "low"])).min(1).default(["out_of_stock", "high", "medium"]),
  }),
  outputSchema: z.object({
    purchaseOrders: z.array(z.object({ id: z.string(), poNumber: z.string(), supplierId: z.string().nullable(), currency: z.string(), lineCount: z.number(), totalMinor: z.number() })),
  }),
  minRole: "member",
  retry: { maxAttempts: 3, idempotent: true },
  timeoutMs: 30_000,
  summarize: (i) => `Create draft purchase orders for products at ${i.includeRisk.join("/")} stockout risk`,
  async run(ctx, input) {
    const recs = (await computeRecommendations(ctx, input.windowDays)).filter((r) => (input.includeRisk as string[]).includes(r.stockoutRisk));
    const groups = new Map<string, typeof recs>();
    for (const r of recs) {
      const key = `${r.supplierId ?? "unassigned"}:${r.currency}`;
      groups.set(key, [...(groups.get(key) ?? []), r]);
    }
    const purchaseOrders: PoOutput["purchaseOrders"] = [];
    for (const [key, lines] of groups) {
      const idem = `${ctx.idempotencyKey}:${key}`;
      let po = must(await ctx.db.from("purchase_orders").select("id, po_number, supplier_id, currency, total_minor").eq("organization_id", ctx.orgId).eq("idempotency_key", idem).maybeSingle(), "find po") as
        | { id: string; po_number: string; supplier_id: string | null; currency: string; total_minor: number }
        | null;
      if (!po) {
        const number = must(await ctx.db.rpc("next_document_number", { p_org: ctx.orgId, p_kind: "purchase_order" }), "allocate PO number") as string;
        po = must(
          await ctx.db
            .from("purchase_orders")
            .insert({
              organization_id: ctx.orgId,
              supplier_id: lines[0]!.supplierId,
              po_number: number,
              status: "draft",
              currency: lines[0]!.currency,
              notes: "Drafted by TrustOS from restock recommendations. Review quantities and prices before approving.",
              source_execution_id: ctx.executionId,
              idempotency_key: idem,
              created_by: ctx.actorUserId,
            })
            .select("id, po_number, supplier_id, currency, total_minor")
            .single(),
          "create po",
        ) as { id: string; po_number: string; supplier_id: string | null; currency: string; total_minor: number };
        must(
          await ctx.db.from("purchase_order_items").insert(
            lines.map((l) => ({ organization_id: ctx.orgId, purchase_order_id: po!.id, product_id: l.productId, quantity: l.recommendedQuantity, unit_cost_minor: Math.round(l.estimatedCostMinor / l.recommendedQuantity) })),
          ),
          "create po lines",
        );
        await ctx.audit("purchase_order.drafted", "purchase_order", po.id, { lines: lines.length });
      }
      const fresh = must(await ctx.db.from("purchase_orders").select("total_minor").eq("id", po.id).single(), "reload po") as { total_minor: number };
      purchaseOrders.push({ id: po.id, poNumber: po.po_number, supplierId: po.supplier_id, currency: po.currency, lineCount: lines.length, totalMinor: fresh.total_minor });
    }
    return {
      output: { purchaseOrders },
      outcome: purchaseOrders.length ? "prepared" : "no_op",
      refs: purchaseOrders.map((p) => ({ type: "purchase_order", id: p.id, label: `${p.poNumber} (draft)`, href: `/app/inventory/purchase-orders/${p.id}` })),
    };
  },
};
