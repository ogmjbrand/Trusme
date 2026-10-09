import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { toolRegistry } from "@/lib/tools";
import { ruleBasedPlan } from "@/lib/ai/rule-planner";
import { ExecutionEngine } from "@/lib/execution/engine";
import { MemoryExecutionStore } from "@/lib/execution/memory-store";

const PROMPTS = [
  "Review my overdue invoices, identify products with declining profit margins, prepare payment reminders and create a restocking plan.",
  "send reminders for overdue invoices",
  "Which products are running low? Draft purchase orders",
  "Will I run short of cash in the next 60 days?",
  "Is this legit? pay commitment fee https://example.net/x",
  "I want to launch a business called Zobo Delight selling packaged drinks",
  "Which jobs need attention? any disputes?",
  "What job application follow-ups and interviews do I have?",
  "write me a poem",
];

describe("tool registry", () => {
  const registry = toolRegistry();
  it("registers every module with valid metadata", () => {
    const modules = new Set(registry.list().map((t) => t.module));
    for (const m of ["collectiq", "stocksense", "marginguard", "incomepilot", "beforeyoupay", "jobproof", "careervault", "launchready"]) expect(modules.has(m as never)).toBe(true);
    for (const t of registry.list()) {
      expect(t.description.length).toBeGreaterThan(20);
      if (t.sideEffect === "consequential") {
        expect(t.retry.idempotent).toBe(false);
      }
    }
  });
  it("consequential tools always resolve concrete targets before approval", () => {
    for (const t of registry.list().filter((x) => x.sideEffect === "consequential")) expect(typeof t.resolve).toBe("function");
  });
  it.each(PROMPTS)("rule plan for %j validates against the registry", (prompt) => {
    const engine = new ExecutionEngine({ store: new MemoryExecutionStore(), registry, makeContext: (b) => b as never });
    const plan = ruleBasedPlan(prompt);
    expect(() => engine.validatePlan(plan)).not.toThrow();
  });
  it("plans JobProof and CareerVault requests", () => {
    expect(ruleBasedPlan("Which jobs need attention? any disputes?").steps.map((s) => s.toolId)).toContain("jobs.attention_report");
    expect(ruleBasedPlan("What job application follow-ups and interviews do I have?").steps.map((s) => s.toolId)).toEqual(["career.follow_ups"]);
  });
});
