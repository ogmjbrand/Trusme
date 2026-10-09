import { describe, expect, it } from "vitest";
import { agingReport, draftReminder, isOverdue, overdueList, type InvoiceLike } from "@/lib/domain/receivables";
import { recommendRestock } from "@/lib/domain/inventory";
import { computeMargins, marginTrends, whatIfPrice } from "@/lib/domain/margins";
import { forecastCashFlow, monthlyEquivalent, occurrences } from "@/lib/domain/cashflow";
import { assessRisk, urlSignals } from "@/lib/domain/risk";
import { buildCv, skillsGap } from "@/lib/domain/career";
import { classifyIdea, launchPlan } from "@/lib/domain/launch";
import { canonicalJson, hashObject } from "@/lib/domain/hash";
import { atLeast, can } from "@/lib/auth/permissions";

const inv = (o: Partial<InvoiceLike>): InvoiceLike => ({ id: "i", invoice_number: "INV-1", customer_id: "c", status: "issued", currency: "NGN", total_minor: 10000, amount_paid_minor: 0, due_date: "2026-09-01", ...o });

describe("receivables", () => {
  it("detects overdue and buckets by currency", () => {
    const today = "2026-10-09";
    const list = [inv({ id: "a", due_date: "2026-10-01" }), inv({ id: "b", due_date: "2026-06-01", currency: "USD" }), inv({ id: "c", status: "paid", amount_paid_minor: 10000 }), inv({ id: "d", due_date: "2026-10-20" })];
    expect(isOverdue(list[0]!, today)).toBe(true);
    expect(isOverdue(list[3]!, today)).toBe(false);
    expect(overdueList(list, today).map((o) => o.invoiceId)).toEqual(["b", "a"]);
    const aging = agingReport(list, today);
    expect(aging.find((a) => a.currency === "NGN")!.buckets["1-30"]).toBe(10000);
    expect(aging.find((a) => a.currency === "NGN")!.buckets.current).toBe(10000);
    expect(aging.find((a) => a.currency === "USD")!.buckets["90+"]).toBe(10000);
  });
  it("drafts non-threatening reminders", () => {
    const r = draftReminder({ businessName: "Acme", customerName: "Tunde", invoiceNumber: "INV-1", balance: "₦100", dueDate: "2026-09-01", daysOverdue: 40 });
    expect(r.body).toContain("INV-1");
    expect(r.body.toLowerCase()).not.toMatch(/legal action|police|court/);
  });
});

describe("inventory", () => {
  const now = new Date("2026-10-09T00:00:00Z");
  const base = { sku: "S", name: "N", reorder_quantity: 10, unit_cost_minor: 100, currency: "NGN", preferred_supplier_id: null };
  it("uses static rules without enough history", () => {
    const r = recommendRestock([{ ...base, id: "p", stock_on_hand: 2, reorder_point: 5, lead_time_days: 3 }], [], { now });
    expect(r[0]!.method).toBe("min_stock_rule");
    expect(r[0]!.recommendedQuantity).toBeGreaterThanOrEqual(10);
    expect(r[0]!.stockoutRisk).toBe("medium");
  });
  it("uses velocity when history is sufficient", () => {
    const history = Array.from({ length: 30 }, (_, i) => ({ product_id: "p", quantity: 2, occurred_at: new Date(now.getTime() - (i + 1) * 86_400_000).toISOString() }));
    const r = recommendRestock([{ ...base, id: "p", stock_on_hand: 8, reorder_point: 5, lead_time_days: 7 }], history, { now });
    expect(r[0]!.method).toBe("min_stock_rule_with_velocity");
    expect(r[0]!.stockoutRisk).toBe("high"); // 4 days of cover < 7 day lead time
  });
  it("skips healthy products", () => {
    expect(recommendRestock([{ ...base, id: "p", stock_on_hand: 100, reorder_point: 5, lead_time_days: 3 }], [], { now })).toEqual([]);
  });
});

describe("margins", () => {
  const sale = { id: "s1", currency: "NGN", occurred_at: "2026-10-01", payment_fee_minor: 100, shipping_cost_minor: 200, discount_minor: 0, items: [{ product_id: "a", quantity: 2, returned_quantity: 0, unit_price_minor: 1000, unit_cost_minor: 600 }, { product_id: "b", quantity: 1, returned_quantity: 0, unit_price_minor: 2000, unit_cost_minor: 1000 }] };
  it("computes gross and contribution margins with exact allocation", () => {
    const m = computeMargins([sale], [{ id: "e1", product_id: "a", cost_type: "other_direct", amount_minor: 50, currency: "NGN", incurred_at: "2026-10-01" }, { id: "e2", product_id: "a", cost_type: "inventory_purchase", amount_minor: 99999, currency: "NGN", incurred_at: "2026-10-01" }], []);
    const a = m.find((x) => x.productId === "a")!;
    const b = m.find((x) => x.productId === "b")!;
    expect(a.netRevenue).toBe(2000);
    expect(a.cogs).toBe(1200);
    expect(a.paymentFees + b.paymentFees).toBe(100);
    expect(a.shipping + b.shipping).toBe(200);
    expect(a.otherDirect).toBe(50); // inventory_purchase excluded: no double count
    expect(a.contribution).toBe(2000 - 1200 - a.paymentFees - a.shipping - 50);
    expect(a.sources.expenses).toEqual(["e1"]);
  });
  it("flags declining margins", () => {
    const prev = computeMargins([sale], [], []);
    const cur = computeMargins([{ ...sale, items: sale.items.map((i) => ({ ...i, unit_cost_minor: i.unit_cost_minor + 200 })) }], [], []);
    expect(marginTrends(prev, cur).some((t) => t.declining)).toBe(true);
  });
  it("what-if pricing", () => {
    expect(whatIfPrice({ unitPriceMinor: 1000, unitCostMinor: 600, feeBps: 150, shippingPerUnitMinor: 0, otherPerUnitMinor: 0 }).contributionPerUnitMinor).toBe(385);
  });
});

describe("cash flow", () => {
  it("projects balances and shortages from explicit assumptions", () => {
    const r = forecastCashFlow(
      "2026-10-01",
      { openingBalanceMinor: 1000, horizonDays: 30, receivableCollectionRate: 0.5, receivableDelayDays: 0, variableMonthlyIncomeMinor: 0, variableIncomeFactor: 1, minimumBalanceMinor: 0 },
      [{ id: "o", name: "Rent", amount_minor: 3000, frequency: "monthly", next_due_on: "2026-10-05" }],
      [{ id: "r", label: "INV", balance_minor: 4000, due_date: "2026-10-10" }],
    );
    expect(r.lowestBalanceMinor).toBe(-2000);
    expect(r.shortfallDays[0]).toBe("2026-10-05");
    expect(r.days.at(-1)!.balanceMinor).toBe(1000 - 3000 + 2000);
  });
  it("expands recurring obligations", () => {
    expect(occurrences({ id: "x", name: "w", amount_minor: 1, frequency: "weekly", next_due_on: "2026-10-01" }, "2026-10-01", "2026-10-21")).toEqual(["2026-10-01", "2026-10-08", "2026-10-15"]);
    expect(occurrences({ id: "x", name: "m", amount_minor: 1, frequency: "monthly", next_due_on: "2026-01-31" }, "2026-01-01", "2026-03-31")).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]);
    expect(monthlyEquivalent({ amount_minor: 1200, frequency: "yearly" })).toBe(100);
  });
});

describe("risk heuristics", () => {
  it("flags credential requests and lookalike domains without asserting fraud", () => {
    const r = assessRisk({ text: "Pay commitment fee today only and send the OTP to confirm", url: "https://paystack-verify.example.net/pay" });
    expect(r.level).toBe("high");
    expect(r.signals.map((s) => s.code)).toEqual(expect.arrayContaining(["credential_request", "advance_payment", "url_brand_lookalike"]));
    expect(r.signals.every((s) => s.evidenceClass === "heuristic_observation")).toBe(true);
    expect(r.summary.toLowerCase()).not.toContain("is a scam");
  });
  it("reports unknown when nothing was provided and low with no signals", () => {
    expect(assessRisk({}).level).toBe("unknown");
    expect(assessRisk({ text: "Hello, your order of rice is ready for pickup at our shop." }).level).toBe("low");
  });
  it("does not flag the brand's own domain", () => {
    expect(urlSignals("https://paystack.com/pay/abc").some((s) => s.code === "url_brand_lookalike")).toBe(false);
  });
});

describe("career", () => {
  it("only uses recorded data and excludes unconfirmed projects", () => {
    const cv = buildCv({ fullName: "Ada", skills: [{ name: "TypeScript", level: "advanced" }], employment: [], credentials: [], projects: [{ title: "Secret", description: null, outcomes: null, url: null, confirmed_accurate: false }] });
    expect(cv).toContain("TypeScript");
    expect(cv).not.toContain("Secret");
  });
  it("computes keyword overlap", () => {
    const g = skillsGap("We need TypeScript and PostgreSQL experience", [{ name: "TypeScript" }]);
    expect(g.matched).toContain("typescript");
    expect(g.missing).toContain("postgresql");
  });
});

describe("launch", () => {
  it("classifies and always marks regulatory tasks for verification", () => {
    expect(classifyIdea("Packaged zobo drink for offices").category).toBe("food_beverage");
    const tasks = launchPlan("food_beverage");
    expect(tasks.some((t) => t.authority === "NAFDAC")).toBe(true);
    expect(tasks.filter((t) => t.authority).every((t) => t.needsVerification)).toBe(true);
  });
});

describe("hashing & permissions", () => {
  it("canonical JSON is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(hashObject({ a: 1 })).not.toBe(hashObject({ a: 2 }));
  });
  it("matrix", () => {
    expect(can("viewer", "records.write")).toBe(false);
    expect(can("member", "records.write")).toBe(true);
    expect(can("admin", "roles.grant_admin")).toBe(false);
    expect(can("owner", "billing.manage")).toBe(true);
    expect(atLeast(null, "viewer")).toBe(false);
  });
});
