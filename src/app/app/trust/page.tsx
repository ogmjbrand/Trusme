import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { PageHeader, EmptyState, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { fmtDateTime } from "@/lib/format";
import { screenPayment } from "./actions";

export const metadata = { title: "BeforeYouPay" };

export default async function TrustPage() {
  const ws = await getWorkspace();
  const { data } = await ws.supabase.from("risk_assessments").select("id, title, risk_level, risk_score, created_at, outcome").eq("organization_id", ws.org.organizationId).order("created_at", { ascending: false }).limit(50);
  return (
    <>
      <PageHeader eyebrow="BeforeYouPay" title="Check before you pay" description="Screen a payment request, seller or link for common scam patterns. TrustOS reports what it observed and how certain it is — it never declares that someone is a fraudster." />
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader title="New screening" />
          <CardBody>
            {can(ws.role, "records.write") ? (
              <ActionForm action={screenPayment} redirectTo={(d) => `/app/trust/${d.id}`} className="space-y-3">
                <Field label="Message or offer you received" htmlFor="text" hint="Paste the exact text. It stays private to this workspace."><Textarea id="text" name="text" maxLength={10000} className="min-h-32" /></Field>
                <Field label="Link (optional)" htmlFor="url"><Input id="url" name="url" placeholder="https://…" /></Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Seller / business name" htmlFor="cn"><Input id="cn" name="counterparty_name" /></Field>
                  <Field label="Their phone / handle" htmlFor="cc"><Input id="cc" name="counterparty_contact" /></Field>
                  <Field label="Name on the account to pay" htmlFor="an" hint="Compared with the seller name"><Input id="an" name="account_name" /></Field>
                  <Field label="Payment method requested" htmlFor="pm"><Input id="pm" name="payment_method" placeholder="e.g. transfer to personal account" /></Field>
                  <Field label="Amount" htmlFor="amt"><Input id="amt" name="amount" inputMode="decimal" /></Field>
                  <Field label="Currency" htmlFor="cur"><Select id="cur" name="currency" defaultValue={ws.org.defaultCurrency}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                </div>
                <SubmitButton pendingLabel="Screening…">Screen this payment</SubmitButton>
              </ActionForm>
            ) : <p className="text-sm text-fg-muted">Viewers cannot create screenings.</p>}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Notice title="How to read results">
            <span className="block">• <b>Heuristic observation</b>: a pattern TrustOS matched in what you pasted.</span>
            <span className="block">• <b>User claim</b>: something you told TrustOS.</span>
            <span className="block">• <b>Third-party report</b>: from an external service, with source and time.</span>
            <span className="block">• <b>Verified evidence</b>: an official or verifiable record you attached.</span>
          </Notice>
          <Card>
            <CardHeader title="History" />
            {data?.length ? (
              <ul className="divide-y divide-line">
                {data.map((a) => (
                  <li key={a.id}>
                    <Link href={`/app/trust/${a.id}`} className="flex items-center gap-2 px-5 py-3 text-sm hover:bg-surface-2/60">
                      <span className="min-w-0 flex-1 truncate">{a.title}<span className="block text-xs text-fg-subtle">{fmtDateTime(a.created_at)}</span></span>
                      <StatusBadge status={a.risk_level} label={`${a.risk_level} indicators`} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <EmptyState icon={ShieldAlert} title="No screenings yet" />}
          </Card>
        </div>
      </div>
    </>
  );
}
