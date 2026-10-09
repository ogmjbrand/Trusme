import Decimal from "decimal.js";

/**
 * Decimal-safe money helpers. Amounts are integer minor units (kobo, cents)
 * paired with an ISO-4217 currency code. Arithmetic across currencies throws.
 */
export interface Money {
  amountMinor: number;
  currency: string;
}

const MINOR_EXPONENT: Record<string, number> = { JPY: 0, KRW: 0, XOF: 0, XAF: 0 };
export const SUPPORTED_CURRENCIES = ["NGN", "USD", "GBP", "EUR", "GHS", "KES", "ZAR"] as const;

export function minorExponent(currency: string): number {
  return MINOR_EXPONENT[currency.toUpperCase()] ?? 2;
}

export class CurrencyMismatchError extends Error {
  constructor(a: string, b: string) {
    super(`Cannot combine ${a} and ${b} amounts without an explicit conversion rate`);
    this.name = "CurrencyMismatchError";
  }
}

function assertSafe(n: Decimal): number {
  if (!n.isInteger()) throw new Error("Minor-unit amount must be an integer");
  const v = n.toNumber();
  if (!Number.isSafeInteger(v)) throw new Error("Amount exceeds safe integer range");
  return v;
}

/** Parse a user-entered major amount ("1,250.50") into minor units. */
export function parseMajor(input: string | number, currency: string): number {
  const raw = typeof input === "number" ? String(input) : input.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(raw)) throw new Error(`Invalid amount: ${input}`);
  const d = new Decimal(raw);
  const exp = minorExponent(currency);
  if (d.decimalPlaces() > exp) throw new Error(`${currency} supports at most ${exp} decimal places`);
  return assertSafe(d.mul(new Decimal(10).pow(exp)));
}

export function toMajorString(amountMinor: number, currency: string): string {
  const exp = minorExponent(currency);
  return new Decimal(amountMinor).div(new Decimal(10).pow(exp)).toFixed(exp);
}

export function formatMoney(amountMinor: number, currency: string, locale = "en-NG"): string {
  const exp = minorExponent(currency);
  const major = new Decimal(amountMinor).div(new Decimal(10).pow(exp)).toNumber();
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: exp,
    maximumFractionDigits: exp,
  }).format(major);
}

/** quantity × unit price, rounded half away from zero to whole minor units. */
export function lineTotal(quantity: number | string, unitMinor: number): number {
  return assertSafe(new Decimal(quantity).mul(unitMinor).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
}

export function applyBps(amountMinor: number, bps: number): number {
  return assertSafe(new Decimal(amountMinor).mul(bps).div(10000).toDecimalPlaces(0, Decimal.ROUND_HALF_UP));
}

export function sum(items: Money[], currency?: string): Money {
  const cur = currency ?? items[0]?.currency;
  if (!cur) return { amountMinor: 0, currency: "NGN" };
  let total = new Decimal(0);
  for (const m of items) {
    if (m.currency !== cur) throw new CurrencyMismatchError(cur, m.currency);
    total = total.add(m.amountMinor);
  }
  return { amountMinor: assertSafe(total), currency: cur };
}

/** Group amounts by currency without ever mixing them. */
export function totalsByCurrency(items: Money[]): Money[] {
  const map = new Map<string, Decimal>();
  for (const m of items) map.set(m.currency, (map.get(m.currency) ?? new Decimal(0)).add(m.amountMinor));
  return [...map.entries()].map(([currency, d]) => ({ currency, amountMinor: assertSafe(d) }));
}

/** Ratio as a percentage with fixed precision; null when the denominator is zero. */
export function percent(numerator: number, denominator: number, dp = 1): number | null {
  if (denominator === 0) return null;
  return new Decimal(numerator).div(denominator).mul(100).toDecimalPlaces(dp, Decimal.ROUND_HALF_UP).toNumber();
}

/** Proportional allocation that preserves the exact total (largest remainder). */
export function allocate(totalMinor: number, weights: number[]): number[] {
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => new Decimal(totalMinor).mul(w).div(wsum));
  const floors = raw.map((r) => r.floor());
  let remainder = new Decimal(totalMinor).sub(floors.reduce((a, b) => a.add(b), new Decimal(0))).toNumber();
  const order = raw
    .map((r, i) => ({ i, frac: r.sub(r.floor()).toNumber() }))
    .sort((a, b) => b.frac - a.frac);
  const out = floors.map((f) => f.toNumber());
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    remainder -= 1;
  }
  return out;
}

export interface ConversionRate {
  from: string;
  to: string;
  rate: string; // decimal string, units of `to` per 1 `from`
  asOf: string; // ISO timestamp the rate was observed
  source: string;
}

export function convert(m: Money, rate: ConversionRate): Money & { rate: ConversionRate } {
  if (m.currency !== rate.from) throw new CurrencyMismatchError(m.currency, rate.from);
  const fromExp = minorExponent(rate.from);
  const toExp = minorExponent(rate.to);
  const major = new Decimal(m.amountMinor).div(new Decimal(10).pow(fromExp));
  const converted = major.mul(rate.rate).mul(new Decimal(10).pow(toExp)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return { amountMinor: assertSafe(converted), currency: rate.to, rate };
}
