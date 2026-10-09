"use client";
import { useState } from "react";
import { Copy } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { createPaymentLink } from "../actions";

export function PaymentLinkForm({ invoiceId, providers }: { invoiceId: string; providers: string[] }) {
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="space-y-3">
      <ActionForm action={createPaymentLink} onSuccess={(d) => setUrl(d.url)} className="flex gap-2">
        <input type="hidden" name="invoice_id" value={invoiceId} />
        <Select name="provider" aria-label="Payment provider" className="h-8 text-xs">
          {providers.map((p) => <option key={p} value={p}>{p}</option>)}
        </Select>
        <SubmitButton size="sm" variant="secondary">Create link</SubmitButton>
      </ActionForm>
      {url ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
          <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-xs text-brand underline">{url}</a>
          <Button size="sm" variant="ghost" aria-label="Copy link" onClick={() => navigator.clipboard.writeText(url)}><Copy className="h-3.5 w-3.5" /></Button>
        </div>
      ) : null}
    </div>
  );
}
