"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { ExecutionView } from "@/components/modules/execution-view";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  execution_id: string | null;
}

const EXAMPLES = [
  "Review my overdue invoices, identify products with declining profit margins, prepare payment reminders and create a restocking plan.",
  "Which products are running low and what should I reorder?",
  "Will I run short of cash in the next 60 days?",
  "Is this legit? “Pay ₦50,000 commitment fee today only to secure the iPhone, send OTP to confirm” https://paystack-verify.example.net",
];

export function CommandCenter({ conversationId: initialConversation, initialMessages, canRun, aiLabel }: { conversationId: string | null; initialMessages: ChatMessage[]; canRun: boolean; aiLabel: string }) {
  const [conversationId, setConversationId] = useState(initialConversation);
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const router = useRouter();

  async function submit(text: string) {
    const request = text.trim();
    if (!request || busy) return;
    setBusy(true);
    setError(null);
    setInput("");
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: "user", content: request, execution_id: null };
    const asstId = `a-${Date.now()}`;
    setMessages((m) => [...m, userMsg, { id: asstId, role: "assistant", content: "", execution_id: null }]);
    try {
      const res = await fetch("/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, conversationId, idempotencyKey: crypto.randomUUID() }),
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${res.status})`);
      }
      const execId = res.headers.get("X-Execution-Id");
      const convId = res.headers.get("X-Conversation-Id");
      if (convId && convId !== conversationId) {
        setConversationId(convId);
        window.history.replaceState(null, "", `/app/command?c=${convId}`);
      }
      setMessages((m) => m.map((x) => (x.id === asstId ? { ...x, execution_id: execId } : x)));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => m.map((x) => (x.id === asstId ? { ...x, content: x.content + chunk } : x)));
        bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      }
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setMessages((m) => m.filter((x) => x.id !== asstId));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[70vh] flex-col">
      <div className="flex-1 space-y-6">
        {messages.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
            <div className="flex items-center gap-2 text-sm font-medium text-fg">
              <Sparkles className="h-4 w-4 text-gold" /> Tell TrustOS what you want accomplished
            </div>
            <p className="mt-1 text-sm text-fg-muted">
              TrustOS turns your goal into a plan of registered tools, runs read-only and low-risk steps, and pauses for your approval before anything is sent or committed. Planner: {aiLabel}.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((ex) => (
                <button key={ex} disabled={!canRun || busy} onClick={() => submit(ex)} className="rounded-lg border border-line bg-surface-2 p-3 text-left text-xs text-fg-muted hover:border-line-strong hover:text-fg disabled:opacity-50">
                  {ex}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) => (
          <div key={m.id} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
            {m.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-md border border-brand/25 bg-brand-soft px-4 py-2.5 text-sm text-fg">{m.content}</div>
            ) : (
              <div className="w-full max-w-3xl space-y-3">
                <div className="rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3 text-sm leading-relaxed text-fg">
                  {m.content ? <div className="whitespace-pre-wrap">{m.content}</div> : <span className="inline-flex items-center gap-2 text-fg-muted"><Loader2 className="h-4 w-4 animate-spin" /> Planning…</span>}
                </div>
                {m.execution_id ? (
                  <div className="rounded-[var(--radius-card)] border border-line bg-surface-2/50 p-4">
                    <ExecutionView executionId={m.execution_id} compact />
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>

      <form
        className="sticky bottom-0 mt-6 bg-gradient-to-t from-bg via-bg to-transparent pb-2 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input);
        }}
      >
        {error ? <p className="mb-2 text-sm text-danger" role="alert">{error}</p> : null}
        <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 focus-within:border-brand">
          <label htmlFor="command" className="sr-only">Describe what you want accomplished</label>
          <textarea
            id="command"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit(input);
              }
            }}
            rows={2}
            maxLength={4000}
            disabled={!canRun}
            placeholder={canRun ? "e.g. Prepare reminders for overdue invoices and draft a restock order" : "Viewers cannot run commands"}
            className="max-h-48 min-h-12 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
          />
          <Button type="submit" disabled={!canRun || busy || input.trim().length < 3} aria-label="Run command" className="h-10 w-10 shrink-0 p-0">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
          </Button>
        </div>
        <p className="mt-1.5 px-2 text-[11px] text-fg-subtle">Plans only use registered tools. Consequential actions always wait for your approval.</p>
      </form>
    </div>
  );
}
