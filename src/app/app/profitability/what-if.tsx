"use client";
import { useMemo, useState } from "react";
import { Field, Input } from "@/components/ui/field";
import { whatIfPrice } from "@/lib/domain/margins";
import { formatMoney, parseMajor, toMajorString } from "@/lib/money";

export function WhatIfCalculator({ products, currency }: { products: { id: string; name: string; price: number; cost: number; currency: string }[]; currency: string }) {
  const [pid, setPid] = useState(products[0]?.id ?? "");
  const p = products.find((x) => x.id === pid);
  const cur = p?.currency ?? currency;
  const [price, setPrice] = useState(p ? toMajorString(p.price, p.currency) : "");
  const [fee, setFee] = useState("1.5");
  const [ship, setShip] = useState("0");
  const [other, setOther] = useState("0");
  const result = useMemo(() => {
    try {
      return whatIfPrice({ unitPriceMinor: parseMajor(price || "0", cur), unitCostMinor: p?.cost ?? 0, feeBps: Math.round(Number(fee || 0) * 100), shippingPerUnitMinor: parseMajor(ship || "0", cur), otherPerUnitMinor: parseMajor(other || "0", cur) });
    } catch {
      return null;
    }
  }, [price, fee, ship, other, p, cur]);
  if (!products.length) return <p className="text-sm text-fg-muted">Add products to model pricing.</p>;
  return (
    <div className="space-y-3">
      <Field label="Product" htmlFor="wf-p">
        <select id="wf-p" value={pid} onChange={(e) => { setPid(e.target.value); const np = products.find((x) => x.id === e.target.value); if (np) setPrice(toMajorString(np.price, np.currency)); }} className="h-10 w-full rounded-lg border border-line-strong bg-surface-2 px-3 text-sm">
          {products.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={`New price (${cur})`} htmlFor="wf-price"><Input id="wf-price" value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Payment fee %" htmlFor="wf-fee"><Input id="wf-fee" value={fee} onChange={(e) => setFee(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Shipping per unit" htmlFor="wf-ship"><Input id="wf-ship" value={ship} onChange={(e) => setShip(e.target.value)} inputMode="decimal" /></Field>
        <Field label="Other direct per unit" htmlFor="wf-other"><Input id="wf-other" value={other} onChange={(e) => setOther(e.target.value)} inputMode="decimal" /></Field>
      </div>
      {result ? (
        <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
          <div className="flex justify-between"><span className="text-fg-muted">Unit cost (current)</span><span className="tabular">{formatMoney(p?.cost ?? 0, cur)}</span></div>
          <div className="flex justify-between"><span className="text-fg-muted">Payment fee</span><span className="tabular">{formatMoney(result.feeMinor, cur)}</span></div>
          <div className="mt-1 flex justify-between border-t border-line pt-1 font-medium"><span>Contribution per unit</span><span className={`tabular ${result.contributionPerUnitMinor < 0 ? "text-danger" : "text-brand"}`}>{formatMoney(result.contributionPerUnitMinor, cur)} ({result.contributionMarginPct ?? "—"}%)</span></div>
          <p className="mt-2 text-xs text-fg-subtle">Scenario only — nothing is changed. Holds unit cost constant.</p>
        </div>
      ) : <p className="text-xs text-danger">Enter valid amounts.</p>}
    </div>
  );
}
