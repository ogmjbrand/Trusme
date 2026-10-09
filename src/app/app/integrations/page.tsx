import { CheckCircle2, CircleDashed } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { integrationStatuses } from "@/lib/integrations/status";
import { PageHeader } from "@/components/ui/misc";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  await getWorkspace();
  const list = integrationStatuses();
  return (
    <>
      <PageHeader title="Integrations" description="Status is derived from server configuration. TrustOS never reports an integration as active unless its credentials are configured, and every action still verifies the provider's response." />
      <div className="grid gap-4 md:grid-cols-2">
        {list.map((i) => (
          <Card key={i.id} className="p-5">
            <div className="flex items-start gap-3">
              {i.configured ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-brand" /> : <CircleDashed className="mt-0.5 h-5 w-5 text-fg-subtle" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{i.name}</span><Badge tone={i.configured ? "brand" : "neutral"}>{i.configured ? "configured" : "not configured"}</Badge><Badge>{i.category}</Badge></div>
                <p className="mt-1 text-sm text-fg-muted">{i.description}</p>
                <p className="mt-1 text-xs text-fg-subtle">{i.capability}</p>
                {!i.configured ? <p className="mt-2 font-mono text-[11px] text-warning">Missing: {i.missing.join(", ")}</p> : null}
              </div>
            </div>
          </Card>
        ))}
      </div>
      <p className="mt-6 text-xs text-fg-subtle">Server secrets are set as environment variables by your deployment administrator (see docs/DEPLOYMENT.md). They are never entered or displayed in the browser.</p>
    </>
  );
}
