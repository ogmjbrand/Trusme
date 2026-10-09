import { ArrowRight, Boxes, Briefcase, CheckCircle2, Hammer, ListChecks, Receipt, Rocket, ShieldAlert, ShieldCheck, Sparkles, TrendingUp, Wallet } from "lucide-react";
import { LinkButton } from "@/components/ui/button";

const MODULES = [
  { icon: ShieldAlert, name: "BeforeYouPay", text: "Screen payment requests, links and sellers for scam patterns — with honest uncertainty and organized evidence." },
  { icon: Hammer, name: "JobProof", text: "Versioned service agreements, change approvals, before/after evidence and a record both parties can see." },
  { icon: Briefcase, name: "CareerVault", text: "Skills, credentials and portfolio evidence turned into tailored applications — never invented history." },
  { icon: Wallet, name: "IncomePilot", text: "Track irregular income and obligations, project cash flow with editable assumptions, and spot shortfalls early." },
  { icon: Rocket, name: "LaunchReady", text: "From idea to launch checklist, budget, suppliers and registration tracking, linked to official sources." },
  { icon: Boxes, name: "StockSense", text: "Ledger-based stock, purchase orders and rule-based restock recommendations with lead times." },
  { icon: TrendingUp, name: "MarginGuard", text: "True product profitability after fees, shipping, discounts and spoilage — every figure traceable to its records." },
  { icon: Receipt, name: "CollectIQ", text: "Invoices, payments, promises and consent-aware reminders, with verified provider payments." },
];

const STEPS = [
  { icon: Sparkles, title: "Describe the outcome", text: "“Review overdue invoices, prepare reminders and plan restocking.”" },
  { icon: ListChecks, title: "Get a typed plan", text: "Each step uses a registered tool with a validated input and a declared side effect." },
  { icon: ShieldCheck, title: "Approve what matters", text: "Read-only and low-risk steps run. Anything sent, paid or submitted waits for you." },
  { icon: CheckCircle2, title: "Verified results", text: "Outcomes are checked against the database or provider and recorded in the audit trail." },
];

export default function Home() {
  return (
    <>
      <section className="relative overflow-hidden border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.16em] text-gold">AI execution platform · business operating system</p>
          <h1 className="max-w-3xl text-4xl font-semibold leading-tight text-fg sm:text-5xl">Tell TrustOS what you want accomplished.</h1>
          <p className="mt-5 max-w-2xl text-lg text-fg-muted">TrustOS turns your goal into an actionable plan, uses authorized tools to execute the work, verifies the result and tracks the outcome — with your approval before anything consequential happens.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/signup" size="lg">Start free <ArrowRight className="h-4 w-4" /></LinkButton>
            <LinkButton href="/security" size="lg" variant="secondary">How we keep you in control</LinkButton>
          </div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.title} className="bg-surface p-5">
                <s.icon className="h-5 w-5 text-brand" aria-hidden />
                <h2 className="mt-3 text-sm font-semibold">{s.title}</h2>
                <p className="mt-1 text-sm text-fg-muted">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="modules" className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-2xl font-semibold">Eight modules. One connected workspace.</h2>
        <p className="mt-2 max-w-2xl text-fg-muted">Shared customers, products, payments and permissions. A paid invoice updates receivables and cash flow once; a recorded sale reduces stock and updates margins.</p>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {MODULES.map((m) => (
            <div key={m.name} className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
              <m.icon className="h-5 w-5 text-brand" aria-hidden />
              <h3 className="mt-3 font-semibold">{m.name}</h3>
              <p className="mt-1 text-sm text-fg-muted">{m.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-semibold">Honest by design</h2>
            <p className="mt-2 text-fg-muted">TrustOS distinguishes what was prepared from what was sent, what you claimed from what was verified, and what is forecast from what happened.</p>
          </div>
          <ul className="space-y-3 text-sm">
            {[
              "“Prepared” is never reported as “sent”. Payments count only when recorded by you or verified by the provider.",
              "Risk screening explains observed signals and uncertainty — it never labels anyone a fraudster.",
              "Regulatory checklists link to official sources and are marked “verify at source”.",
              "Demo data is always labelled “Sample” and can be removed in one step.",
            ].map((t) => <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-gold" />{t}</li>)}
          </ul>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
        <h2 className="text-2xl font-semibold">Start with your personal workspace</h2>
        <p className="mx-auto mt-2 max-w-xl text-fg-muted">Free during early access. Add a business workspace and invite your team when you&apos;re ready.</p>
        <LinkButton href="/signup" size="lg" className="mt-6">Create your account</LinkButton>
      </section>
    </>
  );
}
