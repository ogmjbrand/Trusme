"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Activity, Boxes, Briefcase, Circle, CreditCard, FileBarChart, Hammer, LayoutDashboard, ListChecks, Menu, Plug, Receipt, Rocket,
  ScrollText, Settings, ShieldAlert, ShieldCheck, Sparkles, TrendingUp, Users, UsersRound, Wallet, X, type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Activity, Boxes, Briefcase, CreditCard, FileBarChart, Hammer, LayoutDashboard, ListChecks, Plug, Receipt, Rocket,
  ScrollText, Settings, ShieldAlert, ShieldCheck, Sparkles, TrendingUp, Users, UsersRound, Wallet,
};
import { cn } from "@/lib/cn";
import { atLeast, type OrgRole } from "@/lib/auth/permissions";
import { NAV } from "./nav";
import { Wordmark } from "./brand";

function NavLinks({ role, pendingApprovals, onNavigate }: { role: OrgRole; pendingApprovals: number; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="space-y-6" aria-label="Main">
      {NAV.map((group) => {
        const items = group.items.filter((i) => !i.minRole || atLeast(role, i.minRole));
        if (!items.length) return null;
        return (
          <div key={group.label}>
            <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">{group.label}</div>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const Icon = ICONS[item.icon] ?? Circle;
                const active = item.href === "/app" ? pathname === "/app" : pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                        active ? "bg-surface-3 text-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      <Icon className={cn("h-4 w-4", active ? "text-brand" : "")} aria-hidden />
                      <span className="flex-1">{item.label}</span>
                      {item.href === "/app/approvals" && pendingApprovals > 0 ? (
                        <span className="rounded-md bg-gold-soft px-1.5 text-[11px] font-semibold text-gold">{pendingApprovals}</span>
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

export function Sidebar({ role, pendingApprovals, switcher }: { role: OrgRole; pendingApprovals: number; switcher: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-line bg-surface lg:flex lg:flex-col">
        <div className="flex h-14 items-center border-b border-line px-4">
          <Wordmark href="/app" />
        </div>
        <div className="border-b border-line p-3">{switcher}</div>
        <div className="flex-1 overflow-y-auto px-2 py-4">
          <NavLinks role={role} pendingApprovals={pendingApprovals} />
        </div>
      </aside>

      <div className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
        <Wordmark href="/app" />
        <button onClick={() => setOpen(true)} className="rounded-lg p-2 text-fg-muted hover:bg-surface-2" aria-label="Open navigation" aria-expanded={open}>
          <Menu className="h-5 w-5" />
        </button>
      </div>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-line bg-surface">
            <div className="flex h-14 items-center justify-between border-b border-line px-4">
              <Wordmark href="/app" />
              <button onClick={() => setOpen(false)} className="rounded-lg p-2 text-fg-muted hover:bg-surface-2" aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="border-b border-line p-3">{switcher}</div>
            <div className="flex-1 overflow-y-auto px-2 py-4">
              <NavLinks role={role} pendingApprovals={pendingApprovals} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
