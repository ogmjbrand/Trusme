import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PaymentProvider, VerifiedPaymentEvent } from "@/lib/integrations/payments/types";

export type WebhookOutcome = { status: number; body: string };

/**
 * Shared, idempotent webhook processing:
 *  1. verify signature (provider adapter) — unsigned/invalid → 401, nothing stored as processed
 *  2. record the event once (unique provider + event_id) — duplicates → 200 no-op
 *  3. for successful payments, re-verify with the provider API when supported
 *  4. insert a provider_verified payment (unique provider + reference)
 * A payment never becomes "paid" because a browser said so.
 */
export async function processPaymentWebhook(getDb: () => SupabaseClient, provider: PaymentProvider, rawBody: string, headers: Headers): Promise<WebhookOutcome> {
  if (!provider.configured) return { status: 503, body: `${provider.id} not configured` };
  const event = await provider.verifyWebhook(rawBody, headers);
  if (!event) return { status: 401, body: "invalid signature" };
  const db = getDb();

  const orgId = event.metadata.organization_id ?? null;
  const ins = await db
    .from("webhook_events")
    .insert({ provider: event.provider, event_id: event.eventId, event_type: event.eventType, payload: JSON.parse(rawBody), signature_valid: true, organization_id: orgId && /^[0-9a-f-]{36}$/.test(orgId) ? orgId : null })
    .select("id")
    .single();
  if (ins.error) {
    if (ins.error.code === "23505") return { status: 200, body: "duplicate event ignored" };
    return { status: 500, body: "could not record event" };
  }
  const eventRowId = (ins.data as { id: string }).id;

  try {
    const note = await applyEvent(db, provider, event);
    await db.from("webhook_events").update({ processed_at: new Date().toISOString(), processing_error: note }).eq("id", eventRowId);
    return { status: 200, body: note ?? "processed" };
  } catch (err) {
    await db.from("webhook_events").update({ processing_error: (err as Error).message }).eq("id", eventRowId);
    // 500 lets the provider retry; the event row makes retries idempotent once processed.
    await db.from("webhook_events").delete().eq("id", eventRowId).is("processed_at", null);
    return { status: 500, body: "processing failed" };
  }
}

async function applyEvent(db: SupabaseClient, provider: PaymentProvider, event: VerifiedPaymentEvent): Promise<string | null> {
  if (event.status !== "succeeded") return `ignored event status ${event.status}`;
  const invoiceId = event.metadata.invoice_id;
  const orgId = event.metadata.organization_id;
  if (!invoiceId || !orgId) return "no TrustOS invoice metadata; ignored";

  let confirmed = event;
  if (provider.verifyTransaction) {
    const v = await provider.verifyTransaction(event.reference);
    if (!v || v.status !== "succeeded") throw new Error("provider API did not confirm the transaction");
    confirmed = { ...event, amountMinor: v.amountMinor, currency: v.currency, paidAt: v.paidAt ?? event.paidAt };
  }

  const { data: inv, error } = await db.from("invoices").select("id, organization_id, customer_id, currency, status").eq("id", invoiceId).eq("organization_id", orgId).maybeSingle();
  if (error) throw error;
  if (!inv) return "invoice not found for organization; ignored";
  if (inv.currency !== confirmed.currency) return `currency mismatch (${confirmed.currency} vs ${inv.currency}); needs manual review`;
  if (!["issued", "partially_paid", "paid"].includes(inv.status)) return `invoice is ${inv.status}; needs manual review`;

  const payment = await db.from("payments").insert({
    organization_id: orgId,
    invoice_id: inv.id,
    customer_id: inv.customer_id,
    amount_minor: confirmed.amountMinor,
    currency: confirmed.currency,
    method: provider.id,
    source: "provider_verified",
    provider: provider.id,
    provider_reference: confirmed.reference,
    status: "succeeded",
    received_at: confirmed.paidAt ?? new Date().toISOString(),
    verified_at: new Date().toISOString(),
    notes: `Verified ${provider.id} payment`,
  }).select("id").single();
  if (payment.error) {
    if (payment.error.code === "23505") return "payment already recorded";
    throw payment.error;
  }
  await db.from("audit_logs").insert({
    organization_id: orgId,
    actor_type: "webhook",
    action: "payment.verified",
    resource_type: "payment",
    resource_id: (payment.data as { id: string }).id,
    metadata: { provider: provider.id, reference: confirmed.reference, amount_minor: confirmed.amountMinor, currency: confirmed.currency, event_id: event.eventId },
  });
  return null;
}
