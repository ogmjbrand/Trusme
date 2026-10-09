/**
 * IncomePilot deterministic cash-flow projection. Forecasts are estimates
 * built from explicit, user-editable assumptions — never guarantees.
 */
export interface ForecastAssumptions {
  openingBalanceMinor: number;
  horizonDays: number;
  /** Fraction (0–1) of open receivables expected to be collected on their due date. */
  receivableCollectionRate: number;
  /** Extra days of delay applied to receivable collections. */
  receivableDelayDays: number;
  /** Average monthly variable income not tied to invoices (e.g. gig income). */
  variableMonthlyIncomeMinor: number;
  /** Scenario multiplier applied to variable income (0.7 conservative, 1 expected, 1.2 optimistic). */
  variableIncomeFactor: number;
  /** Minimum balance the user wants to keep; days below it raise an alert. */
  minimumBalanceMinor: number;
}

export interface ObligationInput {
  id: string;
  name: string;
  amount_minor: number;
  frequency: "weekly" | "monthly" | "quarterly" | "yearly";
  next_due_on: string;
}

export interface ReceivableInput {
  id: string;
  label: string;
  balance_minor: number;
  due_date: string;
}

export interface ForecastDay {
  date: string;
  inflowMinor: number;
  outflowMinor: number;
  balanceMinor: number;
  items: { label: string; amountMinor: number; kind: "receivable" | "variable_income" | "obligation" }[];
}

export interface ForecastResult {
  method: "deterministic_v1";
  days: ForecastDay[];
  lowestBalanceMinor: number;
  lowestBalanceDate: string;
  shortfallDays: string[];
  totalInflowMinor: number;
  totalOutflowMinor: number;
  requiredMonthlyIncomeMinor: number;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function addMonths(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z");
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

export function occurrences(o: ObligationInput, start: string, end: string): string[] {
  const out: string[] = [];
  let cur = o.next_due_on;
  let i = 0;
  while (cur <= end && i < 1000) {
    if (cur >= start) out.push(cur);
    i += 1;
    cur =
      o.frequency === "weekly" ? addDays(o.next_due_on, 7 * i)
      : o.frequency === "monthly" ? addMonths(o.next_due_on, i)
      : o.frequency === "quarterly" ? addMonths(o.next_due_on, 3 * i)
      : addMonths(o.next_due_on, 12 * i);
  }
  return out;
}

export function monthlyEquivalent(o: Pick<ObligationInput, "amount_minor" | "frequency">): number {
  switch (o.frequency) {
    case "weekly": return Math.round((o.amount_minor * 52) / 12);
    case "monthly": return o.amount_minor;
    case "quarterly": return Math.round(o.amount_minor / 3);
    case "yearly": return Math.round(o.amount_minor / 12);
  }
}

export function forecastCashFlow(
  start: string,
  a: ForecastAssumptions,
  obligations: ObligationInput[],
  receivables: ReceivableInput[],
): ForecastResult {
  const end = addDays(start, a.horizonDays - 1);
  const days = new Map<string, ForecastDay>();
  for (let i = 0; i < a.horizonDays; i++) {
    const date = addDays(start, i);
    days.set(date, { date, inflowMinor: 0, outflowMinor: 0, balanceMinor: 0, items: [] });
  }

  for (const r of receivables) {
    const expected = Math.round(r.balance_minor * a.receivableCollectionRate);
    if (expected <= 0) continue;
    let date = addDays(r.due_date, a.receivableDelayDays);
    if (date < start) date = start; // overdue: assume earliest possible collection, flagged by the rate
    const d = days.get(date);
    if (!d) continue;
    d.inflowMinor += expected;
    d.items.push({ label: r.label, amountMinor: expected, kind: "receivable" });
  }

  // Variable income spread evenly as a weekly amount on each 7th day.
  const weekly = Math.round((a.variableMonthlyIncomeMinor * a.variableIncomeFactor * 12) / 52);
  if (weekly > 0) {
    for (let i = 6; i < a.horizonDays; i += 7) {
      const d = days.get(addDays(start, i))!;
      d.inflowMinor += weekly;
      d.items.push({ label: "Estimated variable income", amountMinor: weekly, kind: "variable_income" });
    }
  }

  for (const o of obligations) {
    for (const date of occurrences(o, start, end)) {
      const d = days.get(date);
      if (!d) continue;
      d.outflowMinor += o.amount_minor;
      d.items.push({ label: o.name, amountMinor: -o.amount_minor, kind: "obligation" });
    }
  }

  let balance = a.openingBalanceMinor;
  let lowest = balance;
  let lowestDate = start;
  let totalIn = 0;
  let totalOut = 0;
  const shortfall: string[] = [];
  const list = [...days.values()];
  for (const d of list) {
    balance += d.inflowMinor - d.outflowMinor;
    d.balanceMinor = balance;
    totalIn += d.inflowMinor;
    totalOut += d.outflowMinor;
    if (balance < lowest) { lowest = balance; lowestDate = d.date; }
    if (balance < a.minimumBalanceMinor) shortfall.push(d.date);
  }

  const monthlyObligations = obligations.reduce((s, o) => s + monthlyEquivalent(o), 0);
  return {
    method: "deterministic_v1",
    days: list,
    lowestBalanceMinor: lowest,
    lowestBalanceDate: lowestDate,
    shortfallDays: shortfall,
    totalInflowMinor: totalIn,
    totalOutflowMinor: totalOut,
    requiredMonthlyIncomeMinor: monthlyObligations,
  };
}

/** Income needed per month to cover obligations, a savings target and a buffer. */
export function incomeTarget(args: { monthlyObligationsMinor: number; monthlySavingsMinor: number; bufferPct: number }): number {
  return Math.round((args.monthlyObligationsMinor + args.monthlySavingsMinor) * (1 + args.bufferPct / 100));
}
