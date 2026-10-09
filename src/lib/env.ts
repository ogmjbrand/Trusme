import "server-only";
import { z } from "zod";

/**
 * Server environment. Parsed lazily so that pages which do not need a given
 * integration still render when it is not configured. Never import this file
 * from client components.
 */
const schema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  AI_PROVIDER: z.enum(["anthropic", "openai", "none"]).default("anthropic"),
  AI_MODEL: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  CRON_SECRET: z.string().min(16).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(3).optional(),
  PAYSTACK_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_SECRET_KEY: z.string().min(1).optional(),
  STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  GOOGLE_SAFE_BROWSING_API_KEY: z.string().min(1).optional(),
});

export type ServerEnv = z.infer<typeof schema>;

function blankToUndefined(source: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(source)) out[k] = v === "" ? undefined : v;
  return out;
}

let cached: ServerEnv | undefined;
export function env(): ServerEnv {
  if (!cached) cached = schema.parse(blankToUndefined(process.env));
  return cached;
}

export function isSupabaseConfigured(): boolean {
  const e = env();
  return Boolean(e.NEXT_PUBLIC_SUPABASE_URL && e.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export class ConfigurationError extends Error {
  constructor(public readonly missing: string[], message?: string) {
    super(message ?? `Missing configuration: ${missing.join(", ")}`);
    this.name = "ConfigurationError";
  }
}

export function requireEnv<K extends keyof ServerEnv>(...keys: K[]): { [P in K]-?: NonNullable<ServerEnv[P]> } {
  const e = env();
  const missing = keys.filter((k) => e[k] === undefined || e[k] === null);
  if (missing.length) throw new ConfigurationError(missing as string[]);
  return e as { [P in K]-?: NonNullable<ServerEnv[P]> };
}
