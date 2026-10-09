import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/field";
import { requestPasswordReset } from "../actions";

export const metadata = { title: "Reset password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-fg-muted">We&apos;ll email you a secure link.</p>
      <ActionForm action={requestPasswordReset} resetOnSuccess className="mt-6 space-y-4">
        <Field label="Email" htmlFor="email"><Input id="email" name="email" type="email" autoComplete="email" required /></Field>
        <SubmitButton className="w-full">Send reset link</SubmitButton>
      </ActionForm>
      <Link href="/login" className="mt-6 block text-sm text-fg-muted hover:text-fg">Back to sign in</Link>
    </>
  );
}
