import { ZodError } from "zod";
import { AuthorizationError } from "@/lib/auth/permissions";
import { ConfigurationError } from "@/lib/env";
import { RateLimitError } from "@/lib/services/rate-limit-error";

export type ActionResult<T = undefined> =
  | { ok: true; data: T; message?: string }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

interface PgLikeError {
  code?: string;
  message?: string;
  details?: string;
}

/** Convert thrown errors into safe, user-presentable messages. */
export function toUserError(err: unknown): { error: string; fieldErrors?: Record<string, string> } {
  if (err instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of err.issues) {
      const key = issue.path.join(".") || "form";
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { error: "Please correct the highlighted fields.", fieldErrors };
  }
  if (err instanceof AuthorizationError || err instanceof RateLimitError) return { error: err.message };
  if (err instanceof ConfigurationError) return { error: `Setup required: ${err.missing.join(", ")} is not configured.` };
  const pg = err as PgLikeError;
  if (pg && typeof pg === "object" && typeof pg.code === "string") {
    switch (pg.code) {
      case "42501":
        return { error: pg.message?.includes("row-level security") ? "You do not have permission to perform this action." : pg.message ?? "Permission denied." };
      case "23505":
        return { error: "A record with these details already exists." };
      case "23503":
        return { error: pg.message ?? "A related record was not found." };
      case "22023":
      case "55000":
      case "23514":
        return { error: pg.message ?? "The request is not valid in the current state." };
    }
  }
  if (err instanceof Error) {
    console.error(err);
    return { error: "Something went wrong. The error has been logged." };
  }
  return { error: "Something went wrong." };
}

export async function runAction<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (err) {
    // Next.js redirect/notFound are thrown as special errors — let them through.
    if (err && typeof err === "object" && "digest" in err && typeof (err as { digest: unknown }).digest === "string" && (err as { digest: string }).digest.startsWith("NEXT_")) throw err;
    return { ok: false, ...toUserError(err) };
  }
}

/** Throw Supabase errors so they flow through toUserError. */
export function unwrap<T>(res: { data: T; error: PgLikeError | null }): T {
  if (res.error) throw res.error;
  return res.data;
}
