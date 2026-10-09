"use client";
import { useState } from "react";
import { Copy } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { inviteMember } from "../actions";

export function InviteForm({ canInviteAdmin }: { canInviteAdmin: boolean }) {
  const [result, setResult] = useState<{ url: string; emailed: boolean } | null>(null);
  return (
    <div className="space-y-3">
      <ActionForm action={inviteMember} resetOnSuccess onSuccess={setResult} className="space-y-3">
        <Field label="Email" htmlFor="ie"><Input id="ie" name="email" type="email" required /></Field>
        <Field label="Role" htmlFor="ir">
          <Select id="ir" name="role" defaultValue="member">
            {canInviteAdmin ? <option value="admin">Admin</option> : null}
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </Select>
        </Field>
        <SubmitButton>Create invitation</SubmitButton>
      </ActionForm>
      {result ? (
        <div className="space-y-1 rounded-lg border border-line bg-surface-2 p-3 text-xs">
          <p className="text-fg-muted">{result.emailed ? "Invitation emailed. You can also share this link (shown once):" : "Email is not configured — share this link with the invitee yourself (shown once):"}</p>
          <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-mono text-brand">{result.url}</span><Button size="sm" variant="ghost" aria-label="Copy" onClick={() => navigator.clipboard.writeText(result.url)}><Copy className="h-3.5 w-3.5" /></Button></div>
        </div>
      ) : null}
    </div>
  );
}
