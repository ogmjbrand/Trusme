import Link from "next/link";
import { Bell, LogOut } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { Sidebar } from "@/components/shell/sidebar";
import { WorkspaceSwitcher } from "@/components/shell/workspace-switcher";
import { signOut } from "./actions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ws = await getWorkspace();
  const [{ count: pending }, { count: unread }] = await Promise.all([
    ws.supabase.from("approval_requests").select("id", { count: "exact", head: true }).eq("organization_id", ws.org.organizationId).eq("status", "pending"),
    ws.supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", ws.user.id).is("read_at", null),
  ]);
  const switcher = (
    <WorkspaceSwitcher
      current={ws.org.organizationId}
      options={ws.memberships.map((m) => ({ id: m.organizationId, name: m.name, kind: m.kind, role: m.role }))}
    />
  );
  return (
    <div className="min-h-screen lg:flex">
      <Sidebar role={ws.role} pendingApprovals={pending ?? 0} switcher={switcher} />
      <div className="min-w-0 flex-1">
        <header className="hidden h-14 items-center justify-end gap-2 border-b border-line px-6 lg:flex">
          <Link href="/app/activity" className="relative rounded-lg p-2 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}>
            <Bell className="h-4 w-4" />
            {unread ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-gold" /> : null}
          </Link>
          <div className="mx-2 h-6 w-px bg-line" />
          <div className="text-right text-xs leading-tight">
            <div className="text-fg">{ws.profile.full_name ?? ws.profile.email}</div>
            <div className="text-fg-subtle">{ws.org.name} · {ws.role}</div>
          </div>
          <form action={signOut}>
            <button className="ml-2 rounded-lg p-2 text-fg-muted hover:bg-surface-2 hover:text-fg" aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" />
            </button>
          </form>
        </header>
        <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
