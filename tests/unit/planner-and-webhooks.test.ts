import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";

vi.mock("server-only", () => ({}));

import { ruleBasedPlan } from "@/lib/ai/rule-planner";
import { verifyStripeSignature } from "@/lib/integrations/payments/stripe";

describe("rule-based planner", () => {
  it("plans the flagship request with drafts only and no sending", () => {
    const p = ruleBasedPlan("Review my overdue invoices, identify products with declining profit margins, prepare payment reminders and create a restocking plan.");
    const ids = p.steps.map((s) => s.toolId);
    expect(ids).toEqual(["invoices.find_overdue", "reminders.draft", "margins.product_report", "inventory.restock_report", "purchase_orders.create_drafts"]);
    expect(ids).not.toContain("reminders.send");
    expect(p.steps[1]!.dependsOn).toEqual([0]);
  });
  it("includes sending only when explicitly asked", () => {
    expect(ruleBasedPlan("send reminders for overdue invoices").steps.map((s) => s.toolId)).toContain("reminders.send");
  });
  it("falls back to a safe summary", () => {
    const p = ruleBasedPlan("write me a poem");
    expect(p.steps.map((s) => s.toolId)).toEqual(["workspace.summary"]);
    expect(p.notes?.length).toBeGreaterThan(0);
  });
});

describe("stripe signature verification", () => {
  const secret = "whsec_test";
  const body = JSON.stringify({ id: "evt_1" });
  const t = 1_700_000_000;
  const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
  it("accepts valid signatures within tolerance", () => {
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, t + 10)).toBe(true);
  });
  it("rejects tampered bodies, wrong secrets and replays", () => {
    expect(verifyStripeSignature(body + " ", `t=${t},v1=${sig}`, secret, t)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, "other", t)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${sig}`, secret, t + 3600)).toBe(false);
    expect(verifyStripeSignature(body, "garbage", secret, t)).toBe(false);
  });
});
