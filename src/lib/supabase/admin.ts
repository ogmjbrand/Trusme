import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "@/lib/env";

let admin: SupabaseClient | undefined;

/**
 * Service-role client. Bypasses RLS — callers MUST perform explicit
 * authorization checks and scope every query by organization_id.
 * Used only by the execution engine, webhooks and public share links.
 */
export function createAdminClient(): SupabaseClient {
  if (!admin) {
    const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = requireEnv(
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
    );
    admin = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return admin;
}
