import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { paystack } from "@/lib/integrations/payments/paystack";
import { stripe } from "@/lib/integrations/payments/stripe";
import { PageHeader, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PLANS } from "@/lib/billing/plans";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Billing" };

export default async function BillingPage() {
  const ws = await getWorkspace();
  const { data: sub } = await ws.supabase.from("subscriptions").select("*").eq("organization_id", ws.org.organizationId).maybeSingle();
  const providerReady = paystack().configured || stripe().configured;
  return (
    <>
      <PageHeader title="Billing" description={`Plan for ${ws.org.name}`} />
      <Card className="mb-6">
        <CardHeader title="Current plan" />
        <CardBody className="flex flex-wrap items-center gap-3 text-sm">
          <Badge tone="gold">{sub?.plan ?? "free"}</Badge>
          <StatusBadge status={sub?.status === "active" ? "completed" : sub?.status ?? "pending"} label={sub?.status ?? "active"} />
          {sub?.current_period_end ? <span className="text-fg-muted">Renews {fmtDate(sub.current_period_end)}</span> : null}
        </CardBody>
      </Card>
      {!providerReady ? <Notice className="mb-6" title="Paid plans are not available yet">No billing provider is configured for this deployment, so upgrades are disabled. Everything in the Free plan works today.</Notice> : null}
      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => (
          <Card key={p.id} className={p.id === (sub?.plan ?? "free") ? "border-brand/40" : ""}>
            <CardHeader title={p.name} description={p.priceLabel} />
            <CardBody>
              <ul className="space-y-1.5 text-sm text-fg-muted">{p.features.map((f) => <li key={f}>• {f}</li>)}</ul>
              <div className="mt-4">
                {p.id === (sub?.plan ?? "free") ? <Badge tone="brand">Current plan</Badge> : <Button size="sm" variant="secondary" disabled title={!providerReady ? "Billing provider not configured" : !can(ws.role, "billing.manage") ? "Only owners can change billing" : "Self-serve checkout not yet enabled"}>Upgrade</Button>}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}
