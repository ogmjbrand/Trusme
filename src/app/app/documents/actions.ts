"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/context";
import { runAction, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { uploadDocument } from "@/lib/services/documents";

const ENTITY_PATHS: Record<string, (id: string) => string> = {
  risk_assessment: (id) => `/app/trust/${id}`,
  service_job: (id) => `/app/jobs/${id}`,
  launch_project: (id) => `/app/launch/${id}`,
  career: () => `/app/career`,
};
const ENTITY_TABLES: Record<string, string> = { risk_assessment: "risk_assessments", service_job: "service_jobs", launch_project: "launch_projects" };

export async function uploadEvidence(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("documents.upload");
    const input = z
      .object({
        entity_type: z.enum(["risk_assessment", "service_job", "launch_project", "career"]),
        entity_id: z.string().uuid(),
        evidence_class: z.enum(["verified_evidence", "user_claim", "third_party_report"]).default("user_claim"),
        description: z.string().max(500).optional(),
        phase: z.enum(["before", "during", "after", "other"]).optional(),
        claimed_captured_at: z.string().optional(),
      })
      .parse({
        entity_type: form.get("entity_type"), entity_id: form.get("entity_id"), evidence_class: form.get("evidence_class") || undefined,
        description: form.get("description") || undefined, phase: form.get("phase") || undefined, claimed_captured_at: form.get("claimed_captured_at") || undefined,
      });
    const table = ENTITY_TABLES[input.entity_type];
    if (table) {
      const { data } = await ws.supabase.from(table).select("id").eq("id", input.entity_id).eq("organization_id", ws.org.organizationId).maybeSingle();
      if (!data) throw new Error("Record not found in this workspace");
    }
    const file = form.get("file");
    const doc = await uploadDocument(ws.supabase, { orgId: ws.org.organizationId, userId: ws.user.id, file: file as File, entityType: input.entity_type, entityId: input.entity_id, evidenceClass: input.evidence_class, description: input.description });
    if (input.entity_type === "service_job") {
      const { error } = await ws.supabase.from("job_evidence").insert({ organization_id: ws.org.organizationId, job_id: input.entity_id, document_id: doc.id, phase: input.phase ?? "other", caption: input.description ?? null, claimed_captured_at: input.claimed_captured_at ? new Date(input.claimed_captured_at).toISOString() : null, created_by: ws.user.id });
      if (error) throw error;
    }
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "document.uploaded", resourceType: input.entity_type, resourceId: input.entity_id, metadata: { document_id: doc.id, sha256: doc.sha256 } });
    revalidatePath(ENTITY_PATHS[input.entity_type]!(input.entity_id));
    return { id: doc.id };
  }, "File uploaded");
}
