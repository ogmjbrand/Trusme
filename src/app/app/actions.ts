"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getWorkspace, requirePermission } from "@/lib/auth/context";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";

export async function switchWorkspace(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    const orgId = z.string().uuid().parse(form.get("organizationId"));
    if (!ws.memberships.some((m) => m.organizationId === orgId)) throw new Error("Not a member of that workspace");
    unwrap(await ws.supabase.from("user_preferences").upsert({ user_id: ws.user.id, active_organization_id: orgId }));
    revalidatePath("/app", "layout");
    return null;
  });
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function createOrganization(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    const input = z
      .object({ name: z.string().trim().min(2).max(120), currency: z.string().regex(/^[A-Z]{3}$/).default("NGN"), country: z.string().length(2).default("NG") })
      .parse({ name: form.get("name"), currency: form.get("currency") || undefined, country: form.get("country") || undefined });
    const id = unwrap(await ws.supabase.rpc("create_organization", { p_name: input.name, p_country: input.country, p_currency: input.currency })) as string;
    unwrap(await ws.supabase.from("user_preferences").upsert({ user_id: ws.user.id, active_organization_id: id }));
    revalidatePath("/app", "layout");
    return { id };
  }, "Business workspace created");
}

export async function loadSampleData(_: ActionResult<null> | null): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("organization.update");
    unwrap(await ws.supabase.rpc("load_sample_data", { p_org: ws.org.organizationId }));
    revalidatePath("/app", "layout");
    return null;
  }, "Sample data loaded. Every sample record is labelled “Sample”.");
}

export async function removeSampleData(_: ActionResult<null> | null): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("organization.update");
    unwrap(await ws.supabase.rpc("remove_sample_data", { p_org: ws.org.organizationId }));
    revalidatePath("/app", "layout");
    return null;
  }, "Sample data removed");
}

export async function markNotificationsRead(_: ActionResult<null> | null): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    unwrap(await ws.supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", ws.user.id).is("read_at", null));
    revalidatePath("/app", "layout");
    return null;
  });
}

export async function auditUserAction(action: string, resourceType: string, resourceId: string | null, metadata?: Record<string, unknown>) {
  const ws = await getWorkspace();
  await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action, resourceType, resourceId, metadata });
}
