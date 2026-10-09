import { createAdminClient } from "@/lib/supabase/admin";
import { paystack } from "@/lib/integrations/payments/paystack";
import { processPaymentWebhook } from "@/lib/services/payment-webhooks";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const raw = await req.text();
  const r = await processPaymentWebhook(createAdminClient, paystack(), raw, req.headers);
  return new Response(r.body, { status: r.status });
}
