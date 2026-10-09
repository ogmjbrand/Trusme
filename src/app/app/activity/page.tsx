import Link from "next/link";
import { Activity } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { PageHeader, EmptyState } from "@/components/ui/misc";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { fmtDateTime } from "@/lib/format";
import { markNotificationsRead } from "../actions";

export const metadata = { title: "Activity" };

export default async function ActivityPage() {
  const ws = await getWorkspace();
  const [{ data: events }, { data: notes }] = await Promise.all([
    ws.supabase.from("execution_events").select("id, execution_id, actor_type, event_type, message, created_at").eq("organization_id", ws.org.organizationId).order("id", { ascending: false }).limit(100),
    ws.supabase.from("notifications").select("id, title, body, link, read_at, created_at").eq("user_id", ws.user.id).order("created_at", { ascending: false }).limit(20),
  ]);
  return (
    <>
      <PageHeader title="Activity" description="Execution events across this workspace and your notifications." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Execution events" />
          {events?.length ? (
            <ol className="divide-y divide-line">
              {events.map((e) => (
                <li key={e.id} className="flex flex-wrap items-start gap-3 px-5 py-3 text-sm">
                  <time className="tabular w-40 shrink-0 text-xs text-fg-subtle">{fmtDateTime(e.created_at)}</time>
                  <Badge tone={e.event_type.includes("failed") ? "danger" : e.event_type.includes("approval") ? "gold" : "neutral"}>{e.event_type}</Badge>
                  <Link href={`/app/tasks/${e.execution_id}`} className="min-w-0 flex-1 text-fg-muted hover:text-fg">{e.message}</Link>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState icon={Activity} title="No activity yet" />
          )}
        </Card>
        <Card>
          <CardHeader title="Notifications" actions={notes?.some((n) => !n.read_at) ? <ActionForm action={markNotificationsRead}><SubmitButton variant="ghost" size="sm">Mark all read</SubmitButton></ActionForm> : null} />
          <ul className="divide-y divide-line">
            {(notes ?? []).map((n) => (
              <li key={n.id} className="px-5 py-3 text-sm">
                <div className="flex items-center gap-2">
                  {!n.read_at ? <span className="h-1.5 w-1.5 rounded-full bg-gold" aria-label="unread" /> : null}
                  {n.link ? <Link href={n.link} className="font-medium text-fg hover:text-brand">{n.title}</Link> : <span className="font-medium text-fg">{n.title}</span>}
                </div>
                {n.body ? <p className="mt-0.5 text-xs text-fg-muted">{n.body}</p> : null}
                <p className="mt-0.5 text-[11px] text-fg-subtle">{fmtDateTime(n.created_at)}</p>
              </li>
            ))}
            {!notes?.length ? <li className="px-5 py-4 text-sm text-fg-subtle">No notifications.</li> : null}
          </ul>
        </Card>
      </div>
    </>
  );
}
