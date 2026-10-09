"use client";
import { useState } from "react";
import { Copy } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Button } from "@/components/ui/button";
import { createShareLink, revokeShareLink } from "../actions";

export function ShareLink({ jobId, active }: { jobId: string; active: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <p className="text-xs text-fg-muted">{active ? "A customer link is active. Links are shown only once; create a new one to replace it." : "No customer link yet."}</p>
      <div className="flex gap-2">
        <ActionForm action={createShareLink} onSuccess={(d) => setUrl(d.url)}>
          <input type="hidden" name="job_id" value={jobId} />
          <SubmitButton size="sm" variant="secondary">{active ? "Replace link" : "Create customer link"}</SubmitButton>
        </ActionForm>
        {active ? (
          <ActionForm action={revokeShareLink} onSuccess={() => setUrl(null)}>
            <input type="hidden" name="job_id" value={jobId} />
            <SubmitButton size="sm" variant="ghost">Revoke</SubmitButton>
          </ActionForm>
        ) : null}
      </div>
      {url ? (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-brand">{url}</span>
          <Button size="sm" variant="ghost" aria-label="Copy link" onClick={() => navigator.clipboard.writeText(url)}><Copy className="h-3.5 w-3.5" /></Button>
        </div>
      ) : null}
    </div>
  );
}
