import "server-only";
import { headers } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { sha256 } from "@/lib/domain/hash";

import { RateLimitError } from "./rate-limit-error";

export { RateLimitError };

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim();
}

/**
 * Fixed-window limiter backed by PostgreSQL (works across serverless
 * instances). Fails open only if the database call itself errors, and logs it.
 */
export async function enforceRateLimit(scope: string, identity: string, max: number, windowSeconds = 60): Promise<void> {
  const key = `${scope}:${sha256(identity).slice(0, 32)}`;
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", { p_key: key, p_window_seconds: windowSeconds, p_max: max });
  if (error) {
    console.error("rate limit check failed", scope, error.message);
    return;
  }
  if (data === false) throw new RateLimitError();
}
