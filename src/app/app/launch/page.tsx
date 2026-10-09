import Link from "next/link";
import { Rocket } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { PageHeader, EmptyState, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { fmtDate } from "@/lib/format";
import { createLaunchProject } from "./actions";

export const metadata = { title: "LaunchReady" };

export default async function LaunchPage() {
  const ws = await getWorkspace();
  const { data: projects } = await ws.supabase.from("launch_projects").select("id, name, product_category, stage, target_launch_date, launch_tasks(status)").eq("organization_id", ws.org.organizationId).order("created_at", { ascending: false });
  type P = { id: string; name: string; product_category: string; stage: string; target_launch_date: string | null; launch_tasks: { status: string }[] };
  return (
    <>
      <PageHeader eyebrow="LaunchReady" title="Business launch" description="Turn an idea into a checklist with budget, documents, suppliers and registrations. Regulatory steps link to official sources you must verify; TrustOS does not submit to government portals or imply approval." />
      <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
        <Card>
          {(projects ?? []).length ? (
            <ul className="divide-y divide-line">
              {((projects ?? []) as unknown as P[]).map((p) => {
                const done = p.launch_tasks.filter((t) => t.status === "done").length;
                return (
                  <li key={p.id}>
                    <Link href={`/app/launch/${p.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-surface-2/60">
                      <div className="min-w-0 flex-1"><div className="font-medium">{p.name}</div><div className="text-xs text-fg-subtle">{p.product_category.replace("_", " ")} · target {fmtDate(p.target_launch_date)}</div></div>
                      <Badge>{done}/{p.launch_tasks.length} tasks</Badge>
                      <StatusBadge status={p.stage} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <EmptyState icon={Rocket} title="No launch projects" description="Describe your business idea to get a structured plan." />}
        </Card>
        {can(ws.role, "records.write") ? (
          <Card>
            <CardHeader title="New launch plan" />
            <CardBody>
              <ActionForm action={createLaunchProject} redirectTo={(d) => `/app/launch/${d.id}`} className="space-y-3">
                <Field label="Business / product name" htmlFor="ln"><Input id="ln" name="name" required /></Field>
                <Field label="Describe the idea" htmlFor="li" hint="What you'll sell, to whom, and how it's made"><Textarea id="li" name="idea" required minLength={10} className="min-h-28" /></Field>
                <Field label="Category" htmlFor="lc" hint="Leave on auto to classify from your description; confirm it on the next page"><Select id="lc" name="category" defaultValue=""><option value="">Auto-detect</option><option value="food_beverage">Food & beverage</option><option value="cosmetics">Cosmetics & personal care</option><option value="drugs_health">Drugs, herbal & health</option><option value="chemicals">Chemicals & cleaning</option><option value="electrical">Electrical & electronics</option><option value="services">Services</option><option value="general_goods">General goods</option></Select></Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Budget" htmlFor="lb"><Input id="lb" name="budget" inputMode="decimal" /></Field>
                  <Field label="Currency" htmlFor="lcur"><Select id="lcur" name="currency" defaultValue={ws.org.defaultCurrency}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                </div>
                <Field label="Target launch date" htmlFor="ld"><Input id="ld" name="target_launch_date" type="date" /></Field>
                <SubmitButton>Create plan</SubmitButton>
              </ActionForm>
              <Notice className="mt-4">Checklists are starting points. Requirements change; always confirm with the authority or a qualified professional.</Notice>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </>
  );
}
