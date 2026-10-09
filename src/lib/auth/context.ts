import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { assertCan, type OrgRole, type Permission } from "@/lib/auth/permissions";

export interface Membership {
  organizationId: string;
  name: string;
  slug: string;
  kind: "personal" | "business";
  role: OrgRole;
  defaultCurrency: string;
}

export interface WorkspaceContext {
  user: User;
  supabase: SupabaseClient;
  memberships: Membership[];
  org: Membership;
  role: OrgRole;
  profile: { full_name: string | null; email: string };
  preferences: { ai_auto_run_low_risk: boolean };
}

export const getUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

/**
 * Resolves the signed-in user, their memberships and the active workspace.
 * Membership and role are read from the database on every request — never
 * from client-supplied values.
 */
export const getWorkspace = cache(async (): Promise<WorkspaceContext> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) redirect("/login");

  const [{ data: rows, error }, { data: prefs }, { data: profile }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("role, organization_id, organizations(id, name, slug, kind, default_currency)")
      .eq("user_id", user.id)
      .eq("status", "active"),
    supabase.from("user_preferences").select("active_organization_id, ai_auto_run_low_risk").eq("user_id", user.id).maybeSingle(),
    supabase.from("profiles").select("full_name, email").eq("id", user.id).maybeSingle(),
  ]);
  if (error) throw error;

  type Row = {
    role: OrgRole;
    organization_id: string;
    organizations: { id: string; name: string; slug: string; kind: "personal" | "business"; default_currency: string } | null;
  };
  const memberships: Membership[] = ((rows ?? []) as unknown as Row[])
    .filter((r) => r.organizations)
    .map((r) => ({
      organizationId: r.organization_id,
      name: r.organizations!.name,
      slug: r.organizations!.slug,
      kind: r.organizations!.kind,
      role: r.role,
      defaultCurrency: r.organizations!.default_currency,
    }))
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "personal" ? -1 : 1));

  if (memberships.length === 0) redirect("/onboarding");
  const org =
    memberships.find((m) => m.organizationId === prefs?.active_organization_id) ?? (memberships[0] as Membership);

  return {
    user,
    supabase,
    memberships,
    org,
    role: org.role,
    profile: { full_name: profile?.full_name ?? null, email: profile?.email ?? user.email ?? "" },
    preferences: { ai_auto_run_low_risk: prefs?.ai_auto_run_low_risk ?? true },
  };
});

export async function requirePermission(permission: Permission): Promise<WorkspaceContext> {
  const ctx = await getWorkspace();
  assertCan(ctx.role, permission);
  return ctx;
}

/** For pages: render a 403 state instead of throwing. */
export async function pagePermission(permission: Permission): Promise<{ ctx: WorkspaceContext; allowed: boolean }> {
  const ctx = await getWorkspace();
  try {
    assertCan(ctx.role, permission);
    return { ctx, allowed: true };
  } catch {
    return { ctx, allowed: false };
  }
}
