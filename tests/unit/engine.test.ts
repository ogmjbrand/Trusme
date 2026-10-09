import { describe, expect, it, beforeEach } from "vitest";
import { z } from "zod";
import { ExecutionEngine } from "@/lib/execution/engine";
import { MemoryExecutionStore } from "@/lib/execution/memory-store";
import { ToolRegistry } from "@/lib/execution/registry";
import { ToolError, type ExecutionPlan, type ToolContextBase } from "@/lib/execution/types";

const ORG = "org-1";
const OWNER = "user-owner";
const VIEWER = "user-viewer";
const MEMBER = "user-member";

let clock = new Date("2026-10-01T09:00:00Z");
const now = () => clock;

function setup(opts: { flakyFailures?: number; autoRunLowRisk?: boolean } = {}) {
  const store = new MemoryExecutionStore();
  store.setRole(ORG, OWNER, "owner");
  store.setRole(ORG, VIEWER, "viewer");
  store.setRole(ORG, MEMBER, "member");
  const sent: string[] = [];
  let flaky = opts.flakyFailures ?? 0;
  const registry = new ToolRegistry<ToolContextBase>()
    .register({
      id: "test.read", title: "Read", description: "", module: "core", sideEffect: "read",
      inputSchema: z.object({ q: z.string() }), outputSchema: z.object({ count: z.number() }),
      minRole: "viewer", retry: { maxAttempts: 3, idempotent: true }, timeoutMs: 1000,
      summarize: (i) => `read ${i.q}`,
      run: async () => {
        if (flaky > 0) { flaky -= 1; throw new ToolError("temporary", { retryable: true }); }
        return { output: { count: 2 }, outcome: "analyzed" };
      },
    })
    .register({
      id: "test.draft", title: "Draft", description: "", module: "core", sideEffect: "reversible_write",
      inputSchema: z.object({ text: z.string() }), outputSchema: z.object({ id: z.string() }),
      minRole: "member", retry: { maxAttempts: 2, idempotent: true }, timeoutMs: 1000,
      summarize: (i) => `draft ${i.text}`,
      run: async (ctx) => ({ output: { id: `draft-${ctx.idempotencyKey.slice(0, 6)}` }, outcome: "prepared", refs: [{ type: "draft", id: "d1", label: "Draft" }] }),
    })
    .register({
      id: "test.send", title: "Send", description: "", module: "core", sideEffect: "consequential",
      inputSchema: z.object({ to: z.string().email() }), outputSchema: z.object({ messageId: z.string() }),
      minRole: "member", approverMinRole: "admin", retry: { maxAttempts: 1, idempotent: false }, timeoutMs: 1000,
      summarize: (i) => `send email to ${i.to}`,
      run: async (_ctx, i) => { sent.push(i.to); return { output: { messageId: "m1" }, outcome: "sent" }; },
      verify: async () => ({ status: "verified", detail: "provider accepted" }),
    });
  const engine = new ExecutionEngine({ store, registry, makeContext: (b) => b, now, backoffBaseMs: 1000 });
  return { store, engine, sent };
}

const plan = (steps: ExecutionPlan["steps"]): ExecutionPlan => ({ goal: "g", summary: "s", steps, planner: "test" });

describe("ExecutionEngine", () => {
  beforeEach(() => {
    clock = new Date("2026-10-01T09:00:00Z");
  });

  it("rejects unknown tools and invalid inputs before persisting anything", async () => {
    const { engine, store } = setup();
    await expect(
      engine.createExecution({ orgId: ORG, actorUserId: OWNER, request: "x", autoRunLowRisk: true, plan: plan([{ toolId: "db.drop_all", title: "x", input: {} }]) }),
    ).rejects.toThrow(/unknown tool/);
    await expect(
      engine.createExecution({ orgId: ORG, actorUserId: OWNER, request: "x", autoRunLowRisk: true, plan: plan([{ toolId: "test.send", title: "x", input: { to: "not-an-email" } }]) }),
    ).rejects.toThrow(/Plan rejected/);
    expect(store.executions.size).toBe(0);
  });

  it("does not let viewers start executions", async () => {
    const { engine } = setup();
    await expect(
      engine.createExecution({ orgId: ORG, actorUserId: VIEWER, request: "x", autoRunLowRisk: true, plan: plan([{ toolId: "test.read", title: "r", input: { q: "a" } }]) }),
    ).rejects.toThrow(/members/);
  });

  it("runs read and low-risk steps automatically and completes", async () => {
    const { engine, store } = setup();
    const exec = await engine.createExecution({
      orgId: ORG, actorUserId: MEMBER, request: "x", autoRunLowRisk: true,
      plan: plan([{ toolId: "test.read", title: "r", input: { q: "a" } }, { toolId: "test.draft", title: "d", input: { text: "hi" }, dependsOn: [0] }]),
    });
    const done = await engine.run(exec.id);
    expect(done?.status).toBe("completed");
    const steps = await store.getSteps(exec.id);
    expect(steps.map((s) => s.outcome_label)).toEqual(["analyzed", "prepared"]);
    expect(steps[1]!.result_refs[0]?.type).toBe("draft");
    expect(store.events.map((e) => e.event_type)).toContain("execution.completed");
  });

  it("requires approval for low-risk writes when auto-run is disabled", async () => {
    const { engine } = setup();
    const exec = await engine.createExecution({
      orgId: ORG, actorUserId: MEMBER, request: "x", autoRunLowRisk: false,
      plan: plan([{ toolId: "test.draft", title: "d", input: { text: "hi" } }]),
    });
    expect((await engine.run(exec.id))?.status).toBe("pending_approval");
  });

  it("pauses consequential steps for approval, enforces approver role, then executes once", async () => {
    const { engine, store, sent } = setup();
    const exec = await engine.createExecution({
      orgId: ORG, actorUserId: MEMBER, request: "x", autoRunLowRisk: true,
      plan: plan([{ toolId: "test.draft", title: "d", input: { text: "hi" } }, { toolId: "test.send", title: "s", input: { to: "a@b.co" }, dependsOn: [0] }]),
    });
    const paused = await engine.run(exec.id);
    expect(paused?.status).toBe("pending_approval");
    expect(sent).toEqual([]);

    const approval = [...store.approvals.values()][0]!;
    expect(approval.summary).toBe("send email to a@b.co");
    await expect(engine.decideApproval(approval.id, MEMBER, "approve")).rejects.toThrow(/admin/);

    await engine.decideApproval(approval.id, OWNER, "approve");
    const done = await engine.run(exec.id);
    expect(done?.status).toBe("completed");
    expect(sent).toEqual(["a@b.co"]);
    const sendStep = (await store.getSteps(exec.id))[1]!;
    expect(sendStep.outcome_label).toBe("sent");
    expect(sendStep.verification).toBe("verified");

    // Re-running a completed execution never repeats side effects.
    await engine.run(exec.id);
    expect(sent).toEqual(["a@b.co"]);
  });

  it("invalidates approval when the action input changes after approval was requested", async () => {
    const { engine, store, sent } = setup();
    const exec = await engine.createExecution({
      orgId: ORG, actorUserId: OWNER, request: "x", autoRunLowRisk: true,
      plan: plan([{ toolId: "test.send", title: "s", input: { to: "a@b.co" } }]),
    });
    await engine.run(exec.id);
    const approval = [...store.approvals.values()][0]!;
    const step = (await store.getSteps(exec.id))[0]!;
    await store.updateStep(step.id, { input: { to: "attacker@evil.co" } });
    await expect(engine.decideApproval(approval.id, OWNER, "approve")).rejects.toThrow(/changed/);
    expect(sent).toEqual([]);
  });

  it("rejection skips dependent steps and reports partial completion honestly", async () => {
    const { engine, store } = setup();
    const exec = await engine.createExecution({
      orgId: ORG, actorUserId: OWNER, request: "x", autoRunLowRisk: true,
      plan: plan([
        { toolId: "test.read", title: "r", input: { q: "a" } },
        { toolId: "test.send", title: "s", input: { to: "a@b.co" }, dependsOn: [0] },
        { toolId: "test.draft", title: "after send", input: { text: "x" }, dependsOn: [1] },
      ]),
    });
    await engine.run(exec.id);
    const approval = [...store.approvals.values()][0]!;
    await engine.decideApproval(approval.id, OWNER, "reject", "not now");
    const done = await engine.run(exec.id);
    expect(done?.status).toBe("partially_completed");
    expect((await store.getSteps(exec.id)).map((s) => s.status)).toEqual(["succeeded", "rejected", "skipped"]);
    expect(done?.result_summary).toMatch(/1 of 3/);
  });

  it("retries idempotent steps with bounded exponential backoff", async () => {
    const { engine, store } = setup({ flakyFailures: 2 });
    const exec = await engine.createExecution({
      orgId: ORG, actorUserId: OWNER, request: "x", autoRunLowRisk: true,
      plan: plan([{ toolId: "test.read", title: "r", input: { q: "a" } }]),
    });
    let r = await engine.run(exec.id);
    expect(r?.status).toBe("waiting");
    expect(r?.next_run_at).toBe("2026-10-01T09:00:01.000Z");
    clock = new Date("2026-10-01T09:00:01Z");
    r = await engine.run(exec.id);
    expect(r?.next_run_at).toBe("2026-10-01T09:00:03.000Z"); // 2s backoff on second failure
    clock = new Date("2026-10-01T09:00:03Z");
    r = await engine.run(exec.id);
    expect(r?.status).toBe("completed");
    expect((await store.getSteps(exec.id))[0]!.attempt_count).toBe(3);
  });

  it("never auto-retries non-idempotent consequential steps and needs fresh approval to retry", async () => {
    const store = new MemoryExecutionStore();
    store.setRole(ORG, OWNER, "owner");
    let calls = 0;
    const registry = new ToolRegistry().register({
      id: "test.pay", title: "Pay", description: "", module: "core", sideEffect: "consequential",
      inputSchema: z.object({ amount: z.number() }), outputSchema: z.object({}),
      minRole: "member", retry: { maxAttempts: 5, idempotent: false }, timeoutMs: 1000,
      summarize: (i) => `pay ${i.amount}`,
      run: async () => { calls += 1; throw new ToolError("gateway timeout", { retryable: true }); },
    });
    const engine = new ExecutionEngine({ store, registry, makeContext: (b) => b, now });
    const exec = await engine.createExecution({ orgId: ORG, actorUserId: OWNER, request: "x", autoRunLowRisk: true, plan: plan([{ toolId: "test.pay", title: "p", input: { amount: 100 } }]) });
    await engine.run(exec.id);
    await engine.decideApproval([...store.approvals.values()][0]!.id, OWNER, "approve");
    const failed = await engine.run(exec.id);
    expect(failed?.status).toBe("failed");
    expect(calls).toBe(1);

    const step = (await store.getSteps(exec.id))[0]!;
    await engine.retryStep(step.id, OWNER);
    const again = await engine.run(exec.id);
    expect(again?.status).toBe("pending_approval");
    expect(calls).toBe(1);
  });

  it("re-checks permissions at execution time", async () => {
    const { engine, store } = setup();
    const exec = await engine.createExecution({
      orgId: ORG, actorUserId: MEMBER, request: "x", autoRunLowRisk: true,
      plan: plan([{ toolId: "test.draft", title: "d", input: { text: "x" } }]),
    });
    store.setRole(ORG, MEMBER, "viewer"); // demoted before the run
    const r = await engine.run(exec.id);
    expect(r?.status).toBe("failed");
    expect((await store.getSteps(exec.id))[0]!.error?.code).toBe("permission_denied");
  });

  it("cancels between steps and cancels pending approvals", async () => {
    const { engine, store } = setup();
    const exec = await engine.createExecution({
      orgId: ORG, actorUserId: OWNER, request: "x", autoRunLowRisk: true,
      plan: plan([{ toolId: "test.read", title: "r", input: { q: "a" } }, { toolId: "test.send", title: "s", input: { to: "a@b.co" } }]),
    });
    await engine.run(exec.id);
    const r = await engine.cancel(exec.id, OWNER);
    expect(r.status).toBe("cancelled");
    expect([...store.approvals.values()][0]!.status).toBe("cancelled");
    expect((await store.getSteps(exec.id)).map((s) => s.status)).toEqual(["succeeded", "cancelled"]);
    expect(r.result_summary).toMatch(/not rolled back/);
  });

  it("is idempotent on execution creation", async () => {
    const { engine, store } = setup();
    const args = { orgId: ORG, actorUserId: OWNER, request: "x", autoRunLowRisk: true, idempotencyKey: "req-1", plan: plan([{ toolId: "test.read", title: "r", input: { q: "a" } }]) };
    const a = await engine.createExecution(args);
    const b = await engine.createExecution(args);
    expect(a.id).toBe(b.id);
    expect(store.executions.size).toBe(1);
  });

  it("does not allow two workers to run the same execution concurrently", async () => {
    const { engine, store } = setup();
    const exec = await engine.createExecution({ orgId: ORG, actorUserId: OWNER, request: "x", autoRunLowRisk: true, plan: plan([{ toolId: "test.read", title: "r", input: { q: "a" } }]) });
    await store.acquireLease(exec.id, "other-worker", new Date(clock.getTime() + 60_000), clock);
    const r = await engine.run(exec.id);
    expect(r?.status).toBe("queued");
  });

  it("fails interrupted non-idempotent steps instead of re-running them", async () => {
    const { engine, store, sent } = setup();
    const exec = await engine.createExecution({ orgId: ORG, actorUserId: OWNER, request: "x", autoRunLowRisk: true, plan: plan([{ toolId: "test.send", title: "s", input: { to: "a@b.co" } }]) });
    await engine.run(exec.id);
    await engine.decideApproval([...store.approvals.values()][0]!.id, OWNER, "approve");
    const step = (await store.getSteps(exec.id))[0]!;
    await store.updateStep(step.id, { status: "running" }); // simulate crash mid-send
    const r = await engine.run(exec.id);
    expect(r?.status).toBe("failed");
    expect((await store.getSteps(exec.id))[0]!.error?.code).toBe("interrupted");
    expect(sent).toEqual([]);
  });
});
