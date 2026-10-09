import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashObject, sha256 } from "@/lib/domain/hash";

export interface AgreementContent {
  scope: string;
  materials: string | null;
  currency: string;
  price_minor: number;
  deadline: string | null;
  terms: string | null;
}

export function agreementHash(c: AgreementContent): string {
  return hashObject(c);
}

export function tokenHash(token: string): string {
  return sha256(`jobshare:${token}`);
}

/** Resolve a share token to its job (service role). Returns null for unknown tokens. */
export async function jobByToken(admin: SupabaseClient, token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const { data } = await admin.from("service_jobs").select("*").eq("share_token_hash", tokenHash(token)).maybeSingle();
  return data as (Record<string, unknown> & { id: string; organization_id: string; status: string; price_minor: number; currency: string; deadline: string | null; title: string }) | null;
}

/** Apply an approved change request to the job's price/deadline. */
export async function applyChange(db: SupabaseClient, orgId: string, jobId: string, change: { price_delta_minor: number; new_deadline: string | null }) {
  const { data: job, error } = await db.from("service_jobs").select("price_minor, deadline").eq("id", jobId).eq("organization_id", orgId).single();
  if (error) throw error;
  const patch: Record<string, unknown> = { price_minor: Math.max(0, (job as { price_minor: number }).price_minor + change.price_delta_minor) };
  if (change.new_deadline) patch.deadline = change.new_deadline;
  const up = await db.from("service_jobs").update(patch).eq("id", jobId).eq("organization_id", orgId);
  if (up.error) throw up.error;
}

export async function loadJobRecord(db: SupabaseClient, orgId: string, jobId: string, docHref: (documentId: string) => string) {
  const [job, agreements, changes, updates, evidence] = await Promise.all([
    db.from("service_jobs").select("*, customers(name, email, phone)").eq("id", jobId).eq("organization_id", orgId).maybeSingle(),
    db.from("service_agreements").select("*").eq("job_id", jobId).eq("organization_id", orgId).order("version", { ascending: false }),
    db.from("job_change_requests").select("*").eq("job_id", jobId).eq("organization_id", orgId).order("created_at", { ascending: false }),
    db.from("job_updates").select("*").eq("job_id", jobId).eq("organization_id", orgId).order("created_at", { ascending: false }),
    db.from("job_evidence").select("id, phase, caption, claimed_captured_at, created_at, document_id, uploaded_documents(file_name, sha256)").eq("job_id", jobId).eq("organization_id", orgId).order("created_at"),
  ]);
  if (!job.data) return null;
  type Ev = { id: string; phase: string; caption: string | null; claimed_captured_at: string | null; created_at: string; document_id: string; uploaded_documents: { file_name: string; sha256: string | null } | null };
  return {
    job: job.data,
    agreements: agreements.data ?? [],
    changes: changes.data ?? [],
    updates: updates.data ?? [],
    evidence: ((evidence.data ?? []) as unknown as Ev[]).map((e) => ({ id: e.id, phase: e.phase, caption: e.caption, claimed_captured_at: e.claimed_captured_at, created_at: e.created_at, file_name: e.uploaded_documents?.file_name ?? "file", sha256: e.uploaded_documents?.sha256 ?? null, href: docHref(e.document_id) })),
  };
}
