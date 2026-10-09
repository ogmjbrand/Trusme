import Link from "next/link";
import { MessageSquare, Plus } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { getAIProvider } from "@/lib/ai/provider";
import { PageHeader, Notice } from "@/components/ui/misc";
import { LinkButton } from "@/components/ui/button";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import { CommandCenter, type ChatMessage } from "./command-center";

export const metadata = { title: "Command Center" };

export default async function CommandPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const ws = await getWorkspace();
  const { data: convs } = await ws.supabase
    .from("conversations")
    .select("id, title, updated_at")
    .eq("organization_id", ws.org.organizationId)
    .eq("user_id", ws.user.id)
    .order("updated_at", { ascending: false })
    .limit(30);
  let messages: ChatMessage[] = [];
  const active = c && (convs ?? []).some((x) => x.id === c) ? c : null;
  if (active) {
    const { data } = await ws.supabase.from("messages").select("id, role, content, execution_id").eq("conversation_id", active).order("created_at");
    messages = (data ?? []).filter((m) => m.role === "user" || m.role === "assistant") as ChatMessage[];
  }
  const provider = getAIProvider();
  const aiLabel = provider ? `${provider.id} (${provider.model})` : "rule-based (no AI provider configured)";

  return (
    <>
      <PageHeader eyebrow="AI Command Center" title="What should get done?" description="Plans are built from registered tools, validated on the server, and executed with your permissions." actions={<LinkButton href="/app/command" variant="secondary" size="sm"><Plus className="h-4 w-4" />New conversation</LinkButton>} />
      {!provider ? (
        <Notice tone="info" className="mb-4" title="Rule-based planner active">
          No AI provider is configured, so TrustOS matches common requests (receivables, margins, stock, cash flow, scam checks, launch plans) with deterministic rules. Set <code>ANTHROPIC_API_KEY</code> to enable natural-language planning.
        </Notice>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
        <aside className="hidden lg:block">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">History</div>
          <ul className="space-y-0.5">
            {(convs ?? []).map((x) => (
              <li key={x.id}>
                <Link href={`/app/command?c=${x.id}`} className={cn("flex items-start gap-2 rounded-lg px-2.5 py-2 text-xs hover:bg-surface-2", x.id === active ? "bg-surface-2 text-fg" : "text-fg-muted")}>
                  <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block truncate">{x.title}</span>
                    <span className="text-fg-subtle">{relativeTime(x.updated_at)}</span>
                  </span>
                </Link>
              </li>
            ))}
            {!convs?.length ? <li className="px-2.5 text-xs text-fg-subtle">No conversations yet.</li> : null}
          </ul>
        </aside>
        <CommandCenter key={active ?? "new"} conversationId={active} initialMessages={messages} canRun={can(ws.role, "executions.create")} aiLabel={aiLabel} />
      </div>
    </>
  );
}
