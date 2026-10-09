import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { signIn } from "../actions";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-fg-muted">Welcome back to TrustOS.</p>
      {error === "link" ? <Notice tone="warning" className="mt-4">That link is invalid or has expired. Request a new one.</Notice> : null}
      <ActionForm action={signIn} className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next ?? "/app"} />
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" htmlFor="password"><Input id="password" name="password" type="password" autoComplete="current-password" required /></Field>
        <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
      </ActionForm>
      <div className="mt-6 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-fg-muted hover:text-fg">Forgot password?</Link>
        <Link href={`/signup${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="text-brand hover:underline">Create account</Link>
      </div>
    </>
  );
}
