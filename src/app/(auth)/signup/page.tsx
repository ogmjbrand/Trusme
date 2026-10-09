import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { signUp } from "../actions";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-fg-muted">A private personal workspace is created for you. You can add business workspaces later.</p>
      <ActionForm action={signUp} resetOnSuccess className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next ?? "/app"} />
        <Field label="Full name" htmlFor="full_name"><Input id="full_name" name="full_name" autoComplete="name" required /></Field>
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters"><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Checkbox name="terms" required label={<span>I agree to the <Link href="/terms" className="text-brand underline">Terms</Link> and <Link href="/privacy" className="text-brand underline">Privacy Policy</Link></span>} />
        <SubmitButton className="w-full" pendingLabel="Creating…">Create account</SubmitButton>
      </ActionForm>
      <p className="mt-6 text-sm text-fg-muted">Already have an account? <Link href="/login" className="text-brand hover:underline">Sign in</Link></p>
    </>
  );
}
