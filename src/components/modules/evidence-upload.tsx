import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input, Select } from "@/components/ui/field";
import { uploadEvidence } from "@/app/app/documents/actions";

export function EvidenceUpload({ entityType, entityId, withPhase = false, withClass = true }: { entityType: string; entityId: string; withPhase?: boolean; withClass?: boolean }) {
  return (
    <ActionForm action={uploadEvidence} resetOnSuccess className="grid gap-2 sm:grid-cols-2">
      <input type="hidden" name="entity_type" value={entityType} />
      <input type="hidden" name="entity_id" value={entityId} />
      <Input type="file" name="file" required accept="image/*,application/pdf,text/plain" className="h-auto py-2 sm:col-span-2" aria-label="File" />
      <Input name="description" placeholder="Describe what this shows" maxLength={500} className="sm:col-span-2" aria-label="Description" />
      {withPhase ? (
        <>
          <Select name="phase" defaultValue="before" aria-label="Phase"><option value="before">Before work</option><option value="during">During work</option><option value="after">After work</option><option value="other">Other</option></Select>
          <Input type="datetime-local" name="claimed_captured_at" aria-label="When was it taken (your statement)" title="When the photo was taken (your statement — the app only knows upload time)" />
        </>
      ) : null}
      {withClass ? (
        <Select name="evidence_class" defaultValue="user_claim" aria-label="Evidence type" className="sm:col-span-2">
          <option value="user_claim">My own record / statement</option>
          <option value="third_party_report">Report or document from a third party</option>
          <option value="verified_evidence">Official / verifiable record (e.g. bank statement)</option>
        </Select>
      ) : null}
      <SubmitButton size="sm" variant="secondary" className="sm:col-span-2">Upload</SubmitButton>
    </ActionForm>
  );
}
