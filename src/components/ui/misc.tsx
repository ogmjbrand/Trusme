import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";

export function PageHeader({ title, description, actions, eyebrow }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1 text-xs font-medium uppercase tracking-[0.12em] text-gold">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold text-fg">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      <div className="mb-3 rounded-xl border border-line bg-surface-2 p-3 text-fg-muted">
        <Icon className="h-5 w-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" | "brand" | "gold" }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3.5">
      <div className="text-xs text-fg-muted">{label}</div>
      <div className={cn("tabular mt-1 text-xl font-semibold", tone === "danger" ? "text-danger" : tone === "brand" ? "text-brand" : tone === "gold" ? "text-gold" : "text-fg")}>{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-fg-subtle">{hint}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger"; title?: ReactNode; children: ReactNode; className?: string }) {
  const Icon = tone === "danger" ? ShieldAlert : tone === "warning" ? AlertTriangle : Info;
  const styles = tone === "danger" ? "border-danger/30 bg-danger-soft" : tone === "warning" ? "border-warning/30 bg-warning-soft" : "border-info/25 bg-info-soft";
  const iconColor = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-info";
  return (
    <div className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", styles, className)} role={tone === "danger" ? "alert" : "note"}>
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", iconColor)} aria-hidden />
      <div className="min-w-0 text-fg">
        {title ? <div className="font-medium">{title}</div> : null}
        <div className={cn(title && "mt-0.5", "text-fg-muted")}>{children}</div>
      </div>
    </div>
  );
}

export function Forbidden({ requirement }: { requirement: string }) {
  return (
    <div className="mx-auto max-w-lg py-16">
      <Notice tone="warning" title="You don't have access to this page">
        This area requires the {requirement} role or higher in the current workspace. Ask a workspace owner if you need access.
      </Notice>
    </div>
  );
}

export function DefinitionList({ items }: { items: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map((i, idx) => (
        <div key={idx} className="min-w-0">
          <dt className="text-xs text-fg-subtle">{i.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-fg">{i.value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
