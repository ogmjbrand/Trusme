/** StockSense calculations: deterministic, rule-based replenishment. */
export interface ProductStock {
  id: string;
  sku: string;
  name: string;
  stock_on_hand: number;
  reorder_point: number;
  reorder_quantity: number;
  lead_time_days: number | null;
  unit_cost_minor: number;
  currency: string;
  preferred_supplier_id: string | null;
}

export interface SalesHistoryPoint {
  product_id: string;
  quantity: number; // units sold (positive)
  occurred_at: string; // ISO
}

export interface RestockRecommendation {
  productId: string;
  sku: string;
  name: string;
  stockOnHand: number;
  reorderPoint: number;
  avgDailySales: number | null;
  daysOfCover: number | null;
  leadTimeDays: number;
  stockoutRisk: "none" | "low" | "medium" | "high" | "out_of_stock";
  recommendedQuantity: number;
  estimatedCostMinor: number;
  currency: string;
  supplierId: string | null;
  reasons: string[];
  method: "min_stock_rule" | "min_stock_rule_with_velocity";
}

export const MIN_HISTORY_DAYS_FOR_VELOCITY = 14;
const DEFAULT_LEAD_TIME = 7;

/**
 * Average daily unit sales over the window. Returns null when the history
 * window is too short to be reliable — callers fall back to static rules.
 */
export function averageDailySales(history: SalesHistoryPoint[], productId: string, windowDays: number, now: Date): number | null {
  if (windowDays < MIN_HISTORY_DAYS_FOR_VELOCITY) return null;
  if (history.length === 0) return null;
  const since = now.getTime() - windowDays * 86_400_000;
  const earliest = Math.min(...history.map((h) => Date.parse(h.occurred_at)));
  const observedDays = Math.min(windowDays, (now.getTime() - earliest) / 86_400_000);
  if (observedDays < MIN_HISTORY_DAYS_FOR_VELOCITY) return null;
  const relevant = history.filter((h) => h.product_id === productId && Date.parse(h.occurred_at) >= since);
  if (relevant.length === 0) return 0;
  const units = relevant.reduce((a, h) => a + h.quantity, 0);
  return Math.round((units / observedDays) * 1000) / 1000;
}

export function recommendRestock(
  products: ProductStock[],
  history: SalesHistoryPoint[],
  opts: { now?: Date; windowDays?: number; safetyDays?: number } = {},
): RestockRecommendation[] {
  const now = opts.now ?? new Date();
  const windowDays = opts.windowDays ?? 30;
  const safetyDays = opts.safetyDays ?? 3;
  const out: RestockRecommendation[] = [];

  for (const p of products) {
    const lead = p.lead_time_days ?? DEFAULT_LEAD_TIME;
    const velocity = averageDailySales(history, p.id, windowDays, now);
    const reasons: string[] = [];
    const cover = velocity && velocity > 0 ? Math.round((p.stock_on_hand / velocity) * 10) / 10 : null;

    // Effective reorder point: configured minimum, raised by lead-time demand when velocity is known.
    const leadDemand = velocity ? Math.ceil(velocity * (lead + safetyDays)) : 0;
    const effectivePoint = Math.max(p.reorder_point, leadDemand);

    let risk: RestockRecommendation["stockoutRisk"] = "none";
    if (p.stock_on_hand <= 0) risk = "out_of_stock";
    else if (cover !== null && cover < lead) risk = "high";
    else if (p.stock_on_hand <= p.reorder_point) risk = "medium";
    else if (cover !== null && cover < lead + safetyDays) risk = "low";

    const needs = p.stock_on_hand <= effectivePoint;
    if (!needs && risk === "none") continue;

    if (p.stock_on_hand <= 0) reasons.push("Out of stock.");
    if (p.stock_on_hand <= p.reorder_point) reasons.push(`Stock ${p.stock_on_hand} is at or below the reorder point of ${p.reorder_point}.`);
    if (velocity !== null && velocity > 0) reasons.push(`Selling ~${velocity}/day over the last ${windowDays} days; ${cover} days of cover vs ${lead}-day lead time.`);
    if (velocity === null) reasons.push("Not enough sales history for a velocity estimate; using the configured minimum-stock rule only.");

    const target = effectivePoint + Math.max(p.reorder_quantity, velocity ? Math.ceil(velocity * windowDays) : 0);
    const qty = Math.max(Math.ceil(target - p.stock_on_hand), p.reorder_quantity > 0 ? p.reorder_quantity : 1);
    out.push({
      productId: p.id,
      sku: p.sku,
      name: p.name,
      stockOnHand: p.stock_on_hand,
      reorderPoint: p.reorder_point,
      avgDailySales: velocity,
      daysOfCover: cover,
      leadTimeDays: lead,
      stockoutRisk: risk,
      recommendedQuantity: qty,
      estimatedCostMinor: Math.round(qty * p.unit_cost_minor),
      currency: p.currency,
      supplierId: p.preferred_supplier_id,
      reasons,
      method: velocity === null ? "min_stock_rule" : "min_stock_rule_with_velocity",
    });
  }
  const order = { out_of_stock: 0, high: 1, medium: 2, low: 3, none: 4 };
  return out.sort((a, b) => order[a.stockoutRisk] - order[b.stockoutRisk]);
}
