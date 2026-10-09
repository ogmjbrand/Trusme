import Link from "next/link";
import { ArrowRight, KeyRound, ScrollText, UsersRound } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const ws = await getWorkspace();
  const { count } = await ws.supabase.from("organization_members").select("user_id", { count: "exact", head: true }).eq("organization_id", ws.org.organizationId);
  const items = [
    { href: "/app/team/members", icon: UsersRound, title: "Members & invitations", text: `${count ?? 0} member(s). Invite teammates and manage roles.` },
    { href: "/app/team/roles", icon: KeyRound, title: "Roles & permissions", text: "What owners, admins, members and viewers can do." },
    ...(can(ws.role, "audit.read") ? [{ href: "/app/audit", icon: ScrollText, title: "Audit log", text: "Who did what, when — including AI and webhook actions." }] : []),
  ];
  return (
    <>
      <PageHeader title="Team" description={`${ws.org.name} · your role: ${ws.role}`} />
      <div className="grid gap-4 md:grid-cols-3">
        {items.map((i) => (
          <Link key={i.href} href={i.href}>
            <Card className="h-full p-5 transition-colors hover:border-line-strong">
              <i.icon className="h-5 w-5 text-brand" />
              <div className="mt-3 flex items-center gap-2 font-medium">{i.title}<ArrowRight className="h-3.5 w-3.5 text-fg-subtle" /></div>
              <p className="mt-1 text-sm text-fg-muted">{i.text}</p>
            </Card>
          </Link>
        ))}
      </div>
      {ws.org.kind === "personal" ? <p className="mt-6 text-sm text-fg-muted">This is your personal workspace. Create a business workspace in <Link href="/app/settings" className="text-brand underline">Settings</Link> to collaborate with a team.</p> : null}
    </>
  );
}
