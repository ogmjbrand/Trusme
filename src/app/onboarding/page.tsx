import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";
import { Wordmark } from "@/components/shell/brand";
import { Card, CardBody } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/field";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { createOrganization } from "@/app/app/actions";

export const metadata = { title: "Set up your workspace" };

/** Shown only when a signed-in user has no workspace (e.g. they left all of them). */
export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const { count } = await supabase.from("organization_members").select("organization_id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count ?? 0) > 0) redirect("/app");
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="mb-6"><Wordmark /></div>
      <Card>
        <CardBody className="space-y-4">
          <h1 className="text-lg font-semibold">Create a workspace</h1>
          <p className="text-sm text-fg-muted">You are not a member of any workspace. Create one to continue.</p>
          <ActionForm action={createOrganization} redirectTo={() => "/app"} className="space-y-3">
            <Field label="Workspace name" htmlFor="wn"><Input id="wn" name="name" required /></Field>
            <Field label="Default currency" htmlFor="wc"><Select id="wc" name="currency" defaultValue="NGN">{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <SubmitButton>Create workspace</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
