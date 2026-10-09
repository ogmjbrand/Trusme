import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf", "text/plain"];

export type EvidenceClass = "verified_evidence" | "user_claim" | "third_party_report" | "ai_hypothesis";

/**
 * Upload a file to the private 'documents' bucket under <org>/<uuid>/<name>
 * using the caller's session (Storage RLS enforces org membership), then
 * record metadata including a SHA-256 of the exact bytes.
 */
export async function uploadDocument(
  db: SupabaseClient,
  args: { orgId: string; userId: string; file: File; entityType: string; entityId: string; evidenceClass?: EvidenceClass; description?: string },
): Promise<{ id: string; sha256: string }> {
  const { file } = args;
  if (!(file instanceof File) || file.size === 0) throw new Error("Choose a file to upload");
  if (file.size > MAX_UPLOAD_BYTES) throw new Error("Files must be 10 MB or smaller");
  if (!ALLOWED_MIME.includes(file.type)) throw new Error("Only images, PDFs and plain-text files are accepted");
  const bytes = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100) || "file";
  const path = `${args.orgId}/${randomUUID()}/${safeName}`;
  const up = await db.storage.from("documents").upload(path, bytes, { contentType: file.type, upsert: false });
  if (up.error) throw new Error(`Upload failed: ${up.error.message}`);
  const { data, error } = await db
    .from("uploaded_documents")
    .insert({
      organization_id: args.orgId,
      uploaded_by: args.userId,
      storage_path: path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type,
      size_bytes: file.size,
      sha256,
      entity_type: args.entityType,
      entity_id: args.entityId,
      evidence_class: args.evidenceClass ?? "user_claim",
      description: args.description ?? null,
    })
    .select("id")
    .single();
  if (error) {
    await db.storage.from("documents").remove([path]);
    throw error;
  }
  return { id: (data as { id: string }).id, sha256 };
}
