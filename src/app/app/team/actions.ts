"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspace, requirePermission } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { newToken, sha256 } from "@/lib/domain/hash";
import { env } from "@/lib/env";
import { resendSender } from "@/lib/integrations/email";

export async function inviteMember(_: ActionResult<{ url: string; emailed: boolean }> | null, form: FormData): Promise<ActionResult<{ url: string; emailed: boolean }>> {
  return runAction(async () => {
    const ws = await requirePermission("members.invite");
    const d = z.object({ email: z.string().trim().toLowerCase().email(), role: z.enum(["admin", "member", "viewer"]) }).parse({ email: form.get("email"), role: form.get("role") });
    if (d.role === "admin" && !can(ws.role, "roles.grant_admin")) throw new Error("Only owners can invite admins");
    const token = newToken(24);
    unwrap(await ws.supabase.from("invitations").insert({ organization_id: ws.org.organizationId, email: d.email, role: d.role, token_hash: sha256(token), invited_by: ws.user.id }));
    const url = `${env().NEXT_PUBLIC_APP_URL}/invite/${token}`;
    let emailed = false;
    const email = resendSender();
    if (email.configured) {
      try {
        await email.send({ to: d.email, subject: `You're invited to ${ws.org.name} on TrustOS`, text: `${ws.profile.full_name ?? ws.profile.email} invited you to join ${ws.org.name} as ${d.role}.\n\nAccept: ${url}\n\nThis link expires in 7 days.`, idempotencyKey: `invite-${sha256(token).slice(0, 32)}` });
        emailed = true;
      } catch {
        emailed = false;
      }
    }
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "invitation.created", resourceType: "invitation", metadata: { email: d.email, role: d.role, emailed } });
    revalidatePath("/app/team/members");
    return { url, emailed };
  }, "Invitation created");
}

export async function revokeInvitation(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("members.invite");
    const id = z.string().uuid().parse(form.get("id"));
    unwrap(await ws.supabase.from("invitations").update({ revoked_at: new Date().toISOString() }).eq("id", id).eq("organization_id", ws.org.organizationId));
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "invitation.revoked", resourceType: "invitation", resourceId: id });
    revalidatePath("/app/team/members");
    return null;
  }, "Invitation revoked");
}

export async function changeRole(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("members.manage");
    const d = z.object({ user_id: z.string().uuid(), role: z.enum(["owner", "admin", "member", "viewer"]) }).parse({ user_id: form.get("user_id"), role: form.get("role") });
    unwrap(await ws.supabase.rpc("update_member_role", { p_org: ws.org.organizationId, p_user: d.user_id, p_role: d.role }));
    revalidatePath("/app/team/members");
    return null;
  }, "Role updated");
}

export async function removeMember(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    const userId = z.string().uuid().parse(form.get("user_id"));
    unwrap(await ws.supabase.rpc("remove_member", { p_org: ws.org.organizationId, p_user: userId }));
    if (userId === ws.user.id) {
      await ws.supabase.from("user_preferences").update({ active_organization_id: null }).eq("user_id", ws.user.id);
    }
    revalidatePath("/app", "layout");
    return null;
  }, "Member removed");
}

export async function acceptInvitation(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await getWorkspace();
    const token = z.string().min(20).max(64).parse(form.get("token"));
    const orgId = unwrap(await ws.supabase.rpc("accept_invitation", { p_token: token })) as string;
    await ws.supabase.from("user_preferences").upsert({ user_id: ws.user.id, active_organization_id: orgId });
    revalidatePath("/app", "layout");
    return null;
  }, "You've joined the workspace");
}
