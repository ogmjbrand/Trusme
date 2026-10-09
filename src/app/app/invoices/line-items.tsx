"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

interface Line { key: number; description: string; quantity: string; price: string; tax: string }

export function LineItemsEditor({ currency }: { currency: string }) {
  const [lines, setLines] = useState<Line[]>([{ key: 1, description: "", quantity: "1", price: "", tax: "0" }]);
  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const subtotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.price.replace(/,/g, "")) || 0), 0);
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[1fr_90px_140px_80px_36px] gap-2 text-xs text-fg-subtle sm:grid">
        <span>Description</span><span>Qty</span><span>Unit price ({currency})</span><span>Tax %</span><span />
      </div>
      {lines.map((l, idx) => (
        <div key={l.key} className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_90px_140px_80px_36px]">
          <Input name="item_description" aria-label={`Line ${idx + 1} description`} placeholder="Item or service" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} className="col-span-2 sm:col-span-1" required />
          <Input name="item_quantity" aria-label={`Line ${idx + 1} quantity`} inputMode="decimal" value={l.quantity} onChange={(e) => update(l.key, { quantity: e.target.value })} required />
          <Input name="item_price" aria-label={`Line ${idx + 1} unit price`} inputMode="decimal" placeholder="0.00" value={l.price} onChange={(e) => update(l.key, { price: e.target.value })} required />
          <Input name="item_tax" aria-label={`Line ${idx + 1} tax percent`} inputMode="decimal" value={l.tax} onChange={(e) => update(l.key, { tax: e.target.value })} />
          <Button variant="ghost" aria-label={`Remove line ${idx + 1}`} disabled={lines.length === 1} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="h-10 w-9 p-0">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <Button variant="secondary" size="sm" onClick={() => setLines((ls) => [...ls, { key: Date.now(), description: "", quantity: "1", price: "", tax: "0" }])}>
          <Plus className="h-3.5 w-3.5" /> Add line
        </Button>
        <span className="tabular text-sm text-fg-muted">Estimated subtotal: {currency} {subtotal.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-fg-subtle">(final totals are computed on the server)</span></span>
      </div>
    </div>
  );
}
