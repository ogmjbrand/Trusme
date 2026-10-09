import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { generateText, streamText, Output } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { env } from "@/lib/env";
import type { ExecutionPlan, ToolDefinition } from "@/lib/execution/types";

/**
 * Provider-neutral AI interface. Business logic (planning rules, tool
 * allow-list, validation) lives outside the provider. Providers only turn a
 * request into a candidate plan and narrate a plan; neither can execute
 * anything.
 */
export interface PlanningContext {
  request: string;
  organizationName: string;
  role: string;
  today: string;
  defaultCurrency: string;
  tools: Pick<ToolDefinition, "id" | "title" | "description" | "sideEffect" | "inputSchema">[];
  counts: Record<string, number>;
}

export interface AIProvider {
  readonly id: string;
  readonly model: string;
  plan(ctx: PlanningContext): Promise<ExecutionPlan>;
  narrate(ctx: { request: string; plan: ExecutionPlan; approvalsNeeded: string[] }): AsyncIterable<string>;
}

export function llmPlanSchema(toolIds: [string, ...string[]]) {
  return z.object({
    goal: z.string().describe("One-sentence restatement of the user's goal"),
    summary: z.string().describe("Short plan summary for the user"),
    steps: z
      .array(
        z.object({
          toolId: z.enum(toolIds),
          title: z.string(),
          rationale: z.string(),
          inputJson: z.string().describe("JSON object matching the tool's input schema"),
          dependsOn: z.array(z.number().int()).describe("Zero-based indexes of earlier steps this step needs"),
        }),
      )
      .max(12),
    notes: z.array(z.string()).describe("Limitations, missing data or things the user must do themselves"),
  });
}

export const SYSTEM_PROMPT = `You are the planner for TrustOS, an execution platform for small businesses and individuals (primary market: Nigeria).
Turn the user's request into a plan made ONLY of the registered tools listed below. You cannot run tools; the TrustOS engine validates every step, checks permissions, and requires human approval for consequential steps.

Rules:
- Use only listed tool IDs, with inputs that match each tool's JSON schema. Put the input as a JSON string in inputJson.
- Prefer read-only analysis first, then reversible drafts. Only include a consequential step (e.g. sending messages) when the user explicitly asked for that action.
- Never invent records, IDs, amounts, recipients or verification results. If an action needs data the user has not provided (e.g. a specific job application), leave it out and explain in notes.
- Steps that need a previous step's results must list it in dependsOn.
- If nothing matches, return a single workspace.summary step and explain in notes.
- Be explicit in notes about uncertainty, estimates and what the user must do outside TrustOS (e.g. submitting on a government portal).`;

function toolCatalog(ctx: PlanningContext): string {
  return ctx.tools
    .map((t) => `- ${t.id} [${t.sideEffect}] ${t.title}: ${t.description}\n  input schema: ${JSON.stringify(z.toJSONSchema(t.inputSchema as z.ZodType, { io: "input", unrepresentable: "any" }))}`)
    .join("\n");
}

function userPrompt(ctx: PlanningContext): string {
  return `Workspace: ${ctx.organizationName} (user role: ${ctx.role}, default currency ${ctx.defaultCurrency}, today ${ctx.today}).
Record counts: ${JSON.stringify(ctx.counts)}

Registered tools:
${toolCatalog(ctx)}

User request:
"""${ctx.request}"""`;
}

function toPlan(raw: z.infer<ReturnType<typeof llmPlanSchema>>, planner: string): ExecutionPlan {
  return {
    goal: raw.goal,
    summary: raw.summary,
    planner,
    notes: raw.notes,
    steps: raw.steps.map((s) => {
      let input: unknown = {};
      try {
        input = JSON.parse(s.inputJson);
      } catch {
        input = { __invalid_json: s.inputJson };
      }
      return { toolId: s.toolId, title: s.title, rationale: s.rationale, input, dependsOn: s.dependsOn };
    }),
  };
}

function narrationPrompt(c: { request: string; plan: ExecutionPlan; approvalsNeeded: string[] }) {
  return `The user asked: "${c.request}"
TrustOS created this plan (it has NOT run yet; it is now executing step by step):
${JSON.stringify({ summary: c.plan.summary, steps: c.plan.steps.map((s) => ({ tool: s.toolId, title: s.title })), notes: c.plan.notes }, null, 2)}
Steps that will pause for the user's approval: ${c.approvalsNeeded.length ? c.approvalsNeeded.join("; ") : "none"}.

In 3-6 short sentences, explain what will happen and what the user needs to do. Do not claim any step has completed, been sent, or been verified. Do not invent numbers.`;
}

// ---------------------------------------------------------------------------
// Anthropic (official SDK)
// ---------------------------------------------------------------------------
class AnthropicProvider implements AIProvider {
  readonly id = "anthropic";
  private readonly client: Anthropic;
  constructor(readonly model: string, apiKey: string) {
    this.client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  }

  async plan(ctx: PlanningContext): Promise<ExecutionPlan> {
    const ids = ctx.tools.map((t) => t.id) as [string, ...string[]];
    const response = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(llmPlanSchema(ids)) },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt(ctx) }],
    });
    if (response.stop_reason === "refusal") throw new Error("The model declined to plan this request.");
    if (!response.parsed_output) throw new Error("The model did not return a valid plan.");
    return toPlan(response.parsed_output, `anthropic:${this.model}`);
  }

  async *narrate(c: { request: string; plan: ExecutionPlan; approvalsNeeded: string[] }): AsyncIterable<string> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 2000,
      output_config: { effort: "low" },
      system: "You are TrustOS's assistant. Be concise, factual and honest about what has and has not happened.",
      messages: [{ role: "user", content: narrationPrompt(c) }],
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") yield event.delta.text;
    }
  }
}

// ---------------------------------------------------------------------------
// OpenAI (Vercel AI SDK)
// ---------------------------------------------------------------------------
class OpenAIProvider implements AIProvider {
  readonly id = "openai";
  private readonly openai;
  constructor(readonly model: string, apiKey: string) {
    this.openai = createOpenAI({ apiKey });
  }

  async plan(ctx: PlanningContext): Promise<ExecutionPlan> {
    const ids = ctx.tools.map((t) => t.id) as [string, ...string[]];
    const result = await generateText({
      model: this.openai(this.model),
      system: SYSTEM_PROMPT,
      prompt: userPrompt(ctx),
      output: Output.object({ schema: llmPlanSchema(ids) }),
    });
    if (!result.output) throw new Error("The model did not return a valid plan.");
    return toPlan(result.output, `openai:${this.model}`);
  }

  async *narrate(c: { request: string; plan: ExecutionPlan; approvalsNeeded: string[] }): AsyncIterable<string> {
    const result = streamText({
      model: this.openai(this.model),
      system: "You are TrustOS's assistant. Be concise, factual and honest about what has and has not happened.",
      prompt: narrationPrompt(c),
    });
    for await (const chunk of result.textStream) yield chunk;
  }
}

/** Returns the configured provider, or null when AI is not configured. */
export function getAIProvider(): AIProvider | null {
  const e = env();
  if (e.AI_PROVIDER === "anthropic" && e.ANTHROPIC_API_KEY) return new AnthropicProvider(e.AI_MODEL ?? "claude-opus-5-5", e.ANTHROPIC_API_KEY);
  if (e.AI_PROVIDER === "openai" && e.OPENAI_API_KEY) return new OpenAIProvider(e.AI_MODEL ?? "gpt-5", e.OPENAI_API_KEY);
  return null;
}
