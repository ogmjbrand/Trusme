export function fmtDate(iso: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  if (!iso) return "—";
  const d = iso.length === 10 ? new Date(iso + "T00:00:00Z") : new Date(iso);
  return new Intl.DateTimeFormat("en-NG", { ...opts, timeZone: iso.length === 10 ? "UTC" : undefined }).format(d);
}

export function fmtDateTime(iso: string | null | undefined): string {
  return fmtDate(iso, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(diff, "second");
  if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
  return rtf.format(Math.round(diff / 86400), "day");
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function qty(n: number | string): string {
  const v = Number(n);
  return Number.isInteger(v) ? v.toLocaleString("en-NG") : v.toLocaleString("en-NG", { maximumFractionDigits: 3 });
}

/** Request-time clock for server components. */
export function nowMs(): number {
  return Date.now();
}
