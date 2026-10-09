import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { jobByToken } from "@/lib/services/jobproof";

export const runtime = "nodejs";

/** Evidence download for customers holding a valid share link. */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string; docId: string }> }) {
  const { token, docId } = await params;
  if (!z.string().uuid().safeParse(docId).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const admin = createAdminClient();
  const job = await jobByToken(admin, token);
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: ev } = await admin.from("job_evidence").select("uploaded_documents(bucket, storage_path)").eq("job_id", job.id).eq("document_id", docId).maybeSingle();
  const doc = (ev as unknown as { uploaded_documents: { bucket: string; storage_path: string } | null } | null)?.uploaded_documents;
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data } = await admin.storage.from(doc.bucket).createSignedUrl(doc.storage_path, 60);
  if (!data) return NextResponse.json({ error: "Unavailable" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
