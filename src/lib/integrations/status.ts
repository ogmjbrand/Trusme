import "server-only";
import { env, isSupabaseConfigured } from "@/lib/env";

export interface IntegrationStatus {
  id: string;
  name: string;
  category: "core" | "ai" | "email" | "payments" | "trust" | "government" | "jobs";
  configured: boolean;
  missing: string[];
  description: string;
  capability: string;
}

/** Platform-level integration status derived from server configuration only. */
export function integrationStatuses(): IntegrationStatus[] {
  const e = env();
  const miss = (...keys: (keyof typeof e)[]) => keys.filter((k) => !e[k]) as string[];
  const ai = e.AI_PROVIDER === "anthropic" ? miss("ANTHROPIC_API_KEY") : e.AI_PROVIDER === "openai" ? miss("OPENAI_API_KEY") : ["AI_PROVIDER"];
  return [
    { id: "supabase", name: "Supabase", category: "core", configured: isSupabaseConfigured() && !!e.SUPABASE_SERVICE_ROLE_KEY, missing: [...(isSupabaseConfigured() ? [] : ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]), ...miss("SUPABASE_SERVICE_ROLE_KEY")], description: "Database, authentication, storage.", capability: "Required for all features." },
    { id: "ai", name: e.AI_PROVIDER === "openai" ? "OpenAI" : "Anthropic Claude", category: "ai", configured: ai.length === 0, missing: ai, description: "Natural-language planning and narration in the Command Center.", capability: "Without it, a rule-based planner handles common requests." },
    { id: "cron", name: "Background runner", category: "core", configured: !!e.CRON_SECRET, missing: miss("CRON_SECRET"), description: "Resumes waiting executions and retries on a schedule.", capability: "Without it, executions resume when a user opens them." },
    { id: "resend", name: "Resend email", category: "email", configured: !!e.RESEND_API_KEY && !!e.EMAIL_FROM, missing: miss("RESEND_API_KEY", "EMAIL_FROM"), description: "Sends approved payment reminders and supplier purchase orders.", capability: "Without it, messages stay as drafts." },
    { id: "paystack", name: "Paystack", category: "payments", configured: !!e.PAYSTACK_SECRET_KEY, missing: miss("PAYSTACK_SECRET_KEY"), description: "Invoice payment links and verified payment webhooks (NGN).", capability: "Without it, record payments manually." },
    { id: "stripe", name: "Stripe", category: "payments", configured: !!e.STRIPE_SECRET_KEY && !!e.STRIPE_WEBHOOK_SECRET, missing: miss("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"), description: "Card payments and verified webhooks for international invoices.", capability: "Without it, record payments manually." },
    { id: "safe_browsing", name: "Google Safe Browsing", category: "trust", configured: !!e.GOOGLE_SAFE_BROWSING_API_KEY, missing: miss("GOOGLE_SAFE_BROWSING_API_KEY"), description: "Third-party URL reputation check in BeforeYouPay.", capability: "Without it, only on-device heuristics run." },
    { id: "cac", name: "CAC / NAFDAC / SON portals", category: "government", configured: false, missing: ["No official submission API available"], description: "Regulatory submissions.", capability: "TrustOS prepares documents; you submit on the official portal and record the reference." },
    { id: "job_boards", name: "Job boards", category: "jobs", configured: false, missing: ["No authorized integration configured"], description: "Job discovery and application submission.", capability: "Track applications manually; TrustOS never claims a submission it did not observe." },
  ];
}
