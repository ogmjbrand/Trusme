import { notFound } from "next/navigation";
import { getWorkspace } from "@/lib/auth/context";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ExecutionView } from "@/components/modules/execution-view";
import { fmtDateTime } from "@/lib/format";
import type { ExecutionPlan } from "@/lib/execution/types";

export const metadata = { title: "Execution" };

export default async function ExecutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getWorkspace();
  const { data: e } = await ws.supabase.from("executions").select("id, goal, originating_request, plan_summary, plan, created_at, created_by").eq("id", id).eq("organization_id", ws.org.organizationId).maybeSingle();
  if (!e) notFound();
  const plan = e.plan as ExecutionPlan;
  return (
    <>
      <PageHeader eyebrow="Execution" title={e.goal} description={`Started ${fmtDateTime(e.created_at)}`} />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Plan and progress" description={e.plan_summary ?? undefined} />
          <CardBody>
            <ExecutionView executionId={e.id} />
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Original request" />
            <CardBody><p className="whitespace-pre-wrap text-sm text-fg-muted">{e.originating_request}</p></CardBody>
          </Card>
          {plan.notes?.length ? (
            <Card>
              <CardHeader title="Planner notes" description="Limitations and things to do outside TrustOS" />
              <CardBody>
                <ul className="list-disc space-y-1.5 pl-4 text-sm text-fg-muted">
                  {plan.notes.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
