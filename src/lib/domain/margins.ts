import { allocate, lineTotal, percent } from "@/lib/money";

/**
 * MarginGuard metric definitions (all amounts in minor units, per currency):
 *  - Net revenue      = Σ (sold − returned) × unit price − allocated order discount
 *  - COGS             = Σ (sold − returned) × unit cost snapshot at time of sale
 *  - Gross profit     = Net revenue − COGS
 *  - Direct costs     = allocated payment fees + allocated shipping
 *                       + product-linked direct expenses + spoilage at cost
 *  - Contribution     = Gross profit − Direct costs
 * Order-level fees, shipping and discounts are allocated to lines in proportion
 * to gross line revenue (exact, largest-remainder). Expenses classified as
 * 'inventory_purchase' are excluded because COGS already captures them.
 */
export interface SaleInput {
  id: string;
  currency: string;
  occurred_at: string;
  payment_fee_minor: number;
  shipping_cost_minor: number;
  discount_minor: number;
  items: { product_id: string; quantity: number; returned_quantity: number; unit_price_minor: number; unit_cost_minor: number }[];
}

export interface ExpenseInput {
  id: string;
  product_id: string | null;
  cost_type: "inventory_purchase" | "shipping" | "payment_fee" | "other_direct" | "overhead" | "personal";
  amount_minor: number;
  currency: string;
  incurred_at: string;
}

export interface SpoilageInput {
  id: string;
  product_id: string;
  quantity: number; // negative movement quantity
  unit_cost_minor: number | null;
  currency: string | null;
  occurred_at: string;
}

export interface ProductMargin {
  productId: string;
  currency: string;
  unitsSold: number;
  unitsReturned: number;
  netRevenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number | null;
  paymentFees: number;
  shipping: number;
  discounts: number;
  otherDirect: number;
  spoilage: number;
  contribution: number;
  contributionMarginPct: number | null;
  sources: { sales: string[]; expenses: string[]; spoilage: string[] };
}

function blank(productId: string, currency: string): ProductMargin {
  return {
    productId, currency, unitsSold: 0, unitsReturned: 0, netRevenue: 0, cogs: 0, grossProfit: 0, grossMarginPct: null,
    paymentFees: 0, shipping: 0, discounts: 0, otherDirect: 0, spoilage: 0, contribution: 0, contributionMarginPct: null,
    sources: { sales: [], expenses: [], spoilage: [] },
  };
}

export function computeMargins(sales: SaleInput[], expenses: ExpenseInput[], spoilage: SpoilageInput[]): ProductMargin[] {
  const map = new Map<string, ProductMargin>();
  const get = (pid: string, cur: string) => {
    const key = `${pid}:${cur}`;
    let m = map.get(key);
    if (!m) { m = blank(pid, cur); map.set(key, m); }
    return m;
  };

  for (const s of sales) {
    const gross = s.items.map((i) => lineTotal(i.quantity - i.returned_quantity, i.unit_price_minor));
    const weights = gross.map((g) => Math.max(g, 0));
    const fees = allocate(s.payment_fee_minor, weights);
    const ship = allocate(s.shipping_cost_minor, weights);
    const disc = allocate(s.discount_minor, weights);
    s.items.forEach((item, idx) => {
      const m = get(item.product_id, s.currency);
      const net = item.quantity - item.returned_quantity;
      m.unitsSold += item.quantity;
      m.unitsReturned += item.returned_quantity;
      m.netRevenue += (gross[idx] ?? 0) - (disc[idx] ?? 0);
      m.discounts += disc[idx] ?? 0;
      m.cogs += lineTotal(net, item.unit_cost_minor);
      m.paymentFees += fees[idx] ?? 0;
      m.shipping += ship[idx] ?? 0;
      if (!m.sources.sales.includes(s.id)) m.sources.sales.push(s.id);
    });
  }

  for (const e of expenses) {
    if (!e.product_id) continue;
    if (e.cost_type === "inventory_purchase" || e.cost_type === "overhead" || e.cost_type === "personal") continue;
    const m = get(e.product_id, e.currency);
    if (e.cost_type === "shipping") m.shipping += e.amount_minor;
    else if (e.cost_type === "payment_fee") m.paymentFees += e.amount_minor;
    else m.otherDirect += e.amount_minor;
    m.sources.expenses.push(e.id);
  }

  for (const sp of spoilage) {
    if (!sp.currency || sp.unit_cost_minor === null) continue;
    const m = get(sp.product_id, sp.currency);
    m.spoilage += lineTotal(Math.abs(sp.quantity), sp.unit_cost_minor);
    m.sources.spoilage.push(sp.id);
  }

  for (const m of map.values()) {
    m.grossProfit = m.netRevenue - m.cogs;
    m.grossMarginPct = percent(m.grossProfit, m.netRevenue);
    m.contribution = m.grossProfit - m.paymentFees - m.shipping - m.otherDirect - m.spoilage;
    m.contributionMarginPct = percent(m.contribution, m.netRevenue);
  }
  return [...map.values()].sort((a, b) => a.contribution - b.contribution);
}

export interface MarginTrend {
  productId: string;
  currency: string;
  previousPct: number | null;
  currentPct: number | null;
  changePts: number | null;
  declining: boolean;
}

/** Compare contribution margin % between two adjacent periods. */
export function marginTrends(previous: ProductMargin[], current: ProductMargin[], thresholdPts = 3): MarginTrend[] {
  const prev = new Map(previous.map((p) => [`${p.productId}:${p.currency}`, p]));
  return current.map((c) => {
    const p = prev.get(`${c.productId}:${c.currency}`);
    const previousPct = p?.contributionMarginPct ?? null;
    const currentPct = c.contributionMarginPct;
    const changePts = previousPct !== null && currentPct !== null ? Math.round((currentPct - previousPct) * 10) / 10 : null;
    return { productId: c.productId, currency: c.currency, previousPct, currentPct, changePts, declining: changePts !== null && changePts <= -thresholdPts };
  });
}

/** What-if pricing: contribution per unit at a new price, holding unit costs constant. */
export function whatIfPrice(args: { unitPriceMinor: number; unitCostMinor: number; feeBps: number; shippingPerUnitMinor: number; otherPerUnitMinor: number }) {
  const fee = Math.round((args.unitPriceMinor * args.feeBps) / 10000);
  const contribution = args.unitPriceMinor - args.unitCostMinor - fee - args.shippingPerUnitMinor - args.otherPerUnitMinor;
  return { feeMinor: fee, contributionPerUnitMinor: contribution, contributionMarginPct: percent(contribution, args.unitPriceMinor) };
}
