import { createAdminClient } from "@/lib/supabase/admin";
import { stripe } from "@/lib/integrations/payments/stripe";
import { processPaymentWebhook } from "@/lib/services/payment-webhooks";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const raw = await req.text();
  const r = await processPaymentWebhook(createAdminClient(), stripe(), raw, req.headers);
  return new Response(r.body, { status: r.status });
}
