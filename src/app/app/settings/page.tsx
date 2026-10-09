import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { createOrganization, loadSampleData, removeSampleData, signOut } from "../actions";
import { changePassword, updateOrganization, updatePreferences, updateProfile } from "./actions";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ws = await getWorkspace();
  const [{ data: profile }, { data: prefs }, { data: org }] = await Promise.all([
    ws.supabase.from("profiles").select("full_name, phone, email").eq("id", ws.user.id).single(),
    ws.supabase.from("user_preferences").select("ai_auto_run_low_risk, notification_settings").eq("user_id", ws.user.id).maybeSingle(),
    ws.supabase.from("organizations").select("name, country, default_currency, kind, slug").eq("id", ws.org.organizationId).single(),
  ]);
  const canOrg = can(ws.role, "organization.update");
  return (
    <>
      <PageHeader title="Settings" description="Your profile, preferences and workspace configuration." actions={<form action={signOut}><button className={buttonClass("secondary", "sm")}>Sign out</button></form>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Profile" description={profile?.email} />
          <CardBody>
            <ActionForm action={updateProfile} className="space-y-3">
              <Field label="Full name" htmlFor="sn"><Input id="sn" name="full_name" defaultValue={profile?.full_name ?? ""} required /></Field>
              <Field label="Phone" htmlFor="sp"><Input id="sp" name="phone" defaultValue={profile?.phone ?? ""} /></Field>
              <SubmitButton>Save profile</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Execution preferences" />
          <CardBody>
            <ActionForm action={updatePreferences} className="space-y-3">
              <Checkbox name="ai_auto_run_low_risk" defaultChecked={prefs?.ai_auto_run_low_risk ?? true} label="Run low-risk, reversible steps automatically" hint="e.g. drafting reminders or purchase orders. Consequential steps (sending, paying, submitting) always need approval." />
              <Checkbox name="notify_email" defaultChecked={(prefs?.notification_settings as { email?: boolean } | null)?.email ?? true} label="Email me about approvals (when email is configured)" />
              <SubmitButton variant="secondary">Save preferences</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Workspace" description={`${org?.kind} workspace · /${org?.slug}`} />
          <CardBody>
            <ActionForm action={updateOrganization} className="space-y-3">
              <Field label="Name" htmlFor="on"><Input id="on" name="name" defaultValue={org?.name} disabled={!canOrg} required /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Default currency" htmlFor="oc"><Select id="oc" name="default_currency" defaultValue={org?.default_currency} disabled={!canOrg}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                <Field label="Country (ISO code)" htmlFor="oco"><Input id="oco" name="country" defaultValue={org?.country} maxLength={2} disabled={!canOrg} /></Field>
              </div>
              {canOrg ? <SubmitButton variant="secondary">Save workspace</SubmitButton> : <p className="text-xs text-fg-muted">Only admins can change workspace settings.</p>}
            </ActionForm>
            {canOrg ? (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                <ActionForm action={loadSampleData}><SubmitButton size="sm" variant="gold">Load labelled sample data</SubmitButton></ActionForm>
                <ActionForm action={removeSampleData}><SubmitButton size="sm" variant="ghost">Remove sample data</SubmitButton></ActionForm>
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Create a business workspace" description="Separate records, team and billing. You become its owner." />
          <CardBody>
            <ActionForm action={createOrganization} className="space-y-3">
              <Field label="Business name" htmlFor="bn"><Input id="bn" name="name" required /></Field>
              <Field label="Default currency" htmlFor="bc"><Select id="bc" name="currency" defaultValue="NGN">{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <SubmitButton>Create workspace</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Password" />
          <CardBody>
            <ActionForm action={changePassword} resetOnSuccess className="space-y-3">
              <Field label="New password" htmlFor="pw"><Input id="pw" name="password" type="password" autoComplete="new-password" minLength={10} required /></Field>
              <Field label="Confirm" htmlFor="pw2"><Input id="pw2" name="confirm" type="password" autoComplete="new-password" required /></Field>
              <SubmitButton variant="secondary">Change password</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
