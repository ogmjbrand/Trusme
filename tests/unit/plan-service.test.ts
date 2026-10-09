import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
const providerMock = vi.hoisted(() => ({ current: null as null | { id: string; model: string; plan: () => Promise<unknown>; narrate: () => AsyncIterable<string> } }));
vi.mock("@/lib/ai/provider", async (orig) => {
  const actual = await orig<typeof import("@/lib/ai/provider")>();
  return { ...actual, getAIProvider: () => providerMock.current };
});

import { buildPlan } from "@/lib/ai/plan-service";
import { llmPlanSchema } from "@/lib/ai/provider";
import { ExecutionEngine } from "@/lib/execution/engine";
import { MemoryExecutionStore } from "@/lib/execution/memory-store";
import { toolRegistry } from "@/lib/tools";
import type { WorkspaceContext } from "@/lib/auth/context";

const ws = { org: { name: "Acme", defaultCurrency: "NGN" }, role: "owner" } as unknown as WorkspaceContext;
const engine = new ExecutionEngine({ store: new MemoryExecutionStore(), registry: toolRegistry(), makeContext: (b) => b as never });
const request = "Which products are running low?";

describe("plan service", () => {
  beforeEach(() => {
    providerMock.current = null;
  });

  it("uses rules when no provider is configured", async () => {
    const r = await buildPlan(request, ws, engine, {});
    expect(r.providerId).toBe("rules");
    expect(r.plan.steps[0]!.toolId).toBe("inventory.restock_report");
  });

  it("accepts a valid model plan", async () => {
    providerMock.current = { id: "anthropic", model: "m", narrate: async function* () {}, plan: async () => ({ goal: "g", summary: "s", planner: "anthropic:m", notes: [], steps: [{ toolId: "inventory.restock_report", title: "t", input: { windowDays: 14 } }] }) };
    const r = await buildPlan(request, ws, engine, {});
    expect(r.providerId).toBe("anthropic");
    expect(r.fallbackReason).toBeNull();
  });

  it("falls back to rules when the model proposes an unregistered tool", async () => {
    providerMock.current = { id: "anthropic", model: "m", narrate: async function* () {}, plan: async () => ({ goal: "g", summary: "s", planner: "anthropic:m", steps: [{ toolId: "db.execute_sql", title: "t", input: { sql: "drop table invoices" } }] }) };
    const r = await buildPlan(request, ws, engine, {});
    expect(r.providerId).toBe("rules");
    expect(r.plan.steps.map((s) => s.toolId)).not.toContain("db.execute_sql");
    expect(r.plan.notes?.join(" ")).toMatch(/failed validation/);
  });

  it("falls back when the model input is invalid or the provider errors", async () => {
    providerMock.current = { id: "anthropic", model: "m", narrate: async function* () {}, plan: async () => ({ goal: "g", summary: "s", planner: "x", steps: [{ toolId: "reminders.send", title: "t", input: { reminders: [{ reminderId: "nope", invoiceNumber: "1", recipient: "not-email", balance: "1" }] } }] }) };
    expect((await buildPlan(request, ws, engine, {})).providerId).toBe("rules");
    providerMock.current = { id: "anthropic", model: "m", narrate: async function* () {}, plan: async () => { throw new Error("overloaded"); } };
    const r = await buildPlan(request, ws, engine, {});
    expect(r.fallbackReason).toMatch(/unavailable/);
  });

  it("constrains structured output to registered tool ids", () => {
    const schema = llmPlanSchema(["a.b", "c.d"]);
    expect(schema.safeParse({ goal: "g", summary: "s", notes: [], steps: [{ toolId: "x.y", title: "", rationale: "", inputJson: "{}", dependsOn: [] }] }).success).toBe(false);
  });
});
