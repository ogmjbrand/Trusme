"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspace, requirePermission } from "@/lib/auth/context";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";

const opt = (v: FormDataEntryValue | null) => (v === null || String(v).trim() === "" ? undefined : String(v).trim());

export async function updateProfile(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    const d = z.object({ full_name: z.string().trim().min(1).max(120), phone: z.string().max(40).optional() }).parse({ full_name: form.get("full_name"), phone: opt(form.get("phone")) });
    unwrap(await ws.supabase.from("profiles").update(d).eq("id", ws.user.id));
    revalidatePath("/app", "layout");
    return null;
  }, "Profile updated");
}

export async function updatePreferences(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    unwrap(await ws.supabase.from("user_preferences").upsert({ user_id: ws.user.id, active_organization_id: ws.org.organizationId, ai_auto_run_low_risk: form.get("ai_auto_run_low_risk") === "on", notification_settings: { email: form.get("notify_email") === "on", in_app: true } }));
    revalidatePath("/app/settings");
    return null;
  }, "Preferences saved");
}

export async function updateOrganization(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("organization.update");
    const d = z.object({ name: z.string().trim().min(1).max(120), default_currency: z.string().regex(/^[A-Z]{3}$/), country: z.string().length(2), reminder_cadence_days: z.coerce.number().int().min(1).max(60).nullable() })
      .parse({ name: form.get("name"), default_currency: form.get("default_currency"), country: form.get("country"), reminder_cadence_days: form.get("reminder_cadence_days") ? form.get("reminder_cadence_days") : null });
    unwrap(await ws.supabase.from("organizations").update(d).eq("id", ws.org.organizationId));
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "organization.updated", resourceType: "organization", resourceId: ws.org.organizationId, metadata: d });
    revalidatePath("/app", "layout");
    return null;
  }, "Workspace updated");
}

export async function changePassword(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    const d = z.object({ password: z.string().min(10, "Use at least 10 characters").max(128), confirm: z.string() }).refine((v) => v.password === v.confirm, { message: "Passwords do not match", path: ["confirm"] }).parse({ password: form.get("password"), confirm: form.get("confirm") });
    const { error } = await ws.supabase.auth.updateUser({ password: d.password });
    if (error) throw new Error(error.message);
    return null;
  }, "Password changed");
}
