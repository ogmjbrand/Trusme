"use client";
import { useMemo, useState } from "react";
import { formatMoney } from "@/lib/money";

/**
 * Single-series projected balance (one hue, 2px line) with a dashed neutral
 * reference line for the user's minimum balance. Crosshair + tooltip on hover.
 */
export function BalanceChart({ points, currency, minimum }: { points: { date: string; balance: number }[]; currency: string; minimum: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720, H = 220, P = { l: 8, r: 8, t: 12, b: 24 };
  const { xs, ys, path, minY, maxY } = useMemo(() => {
    const vals = points.map((p) => p.balance).concat(minimum);
    let lo = Math.min(...vals), hi = Math.max(...vals);
    if (lo === hi) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08;
    lo -= pad; hi += pad;
    const xs = points.map((_, i) => P.l + (i / Math.max(points.length - 1, 1)) * (W - P.l - P.r));
    const ys = points.map((p) => P.t + (1 - (p.balance - lo) / (hi - lo)) * (H - P.t - P.b));
    const path = xs.map((x, i) => `${i ? "L" : "M"}${x.toFixed(1)},${ys[i]!.toFixed(1)}`).join(" ");
    return { xs, ys, path, minY: P.t + (1 - (minimum - lo) / (hi - lo)) * (H - P.t - P.b), maxY: hi };
  }, [points, minimum, P.b, P.l, P.r, P.t]);
  void maxY;
  if (!points.length) return null;
  const h = hover !== null ? points[hover] : null;
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-56 w-full" role="img" aria-label={`Projected ${currency} balance over ${points.length} days`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          xs.forEach((v, i) => { if (Math.abs(v - x) < Math.abs(xs[best]! - x)) best = i; });
          setHover(best);
        }}>
        <line x1={P.l} x2={W - P.r} y1={minY} y2={minY} stroke="var(--color-fg-subtle)" strokeDasharray="4 4" strokeWidth="1" />
        <text x={W - P.r} y={minY - 4} textAnchor="end" fontSize="10" fill="var(--color-fg-muted)">minimum balance</text>
        <path d={path} fill="none" stroke="var(--color-brand)" strokeWidth="2" strokeLinejoin="round" />
        {h ? (
          <>
            <line x1={xs[hover!]} x2={xs[hover!]} y1={P.t} y2={H - P.b} stroke="var(--color-line-strong)" strokeWidth="1" />
            <circle cx={xs[hover!]} cy={ys[hover!]} r="4" fill="var(--color-brand)" stroke="var(--color-surface)" strokeWidth="2" />
          </>
        ) : null}
        <text x={P.l} y={H - 6} fontSize="10" fill="var(--color-fg-subtle)">{points[0]!.date}</text>
        <text x={W - P.r} y={H - 6} fontSize="10" textAnchor="end" fill="var(--color-fg-subtle)">{points[points.length - 1]!.date}</text>
      </svg>
      {h ? (
        <div className="pointer-events-none absolute top-1 rounded-md border border-line-strong bg-surface-3 px-2 py-1 text-xs shadow" style={{ left: `min(calc(${(xs[hover!]! / W) * 100}% + 8px), calc(100% - 150px))` }}>
          <div className="text-fg-muted">{h.date}</div>
          <div className="tabular font-medium text-fg">{formatMoney(h.balance, currency)}</div>
        </div>
      ) : null}
    </div>
  );
}
