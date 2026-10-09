import { getWorkspace } from "@/lib/auth/context";
import { can, roleRank, type OrgRole } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Select } from "@/components/ui/field";
import { fmtDate } from "@/lib/format";
import { changeRole, removeMember, revokeInvitation } from "../actions";
import { InviteForm } from "./invite-form";

export const metadata = { title: "Members" };

export default async function MembersPage() {
  const ws = await getWorkspace();
  const org = ws.org.organizationId;
  const [{ data: members }, invites] = await Promise.all([
    ws.supabase.from("organization_members").select("user_id, role, status, created_at").eq("organization_id", org).order("created_at"),
    can(ws.role, "members.invite") ? ws.supabase.from("invitations").select("id, email, role, expires_at, created_at").eq("organization_id", org).is("accepted_at", null).is("revoked_at", null).order("created_at", { ascending: false }) : Promise.resolve({ data: [] as { id: string; email: string; role: string; expires_at: string; created_at: string }[] }),
  ]);
  const ids = (members ?? []).map((m) => m.user_id);
  const { data: profiles } = ids.length ? await ws.supabase.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const manage = can(ws.role, "members.manage");
  const isOwner = ws.role === "owner";
  return (
    <>
      <PageHeader title="Members" description="Roles are enforced on the server and in the database. Only owners can grant or remove admin/owner." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <Table>
            <THead><TR><TH>Member</TH><TH>Role</TH><TH>Joined</TH><TH /></TR></THead>
            <TBody>
              {(members ?? []).map((m) => {
                const p = profiles?.find((x) => x.id === m.user_id);
                const canEdit = manage && m.user_id !== ws.user.id && (isOwner || roleRank(m.role as OrgRole) < 3);
                return (
                  <TR key={m.user_id}>
                    <TD><div className="font-medium">{p?.full_name ?? p?.email ?? "Member"}{m.user_id === ws.user.id ? <span className="ml-1 text-xs text-fg-subtle">(you)</span> : null}</div><div className="text-xs text-fg-subtle">{p?.email}</div></TD>
                    <TD>
                      {canEdit ? (
                        <ActionForm action={changeRole} className="flex gap-1">
                          <input type="hidden" name="user_id" value={m.user_id} />
                          <Select name="role" defaultValue={m.role} className="h-8 w-28 text-xs" aria-label="Role">
                            {isOwner ? <option value="owner">owner</option> : null}
                            {isOwner ? <option value="admin">admin</option> : null}
                            <option value="member">member</option>
                            <option value="viewer">viewer</option>
                          </Select>
                          <SubmitButton size="sm" variant="ghost">Save</SubmitButton>
                        </ActionForm>
                      ) : <Badge tone={m.role === "owner" ? "gold" : "neutral"}>{m.role}</Badge>}
                    </TD>
                    <TD className="text-xs text-fg-muted">{fmtDate(m.created_at)}</TD>
                    <TD className="text-right">
                      {canEdit ? <InlineAction action={removeMember} fields={{ user_id: m.user_id }} label="Remove" variant="ghost" confirm="Remove this member from the workspace?" /> : null}
                      {m.user_id === ws.user.id && ws.org.kind === "business" ? <InlineAction action={removeMember} fields={{ user_id: m.user_id }} label="Leave" variant="ghost" confirm="Leave this workspace? You will lose access to its records." /> : null}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
        {can(ws.role, "members.invite") ? (
          <div className="space-y-6">
            <Card>
              <CardHeader title="Invite someone" description={ws.org.kind === "personal" ? "Tip: invite collaborators to a business workspace instead of your personal one." : "Invitations expire after 7 days and only work for the invited email."} />
              <CardBody><InviteForm canInviteAdmin={isOwner} /></CardBody>
            </Card>
            <Card>
              <CardHeader title="Pending invitations" />
              <ul className="divide-y divide-line">
                {(invites.data ?? []).map((i) => (
                  <li key={i.id} className="flex items-center gap-2 px-5 py-2.5 text-sm"><span className="min-w-0 flex-1 truncate">{i.email} <Badge>{i.role}</Badge><span className="block text-xs text-fg-subtle">expires {fmtDate(i.expires_at)}</span></span><InlineAction action={revokeInvitation} fields={{ id: i.id }} label="Revoke" variant="ghost" /></li>
                ))}
                {!invites.data?.length ? <li className="px-5 py-3 text-sm text-fg-subtle">None.</li> : null}
              </ul>
            </Card>
          </div>
        ) : null}
      </div>
    </>
  );
}
