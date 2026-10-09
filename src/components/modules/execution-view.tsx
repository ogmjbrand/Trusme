"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, Circle, Download, ExternalLink, Loader2, PauseCircle, RotateCcw, ShieldCheck, XCircle } from "lucide-react";
import type { ApprovalRow, ExecutionRow, StepRow } from "@/lib/execution/types";
import { StatusBadge, Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Textarea } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { cancelExecution, decideApproval, resumeExecution, retryStep } from "@/app/app/tasks/actions";
import { cn } from "@/lib/cn";

interface EventRow {
  id: number;
  step_id: string | null;
  actor_type: string;
  event_type: string;
  message: string;
  created_at: string;
}
interface Payload {
  execution: ExecutionRow;
  steps: StepRow[];
  events: EventRow[];
  approvals: ApprovalRow[];
  role: string;
}

const TERMINAL = ["completed", "partially_completed", "failed", "cancelled"];
const SIDE_EFFECT_LABEL: Record<string, { label: string; tone: "neutral" | "info" | "gold" }> = {
  read: { label: "Read-only", tone: "neutral" },
  reversible_write: { label: "Reversible write", tone: "info" },
  consequential: { label: "Consequential", tone: "gold" },
};

function StepIcon({ status }: { status: string }) {
  if (status === "succeeded") return <CheckCircle2 className="h-5 w-5 text-brand" aria-hidden />;
  if (status === "failed" || status === "rejected") return <XCircle className="h-5 w-5 text-danger" aria-hidden />;
  if (status === "running") return <Loader2 className="h-5 w-5 animate-spin text-info" aria-hidden />;
  if (status === "awaiting_approval" || status === "retry_scheduled") return <PauseCircle className="h-5 w-5 text-gold" aria-hidden />;
  return <Circle className="h-5 w-5 text-fg-subtle" aria-hidden />;
}

export function ExecutionView({ executionId, compact = false }: { executionId: string; compact?: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/executions/${executionId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(res.status === 404 ? "Execution not found" : `Failed to load (${res.status})`);
      setData(await res.json());
      setFetchedAt(Date.now());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [executionId]);

  useEffect(() => {
    const t = setTimeout(load, 0);
    return () => clearTimeout(t);
  }, [load]);

  const status = data?.execution.status;
  useEffect(() => {
    if (status && TERMINAL.includes(status)) return;
    const t = setInterval(load, status === "pending_approval" ? 4000 : 1500);
    return () => clearInterval(t);
  }, [status, load]);

  if (error && !data) return <p className="text-sm text-danger">{error}</p>;
  if (!data) {
    return (
      <div className="flex items-center gap-2 text-sm text-fg-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading execution…
      </div>
    );
  }

  const { execution: e, steps, approvals, events } = data;
  const done = steps.filter((s) => ["succeeded", "failed", "skipped", "rejected", "cancelled"].includes(s.status)).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const canAct = data.role !== "viewer";
  const stale = ["queued", "running", "waiting"].includes(e.status) && fetchedAt - Date.parse(e.updated_at) > 30_000;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={e.status} />
        <span className="text-xs text-fg-subtle">
          {done}/{steps.length} steps · planner {e.planner}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canAct && !TERMINAL.includes(e.status) ? (
            <ActionForm action={cancelExecution} onSuccess={load}>
              <input type="hidden" name="executionId" value={e.id} />
              <SubmitButton variant="ghost" size="sm">Cancel</SubmitButton>
            </ActionForm>
          ) : null}
          {canAct && (stale || e.status === "waiting" || e.status === "queued") ? (
            <ActionForm action={resumeExecution} onSuccess={() => setTimeout(load, 800)}>
              <input type="hidden" name="executionId" value={e.id} />
              <SubmitButton variant="secondary" size="sm">Resume</SubmitButton>
            </ActionForm>
          ) : null}
          <a href={`/api/executions/${e.id}/report`} className={buttonClass("secondary", "sm")}>
            <Download className="h-3.5 w-3.5" /> Report
          </a>
          {compact ? (
            <Link href={`/app/tasks/${e.id}`} className={buttonClass("ghost", "sm")}>
              Details <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn("h-full rounded-full transition-all", e.status === "failed" ? "bg-danger" : "bg-brand")} style={{ width: `${pct}%` }} />
      </div>

      {e.result_summary ? <p className="text-sm text-fg-muted">{e.result_summary}</p> : null}
      {e.error_summary ? <pre className="whitespace-pre-wrap rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs text-danger">{e.error_summary}</pre> : null}

      <ol className="space-y-3">
        {steps.map((s) => (
          <StepCard key={s.id} step={s} approvals={approvals.filter((a) => a.step_id === s.id)} canAct={canAct} onChanged={load} />
        ))}
      </ol>

      {!compact ? (
        <details className="rounded-lg border border-line bg-surface">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-fg">Event timeline ({events.length})</summary>
          <ol className="max-h-96 space-y-2 overflow-y-auto border-t border-line px-4 py-3">
            {events.map((ev) => (
              <li key={ev.id} className="flex gap-3 text-xs">
                <time className="tabular w-36 shrink-0 text-fg-subtle">{new Date(ev.created_at).toLocaleString("en-NG")}</time>
                <span className="w-16 shrink-0 text-fg-subtle">{ev.actor_type}</span>
                <span className="text-fg-muted">{ev.message}</span>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </div>
  );
}

function StepCard({ step: s, approvals, canAct, onChanged }: { step: StepRow; approvals: ApprovalRow[]; canAct: boolean; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const pending = approvals.find((a) => a.status === "pending");
  const decided = approvals.filter((a) => a.status !== "pending");
  const se = SIDE_EFFECT_LABEL[s.side_effect] ?? SIDE_EFFECT_LABEL.read!;
  return (
    <li className="rounded-lg border border-line bg-surface">
      <div className="flex items-start gap-3 px-4 py-3">
        <StepIcon status={s.status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-fg">
              {s.position + 1}. {s.title}
            </span>
            <StatusBadge status={s.status} />
            <Badge tone={se.tone}>{se.label}</Badge>
            {s.outcome_label ? <Badge tone={s.outcome_label === "sent" ? "brand" : "neutral"}>{s.outcome_label}</Badge> : null}
            {s.verification !== "not_applicable" ? <StatusBadge status={s.verification} label={`verification: ${s.verification}`} /> : null}
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-fg-subtle">{s.tool_id}</div>
          {s.rationale ? <p className="mt-1 text-xs text-fg-muted">{s.rationale}</p> : null}
          {s.error ? (
            <p className="mt-2 text-xs text-danger">
              {s.error.message}
              {s.error.setupRequired?.length ? <span className="block text-fg-muted">Setup required: {s.error.setupRequired.join(", ")} — see Integrations.</span> : null}
            </p>
          ) : null}
          {s.verification_detail ? <p className="mt-1 text-xs text-fg-muted">{s.verification_detail}</p> : null}
          {s.result_refs.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {s.result_refs.map((r) =>
                r.href ? (
                  <Link key={`${r.type}-${r.id}`} href={r.href} className="rounded-md border border-line-strong px-2 py-0.5 text-[11px] text-fg-muted hover:text-fg">
                    {r.label}
                  </Link>
                ) : (
                  <span key={`${r.type}-${r.id}`} className="rounded-md border border-line px-2 py-0.5 text-[11px] text-fg-subtle">{r.label}</span>
                ),
              )}
            </div>
          ) : null}
        </div>
        <button onClick={() => setOpen((o) => !o)} className="rounded p-1 text-fg-subtle hover:text-fg" aria-expanded={open} aria-label="Toggle step details">
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {pending ? (
        <div className="border-t border-gold/25 bg-gold-soft/40 px-4 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-gold">
            <ShieldCheck className="h-4 w-4" /> Approval required
          </div>
          <p className="mt-1 text-sm text-fg">{pending.summary}</p>
          <p className="mt-1 text-xs text-fg-subtle">Approver: {pending.approver_min_role} or higher. Approval applies only to this exact action.</p>
          {canAct ? (
            <ActionForm action={decideApproval} onSuccess={() => setTimeout(onChanged, 600)} className="mt-3 space-y-2">
              <input type="hidden" name="approvalId" value={pending.id} />
              <Textarea name="note" placeholder="Optional note (recorded in the audit trail)" className="min-h-14" maxLength={500} />
              <div className="flex gap-2">
                <SubmitButton name="decision" value="approve" size="sm">Approve</SubmitButton>
                <SubmitButton name="decision" value="reject" variant="danger" size="sm">Reject</SubmitButton>
              </div>
            </ActionForm>
          ) : (
            <p className="mt-2 text-xs text-fg-muted">Viewers cannot approve actions.</p>
          )}
        </div>
      ) : null}

      {canAct && s.status === "failed" ? (
        <div className="border-t border-line px-4 py-2.5">
          <ActionForm action={retryStep} onSuccess={() => setTimeout(onChanged, 600)}>
            <input type="hidden" name="stepId" value={s.id} />
            <SubmitButton variant="secondary" size="sm">
              <RotateCcw className="h-3.5 w-3.5" /> Retry step{s.side_effect === "consequential" ? " (needs fresh approval)" : ""}
            </SubmitButton>
          </ActionForm>
        </div>
      ) : null}

      {open ? (
        <div className="space-y-3 border-t border-line px-4 py-3 text-xs">
          <div className="grid gap-2 sm:grid-cols-3">
            <div><span className="text-fg-subtle">Attempts:</span> {s.attempt_count}/{s.max_attempts}</div>
            <div><span className="text-fg-subtle">Started:</span> {s.started_at ? new Date(s.started_at).toLocaleString("en-NG") : "—"}</div>
            <div><span className="text-fg-subtle">Completed:</span> {s.completed_at ? new Date(s.completed_at).toLocaleString("en-NG") : "—"}</div>
          </div>
          {s.permission_check ? (
            <div>
              <div className="mb-1 text-fg-subtle">Permission check</div>
              <pre className="overflow-x-auto rounded bg-surface-2 p-2 text-fg-muted">{JSON.stringify(s.permission_check, null, 2)}</pre>
            </div>
          ) : null}
          <div>
            <div className="mb-1 text-fg-subtle">Validated input</div>
            <pre className="overflow-x-auto rounded bg-surface-2 p-2 text-fg-muted">{JSON.stringify(s.input, null, 2)}</pre>
          </div>
          {s.output ? (
            <div>
              <div className="mb-1 text-fg-subtle">Output</div>
              <pre className="max-h-80 overflow-auto rounded bg-surface-2 p-2 text-fg-muted">{JSON.stringify(s.output, null, 2)}</pre>
            </div>
          ) : null}
          {decided.length ? (
            <div>
              <div className="mb-1 text-fg-subtle">Approval history</div>
              <ul className="space-y-1">
                {decided.map((a) => (
                  <li key={a.id} className="text-fg-muted">
                    <StatusBadge status={a.status} /> {a.decided_at ? new Date(a.decided_at).toLocaleString("en-NG") : ""} {a.decision_note ? `— ${a.decision_note}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
