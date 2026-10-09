import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/field";
import { resetPassword } from "../actions";

export const metadata = { title: "Choose a new password" };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <ActionForm action={resetPassword} className="mt-6 space-y-4">
        <Field label="New password" htmlFor="password" hint="At least 10 characters"><Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
        <Field label="Confirm password" htmlFor="confirm"><Input id="confirm" name="confirm" type="password" autoComplete="new-password" required /></Field>
        <SubmitButton className="w-full">Update password</SubmitButton>
      </ActionForm>
    </>
  );
}
