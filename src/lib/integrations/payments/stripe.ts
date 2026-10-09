import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { PaymentProvider } from "./types";

const TOLERANCE_SECONDS = 300;

/** Verify a Stripe-Signature header (t=timestamp,v1=hmac) without the SDK. */
export function verifyStripeSignature(rawBody: string, header: string, secret: string, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  const sigs = header.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3));
  if (!t || !sigs.length || Math.abs(nowSeconds - t) > TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return sigs.some((s) => {
    const a = Buffer.from(s, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

export function stripe(): PaymentProvider {
  const { STRIPE_SECRET_KEY: key, STRIPE_WEBHOOK_SECRET: whsec } = env();
  const missing = [!key && "STRIPE_SECRET_KEY", !whsec && "STRIPE_WEBHOOK_SECRET"].filter(Boolean) as string[];
  return {
    id: "stripe",
    configured: missing.length === 0,
    missing,
    async createCheckout(req) {
      if (!key) throw new Error("Stripe is not configured");
      const form = new URLSearchParams({
        mode: "payment",
        success_url: req.callbackUrl,
        cancel_url: req.callbackUrl,
        customer_email: req.email,
        client_reference_id: req.reference,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": req.currency.toLowerCase(),
        "line_items[0][price_data][unit_amount]": String(req.amountMinor),
        "line_items[0][price_data][product_data][name]": req.metadata.description ?? "Invoice payment",
        "payment_intent_data[metadata][reference]": req.reference,
      });
      for (const [k, v] of Object.entries(req.metadata)) form.set(`metadata[${k}]`, v);
      form.set("metadata[reference]", req.reference);
      const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": req.reference },
        body: form,
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json()) as { url?: string; error?: { message: string } };
      if (!res.ok || !body.url) throw new Error(`Stripe: ${body.error?.message ?? res.status}`);
      return { url: body.url, reference: req.reference };
    },
    async verifyWebhook(rawBody, headers) {
      if (!whsec) return null;
      if (!verifyStripeSignature(rawBody, headers.get("stripe-signature") ?? "", whsec)) return null;
      const evt = JSON.parse(rawBody) as {
        id: string;
        type: string;
        data: { object: { id: string; amount_total?: number; currency?: string; payment_status?: string; metadata?: Record<string, string>; created?: number } };
      };
      const o = evt.data.object;
      return {
        provider: "stripe",
        eventId: evt.id,
        eventType: evt.type,
        reference: o.metadata?.reference ?? o.id,
        status: evt.type === "checkout.session.completed" && o.payment_status === "paid" ? "succeeded" : evt.type.endsWith("failed") ? "failed" : "other",
        amountMinor: Number(o.amount_total ?? 0),
        currency: String(o.currency ?? "").toUpperCase(),
        paidAt: o.created ? new Date(o.created * 1000).toISOString() : null,
        metadata: o.metadata ?? {},
      };
    },
  };
}
