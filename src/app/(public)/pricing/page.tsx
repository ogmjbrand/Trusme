import { PLANS } from "@/lib/billing/plans";
import { LinkButton } from "@/components/ui/button";

export const metadata = { title: "Pricing" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold">Pricing</h1>
      <p className="mt-2 max-w-2xl text-fg-muted">TrustOS is free during early access. Paid plans will be announced before they launch — we will not charge you without clear notice and your explicit choice.</p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => (
          <div key={p.id} className={`rounded-[var(--radius-card)] border bg-surface p-6 ${p.id === "free" ? "border-brand/40" : "border-line"}`}>
            <h2 className="text-lg font-semibold">{p.name}</h2>
            <p className="mt-1 text-sm text-gold">{p.priceLabel}</p>
            <ul className="mt-5 space-y-2 text-sm text-fg-muted">{p.features.map((f) => <li key={f}>• {f}</li>)}</ul>
            {p.id === "free" ? <LinkButton href="/signup" className="mt-6 w-full">Get started</LinkButton> : <p className="mt-6 text-xs text-fg-subtle">Not yet available.</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
