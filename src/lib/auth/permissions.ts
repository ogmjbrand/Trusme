/**
 * Application authorization matrix. Mirrors (and must stay consistent with)
 * the Supabase RLS policies in supabase/migrations/*_security.sql.
 * Server code calls `assertCan` before every write; RLS is the backstop.
 * See docs/AUTHORIZATION.md for the human-readable matrix.
 */
export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type OrgRole = (typeof ROLES)[number];

const RANK: Record<OrgRole, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

export function roleRank(role: OrgRole): number {
  return RANK[role];
}

export function atLeast(role: OrgRole | null | undefined, min: OrgRole): boolean {
  return !!role && RANK[role] >= RANK[min];
}

export const PERMISSIONS = {
  "records.read": "viewer",
  "records.write": "member",
  "records.delete": "admin",
  "payments.record": "member",
  "payments.reverse": "admin",
  "executions.create": "member",
  "executions.cancel": "member",
  "approvals.decide": "member",
  "documents.upload": "member",
  "documents.delete": "admin",
  "members.read": "viewer",
  "members.invite": "admin",
  "members.manage": "admin",
  "roles.grant_admin": "owner",
  "audit.read": "admin",
  "integrations.manage": "admin",
  "billing.manage": "owner",
  "organization.update": "admin",
  "organization.delete": "owner",
} as const satisfies Record<string, OrgRole>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: OrgRole | null | undefined, permission: Permission): boolean {
  return atLeast(role, PERMISSIONS[permission]);
}

export class AuthorizationError extends Error {
  readonly status = 403;
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function assertCan(role: OrgRole | null | undefined, permission: Permission): void {
  if (!can(role, permission)) {
    throw new AuthorizationError(`Requires ${PERMISSIONS[permission]} role or higher (${permission})`);
  }
}
