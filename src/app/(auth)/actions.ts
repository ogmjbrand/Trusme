"use server";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import type { ActionResult } from "@/lib/errors";
import { clientIp, enforceRateLimit, RateLimitError } from "@/lib/services/rate-limit";

async function limited(scope: string, identity: string, max: number): Promise<string | null> {
  try {
    await enforceRateLimit(scope, identity, max);
    return null;
  } catch (err) {
    if (err instanceof RateLimitError) return err.message;
    throw err;
  }
}

function safeNext(next: FormDataEntryValue | string | null | undefined): string {
  const n = typeof next === "string" ? next : "";
  return n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/app";
}

async function origin() {
  const h = await headers();
  return env().NEXT_PUBLIC_APP_URL || `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

const email = z.string().trim().toLowerCase().email("Enter a valid email");

export async function signIn(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  const parsed = z.object({ email, password: z.string().min(1, "Enter your password") }).safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const blocked = (await limited("signin_ip", await clientIp(), 20)) ?? (await limited("signin_email", parsed.data.email, 8));
  if (blocked) return { ok: false, error: blocked };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Generic message: do not reveal whether the account exists.
    return { ok: false, error: error.message.toLowerCase().includes("confirm") ? "Please verify your email address first — check your inbox." : "Incorrect email or password." };
  }
  redirect(safeNext(form.get("next")));
}

export async function signUp(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  const parsed = z
    .object({ full_name: z.string().trim().min(2, "Enter your name").max(120), email, password: z.string().min(10, "Use at least 10 characters").max(128), terms: z.literal("on", { message: "Accept the terms to continue" }) })
    .safeParse({ full_name: form.get("full_name"), email: form.get("email"), password: form.get("password"), terms: form.get("terms") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const blocked = await limited("signup_ip", await clientIp(), 5);
  if (blocked) return { ok: false, error: blocked };
  const supabase = await createClient();
  const next = safeNext(form.get("next"));
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.full_name }, emailRedirectTo: `${await origin()}/auth/confirm?next=${encodeURIComponent(next)}` },
  });
  if (error) return { ok: false, error: error.message };
  if (data.session) redirect(next); // email confirmation disabled in this project
  return { ok: true, data: null, message: "Check your email to verify your address, then sign in." };
}

export async function requestPasswordReset(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  const parsed = email.safeParse(form.get("email"));
  if (!parsed.success) return { ok: false, error: "Enter a valid email" };
  const blocked = (await limited("reset_ip", await clientIp(), 5)) ?? (await limited("reset_email", parsed.data, 3));
  if (blocked) return { ok: false, error: blocked };
  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(parsed.data, { redirectTo: `${await origin()}/auth/confirm?next=/reset-password` });
  // Same response whether or not the account exists.
  return { ok: true, data: null, message: "If an account exists for that email, a reset link is on its way." };
}

export async function resetPassword(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  const parsed = z.object({ password: z.string().min(10, "Use at least 10 characters").max(128), confirm: z.string() }).refine((v) => v.password === v.confirm, { message: "Passwords do not match" }).safeParse({ password: form.get("password"), confirm: form.get("confirm") });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message };
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { ok: false, error: "Your reset link has expired. Request a new one." };
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: error.message };
  redirect("/app");
}
