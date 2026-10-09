import "server-only";
import type { WorkspaceContext } from "@/lib/auth/context";
import { PlanValidationError, type ExecutionPlan } from "@/lib/execution/types";
import type { ExecutionEngine } from "@/lib/execution/engine";
import type { AppToolContext } from "@/lib/tools/context";
import { toolRegistry } from "@/lib/tools";
import { getAIProvider } from "./provider";
import { ruleBasedPlan } from "./rule-planner";

export interface PlanOutcome {
  plan: ExecutionPlan;
  providerId: string;
  fallbackReason: string | null;
}

/** Ask the configured model for a plan; fall back to rules if it is unavailable or invalid. */
export async function buildPlan(request: string, ws: WorkspaceContext, engine: ExecutionEngine<AppToolContext>, counts: Record<string, number>): Promise<PlanOutcome> {
  const provider = getAIProvider();
  if (!provider) {
    return { plan: ruleBasedPlan(request), providerId: "rules", fallbackReason: "No AI provider is configured; the rule-based planner was used." };
  }
  try {
    const plan = await provider.plan({
      request,
      organizationName: ws.org.name,
      role: ws.role,
      today: new Date().toISOString().slice(0, 10),
      defaultCurrency: ws.org.defaultCurrency,
      tools: toolRegistry().list(),
      counts,
    });
    engine.validatePlan(plan); // throws PlanValidationError
    return { plan, providerId: provider.id, fallbackReason: null };
  } catch (err) {
    const reason = err instanceof PlanValidationError ? `The AI plan failed validation (${err.issues.join("; ")})` : `The AI provider was unavailable (${(err as Error).message})`;
    console.error("planner fallback:", reason);
    const plan = ruleBasedPlan(request);
    plan.notes = [...(plan.notes ?? []), `${reason}. A rule-based plan was used instead.`];
    return { plan, providerId: "rules", fallbackReason: reason };
  }
}

export async function* ruleNarration(plan: ExecutionPlan, approvalsNeeded: string[]): AsyncIterable<string> {
  const lines = [
    `Here is the plan: ${plan.summary}.`,
    approvalsNeeded.length
      ? `${approvalsNeeded.length} step(s) will pause for your approval before anything is sent or committed: ${approvalsNeeded.join("; ")}.`
      : "No step in this plan sends anything externally or commits money, so it can run without approval.",
    ...(plan.notes ?? []),
    "Progress, results and any failures appear in the timeline below as each step runs.",
  ];
  for (const line of lines) {
    for (const word of line.split(/(\s+)/)) yield word;
    yield "\n\n";
  }
}
