import { AlertTriangle } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney, parseMajor, SUPPORTED_CURRENCIES, toMajorString, totalsByCurrency } from "@/lib/money";
import { forecastCashFlow, incomeTarget, monthlyEquivalent, type ObligationInput, type ReceivableInput } from "@/lib/domain/cashflow";
import { PageHeader, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, SampleBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import { BalanceChart } from "@/components/modules/balance-chart";
import { fmtDate, fmtDateTime, todayIso } from "@/lib/format";
import { addIncome, addObligation, saveForecast, saveGoal, toggleObligation } from "./actions";

export const metadata = { title: "Income & cash flow" };

type SP = Record<string, string | undefined>;
const num = (v: string | undefined, d: number) => (v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

export default async function IncomePage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ws = await getWorkspace();
  const org = ws.org.organizationId;
  const currency = SUPPORTED_CURRENCIES.includes(sp.currency as never) ? sp.currency! : ws.org.defaultCurrency;
  const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const [obl, inv, income, goals, payments, expenses, saved] = await Promise.all([
    ws.supabase.from("recurring_obligations").select("*").eq("organization_id", org).order("next_due_on"),
    ws.supabase.from("invoices").select("id, invoice_number, total_minor, amount_paid_minor, due_date, currency").eq("organization_id", org).in("status", ["issued", "partially_paid"]),
    ws.supabase.from("income_entries").select("*").eq("organization_id", org).order("received_on", { ascending: false }).limit(200),
    ws.supabase.from("savings_goals").select("*").eq("organization_id", org).order("created_at"),
    ws.supabase.from("payments").select("amount_minor, currency, received_at").eq("organization_id", org).eq("status", "succeeded").gte("received_at", since),
    ws.supabase.from("expenses").select("amount_minor, currency, incurred_at").eq("organization_id", org).gte("incurred_at", since),
    ws.supabase.from("cash_flow_forecasts").select("id, name, created_at, horizon_days, currency, result, assumptions").eq("organization_id", org).order("created_at", { ascending: false }).limit(5),
  ]);

  const obligations = ((obl.data ?? []) as (ObligationInput & { is_active: boolean; currency: string; category: string; is_sample: boolean })[]);
  const activeCur = obligations.filter((o) => o.is_active && o.currency === currency);
  const receivables: ReceivableInput[] = (inv.data ?? []).filter((i) => i.currency === currency).map((i) => ({ id: i.id, label: `Invoice ${i.invoice_number}`, balance_minor: i.total_minor - i.amount_paid_minor, due_date: i.due_date }));
  const incomeCur = (income.data ?? []).filter((i) => i.currency === currency && i.received_on >= since);
  const variableMonthly = Math.round(incomeCur.reduce((s, x) => s + x.amount_minor, 0) / 3);

  let opening = 0;
  try { opening = sp.opening ? parseMajor(sp.opening, currency) : 0; } catch { opening = 0; }
  let minimum = 0;
  try { minimum = sp.minimum ? parseMajor(sp.minimum, currency) : 0; } catch { minimum = 0; }
  const assumptions = {
    openingBalanceMinor: opening,
    horizonDays: Math.min(Math.max(num(sp.horizon, 60), 7), 180),
    receivableCollectionRate: Math.min(Math.max(num(sp.collect, 80), 0), 100) / 100,
    receivableDelayDays: Math.min(Math.max(num(sp.delay, 7), 0), 90),
    variableMonthlyIncomeMinor: variableMonthly,
    variableIncomeFactor: Math.min(Math.max(num(sp.factor, 100), 0), 200) / 100,
    minimumBalanceMinor: minimum,
  };
  const today = todayIso();
  const f = forecastCashFlow(today, assumptions, activeCur, receivables);
  const monthlyObligations = activeCur.reduce((s, o) => s + monthlyEquivalent(o), 0);
  const target = incomeTarget({ monthlyObligationsMinor: monthlyObligations, monthlySavingsMinor: 0, bufferPct: 10 });
  const actualIn = totalsByCurrency([...(payments.data ?? []).map((p) => ({ amountMinor: p.amount_minor, currency: p.currency })), ...(income.data ?? []).filter((i) => i.received_on >= since).map((i) => ({ amountMinor: i.amount_minor, currency: i.currency }))]);
  const actualOut = totalsByCurrency((expenses.data ?? []).map((e) => ({ amountMinor: e.amount_minor, currency: e.currency })));
  const canWrite = can(ws.role, "records.write");

  return (
    <>
      <PageHeader eyebrow="IncomePilot" title="Income & cash flow" description="Actuals come from recorded payments, income and expenses. Projections are estimates from the assumptions below — not guarantees." />

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"><div className="text-xs text-fg-muted">Actual money in (90 days)</div><div className="tabular mt-1 text-lg font-semibold">{actualIn.length ? actualIn.map((m) => formatMoney(m.amountMinor, m.currency)).join(" · ") : "—"}</div><div className="text-xs text-fg-subtle">Invoice payments + other income, counted once</div></div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"><div className="text-xs text-fg-muted">Actual expenses (90 days)</div><div className="tabular mt-1 text-lg font-semibold">{actualOut.length ? actualOut.map((m) => formatMoney(m.amountMinor, m.currency)).join(" · ") : "—"}</div></div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"><div className="text-xs text-fg-muted">Monthly income target ({currency})</div><div className="tabular mt-1 text-lg font-semibold text-gold">{formatMoney(target, currency)}</div><div className="text-xs text-fg-subtle">Obligations {formatMoney(monthlyObligations, currency)}/mo + 10% buffer</div></div>
      </div>

      <Card className="mb-6">
        <CardHeader title={`Projected ${currency} balance — next ${assumptions.horizonDays} days`} description="Method: deterministic_v1. Edit any assumption and re-run." />
        <CardBody className="space-y-4">
          <form className="grid gap-3 sm:grid-cols-3 lg:grid-cols-7" method="get">
            <Field label="Currency" htmlFor="fc"><Select id="fc" name="currency" defaultValue={currency}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="Current balance" htmlFor="fo"><Input id="fo" name="opening" inputMode="decimal" defaultValue={sp.opening ?? ""} placeholder="0.00" /></Field>
            <Field label="Minimum balance" htmlFor="fm"><Input id="fm" name="minimum" inputMode="decimal" defaultValue={sp.minimum ?? ""} placeholder="0.00" /></Field>
            <Field label="Horizon (days)" htmlFor="fh"><Input id="fh" name="horizon" inputMode="numeric" defaultValue={String(assumptions.horizonDays)} /></Field>
            <Field label="Receivables collected %" htmlFor="fcr"><Input id="fcr" name="collect" inputMode="numeric" defaultValue={String(Math.round(assumptions.receivableCollectionRate * 100))} /></Field>
            <Field label="Collection delay (days)" htmlFor="fd"><Input id="fd" name="delay" inputMode="numeric" defaultValue={String(assumptions.receivableDelayDays)} /></Field>
            <Field label="Variable income scenario" htmlFor="ff"><Select id="ff" name="factor" defaultValue={String(Math.round(assumptions.variableIncomeFactor * 100))}><option value="70">Conservative (70%)</option><option value="100">Expected (100%)</option><option value="120">Optimistic (120%)</option></Select></Field>
            <div className="sm:col-span-3 lg:col-span-7"><button className={buttonClass("secondary", "sm")}>Update projection</button></div>
          </form>
          {!sp.opening ? <Notice tone="info">Enter your current balance — TrustOS has no bank connection and assumes 0 until you do.</Notice> : null}
          {f.shortfallDays.length ? (
            <Notice tone="danger" title="Potential cash shortage">
              Projected balance falls below your minimum on {f.shortfallDays.length} day(s), first on {fmtDate(f.shortfallDays[0])}. Lowest projected balance: {formatMoney(f.lowestBalanceMinor, currency)} on {fmtDate(f.lowestBalanceDate)}.
            </Notice>
          ) : null}
          <BalanceChart currency={currency} minimum={assumptions.minimumBalanceMinor} points={f.days.map((d) => ({ date: d.date, balance: d.balanceMinor }))} />
          <div className="grid gap-3 text-sm sm:grid-cols-3">
            <div><span className="text-fg-muted">Projected inflows:</span> <span className="tabular">{formatMoney(f.totalInflowMinor, currency)}</span></div>
            <div><span className="text-fg-muted">Projected outflows:</span> <span className="tabular">{formatMoney(f.totalOutflowMinor, currency)}</span></div>
            <div><span className="text-fg-muted">Variable income basis:</span> <span className="tabular">{formatMoney(variableMonthly, currency)}/mo</span> <span className="text-xs text-fg-subtle">(avg of last 90 days)</span></div>
          </div>
          <details className="rounded-lg border border-line">
            <summary className="cursor-pointer px-3 py-2 text-xs text-fg-muted">Projected events (table view)</summary>
            <Table>
              <THead><TR><TH>Date</TH><TH>Item</TH><TH className="text-right">Amount</TH><TH className="text-right">Balance</TH></TR></THead>
              <TBody>
                {f.days.filter((d) => d.items.length).flatMap((d) => d.items.map((it, j) => (
                  <TR key={`${d.date}-${j}`}><TD className="text-xs">{fmtDate(d.date)}</TD><TD className="text-xs">{it.label} <Badge>{it.kind.replace("_", " ")}</Badge></TD><TD className={`tabular text-right text-xs ${it.amountMinor < 0 ? "text-danger" : "text-brand"}`}>{formatMoney(it.amountMinor, currency)}</TD><TD className="tabular text-right text-xs">{j === d.items.length - 1 ? formatMoney(d.balanceMinor, currency) : ""}</TD></TR>
                )))}
              </TBody>
            </Table>
          </details>
          {canWrite ? (
            <ActionForm action={saveForecast} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="assumptions" value={JSON.stringify(assumptions)} />
              <input type="hidden" name="currency" value={currency} />
              <Field label="Save this projection as" htmlFor="fname"><Input id="fname" name="name" placeholder={`Forecast ${today}`} className="w-56" /></Field>
              <SubmitButton variant="secondary" size="sm">Save snapshot</SubmitButton>
            </ActionForm>
          ) : null}
          {(saved.data ?? []).length ? (
            <ul className="space-y-1 text-xs text-fg-muted">
              {(saved.data ?? []).map((s) => <li key={s.id}>{s.name} · {s.currency} · {s.horizon_days} days · saved {fmtDateTime(s.created_at)} · lowest {formatMoney((s.result as { lowestBalanceMinor: number }).lowestBalanceMinor, s.currency)}</li>)}
            </ul>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Recurring obligations" />
          <ul className="divide-y divide-line">
            {obligations.map((o) => (
              <li key={o.id} className="flex items-center gap-2 px-5 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className={o.is_active ? "" : "text-fg-subtle line-through"}>{o.name} {o.is_sample ? <SampleBadge /> : null}</div>
                  <div className="text-xs text-fg-subtle">{formatMoney(o.amount_minor, o.currency)} {o.frequency} · next {fmtDate(o.next_due_on)}</div>
                </div>
                {canWrite ? <InlineAction action={toggleObligation} fields={{ id: o.id, active: String(!o.is_active) }} label={o.is_active ? "Pause" : "Resume"} variant="ghost" /> : null}
              </li>
            ))}
            {!obligations.length ? <li className="px-5 py-4 text-sm text-fg-subtle">None yet.</li> : null}
          </ul>
          {canWrite ? (
            <CardBody className="border-t border-line">
              <ActionForm action={addObligation} resetOnSuccess className="grid grid-cols-2 gap-2">
                <Input name="name" placeholder="Name (e.g. Rent)" required className="col-span-2" aria-label="Obligation name" />
                <Input name="amount" placeholder="Amount" inputMode="decimal" required aria-label="Amount" />
                <Select name="currency" defaultValue={currency} aria-label="Currency">{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
                <Select name="frequency" defaultValue="monthly" aria-label="Frequency"><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></Select>
                <Input name="next_due_on" type="date" defaultValue={today} required aria-label="Next due date" />
                <SubmitButton size="sm" variant="secondary" className="col-span-2">Add obligation</SubmitButton>
              </ActionForm>
            </CardBody>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Other income" description="Income not tied to an invoice. Invoice payments are already counted — don't record them twice." />
          <ul className="max-h-72 divide-y divide-line overflow-y-auto">
            {(income.data ?? []).slice(0, 30).map((i) => (
              <li key={i.id} className="flex justify-between gap-2 px-5 py-2.5 text-sm">
                <span className="min-w-0 truncate">{i.source} {i.is_sample ? <SampleBadge /> : null}<span className="block text-xs text-fg-subtle">{fmtDate(i.received_on)}</span></span>
                <span className="tabular">{formatMoney(i.amount_minor, i.currency)}</span>
              </li>
            ))}
            {!income.data?.length ? <li className="px-5 py-4 text-sm text-fg-subtle">None yet.</li> : null}
          </ul>
          {canWrite ? (
            <CardBody className="border-t border-line">
              <ActionForm action={addIncome} resetOnSuccess className="grid grid-cols-2 gap-2">
                <Input name="source" placeholder="Source (e.g. Freelance)" required className="col-span-2" aria-label="Income source" />
                <Input name="amount" placeholder="Amount" inputMode="decimal" required aria-label="Amount" />
                <Select name="currency" defaultValue={currency} aria-label="Currency">{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
                <Input name="received_on" type="date" defaultValue={today} max={today} required className="col-span-2" aria-label="Date received" />
                <SubmitButton size="sm" variant="secondary" className="col-span-2">Record income</SubmitButton>
              </ActionForm>
            </CardBody>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="Savings goals" />
          <ul className="divide-y divide-line">
            {(goals.data ?? []).map((g) => {
              const pct = Math.min(100, Math.round((g.saved_minor / g.target_minor) * 100));
              return (
                <li key={g.id} className="space-y-2 px-5 py-3 text-sm">
                  <div className="flex justify-between"><span>{g.name}</span><span className="tabular text-xs text-fg-muted">{formatMoney(g.saved_minor, g.currency)} / {formatMoney(g.target_minor, g.currency)}</span></div>
                  <div className="h-1.5 rounded-full bg-surface-3"><div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} /></div>
                  {g.target_date ? <div className="text-xs text-fg-subtle">Target {fmtDate(g.target_date)}</div> : null}
                  {canWrite ? (
                    <ActionForm action={saveGoal} className="flex gap-2">
                      <input type="hidden" name="id" value={g.id} />
                      <Input name="saved" inputMode="decimal" defaultValue={toMajorString(g.saved_minor, g.currency)} className="h-8 text-xs" aria-label="Amount saved" />
                      <SubmitButton size="sm" variant="ghost">Update</SubmitButton>
                    </ActionForm>
                  ) : null}
                </li>
              );
            })}
            {!goals.data?.length ? <li className="px-5 py-4 text-sm text-fg-subtle">No goals yet.</li> : null}
          </ul>
          {canWrite ? (
            <CardBody className="border-t border-line">
              <ActionForm action={saveGoal} resetOnSuccess className="grid grid-cols-2 gap-2">
                <Input name="name" placeholder="Goal name" required className="col-span-2" aria-label="Goal name" />
                <Input name="target" placeholder="Target amount" inputMode="decimal" required aria-label="Target amount" />
                <Select name="currency" defaultValue={currency} aria-label="Currency">{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select>
                <Input name="target_date" type="date" className="col-span-2" aria-label="Target date" />
                <SubmitButton size="sm" variant="secondary" className="col-span-2">Add goal</SubmitButton>
              </ActionForm>
            </CardBody>
          ) : null}
        </Card>
      </div>
      <p className="mt-6 flex items-center gap-2 text-xs text-fg-subtle"><AlertTriangle className="h-3.5 w-3.5" />TrustOS does not move money or provide regulated financial advice. Forecasts are planning aids only.</p>
    </>
  );
}
