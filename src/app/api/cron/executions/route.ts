import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runPending } from "@/lib/execution/server";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Resumes queued/waiting executions and recovers ones whose worker died. */
export async function GET(req: Request) {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (header.length !== expected.length || !timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const result = await runPending(10, 45_000);
  return NextResponse.json(result);
}
