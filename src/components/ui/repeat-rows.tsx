"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input, Select } from "./field";
import { Button } from "./button";

export interface RowColumn {
  name: string;
  label: string;
  type?: "text" | "select";
  options?: { value: string; label: string }[];
  placeholder?: string;
  width?: string;
  required?: boolean;
}

/** Repeating input rows posted as same-named fields (read with FormData.getAll). */
export function RepeatRows({ columns, addLabel = "Add row", initialRows = 1 }: { columns: RowColumn[]; addLabel?: string; initialRows?: number }) {
  const [rows, setRows] = useState(() => Array.from({ length: initialRows }, (_, i) => i));
  const template = columns.map((c) => c.width ?? "1fr").join(" ") + " 36px";
  return (
    <div className="space-y-2">
      <div className="hidden gap-2 text-xs text-fg-subtle sm:grid" style={{ gridTemplateColumns: template }}>
        {columns.map((c) => <span key={c.name}>{c.label}</span>)}
        <span />
      </div>
      {rows.map((r, idx) => (
        <div key={r} className="grid grid-cols-1 gap-2 sm:[grid-template-columns:var(--cols)]" style={{ ["--cols" as string]: template }}>
          {columns.map((c) =>
            c.type === "select" ? (
              <Select key={c.name} name={c.name} aria-label={`${c.label} ${idx + 1}`} defaultValue="" required={c.required}>
                <option value="">{c.placeholder ?? "Select…"}</option>
                {c.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : (
              <Input key={c.name} name={c.name} aria-label={`${c.label} ${idx + 1}`} placeholder={c.placeholder} inputMode="decimal" required={c.required} />
            ),
          )}
          <Button variant="ghost" aria-label={`Remove row ${idx + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((x) => x !== r))} className="h-10 w-9 p-0">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, Date.now()])}>
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  );
}
