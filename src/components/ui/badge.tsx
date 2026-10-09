import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type Tone = "neutral" | "brand" | "gold" | "danger" | "warning" | "info";
const tones: Record<Tone, string> = {
  neutral: "border-line-strong bg-surface-2 text-fg-muted",
  brand: "border-brand/30 bg-brand-soft text-brand",
  gold: "border-gold/30 bg-gold-soft text-gold",
  danger: "border-danger/30 bg-danger-soft text-danger",
  warning: "border-warning/30 bg-warning-soft text-warning",
  info: "border-info/30 bg-info-soft text-info",
};

export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4", tones[tone], className)}>
      {children}
    </span>
  );
}

const STATUS_TONES: Record<string, Tone> = {
  // executions & steps
  completed: "brand", succeeded: "brand", approved: "brand", paid: "brand", verified: "brand", sent: "brand", received: "brand", done: "brand", accurate: "brand", agreed: "brand", low: "brand", connected: "brand",
  running: "info", queued: "info", in_progress: "info", issued: "info", preparing: "info", applied: "info", interviewing: "info", under_review: "info", submitted_by_user: "info",
  pending_approval: "gold", awaiting_approval: "gold", pending: "gold", waiting: "gold", retry_scheduled: "gold", draft: "neutral", proposed: "gold", awaiting_confirmation: "gold", elevated: "warning", partially_paid: "warning", partially_received: "warning", partially_completed: "warning", query_raised: "warning", blocked: "warning", unverified: "warning",
  failed: "danger", rejected: "danger", cancelled: "neutral", void: "neutral", skipped: "neutral", high: "danger", disputed: "danger", overdue: "danger", expired: "neutral", superseded: "neutral", out_of_stock: "danger", error: "danger",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{label ?? status.replace(/_/g, " ")}</Badge>;
}

export function SampleBadge() {
  return <Badge tone="gold" title="Sample data loaded for demonstration. Not real customer data.">Sample</Badge>;
}
