import { NextResponse } from "next/server";
import { z } from "zod";
import { getWorkspace } from "@/lib/auth/context";

export const runtime = "nodejs";

/** Short-lived signed URL for a document the caller can read (RLS-checked). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ws = await getWorkspace();
  const { data: doc } = await ws.supabase.from("uploaded_documents").select("bucket, storage_path").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data, error } = await ws.supabase.storage.from(doc.bucket).createSignedUrl(doc.storage_path, 60);
  if (error || !data) return NextResponse.json({ error: "Could not create download link" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
