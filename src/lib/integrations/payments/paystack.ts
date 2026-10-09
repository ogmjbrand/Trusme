import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import type { PaymentProvider, VerifiedPaymentEvent } from "./types";

interface PaystackData {
  id?: number;
  reference?: string;
  status?: string;
  amount?: number;
  currency?: string;
  paid_at?: string | null;
  metadata?: Record<string, unknown> | string | null;
}

function normalize(eventType: string, d: PaystackData, eventId: string): VerifiedPaymentEvent {
  const meta = typeof d.metadata === "object" && d.metadata ? d.metadata : {};
  return {
    provider: "paystack",
    eventId,
    eventType,
    reference: String(d.reference ?? ""),
    status: d.status === "success" ? "succeeded" : d.status === "failed" ? "failed" : "other",
    amountMinor: Number(d.amount ?? 0),
    currency: String(d.currency ?? "NGN").toUpperCase(),
    paidAt: d.paid_at ?? null,
    metadata: Object.fromEntries(Object.entries(meta).map(([k, v]) => [k, String(v)])),
  };
}

export function paystack(): PaymentProvider {
  const secret = env().PAYSTACK_SECRET_KEY;
  return {
    id: "paystack",
    configured: Boolean(secret),
    missing: secret ? [] : ["PAYSTACK_SECRET_KEY"],
    async createCheckout(req) {
      if (!secret) throw new Error("Paystack is not configured");
      const res = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: req.amountMinor,
          currency: req.currency,
          email: req.email,
          reference: req.reference,
          callback_url: req.callbackUrl,
          metadata: req.metadata,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json()) as { status: boolean; message?: string; data?: { authorization_url: string; reference: string } };
      if (!res.ok || !body.status || !body.data) throw new Error(`Paystack: ${body.message ?? res.status}`);
      return { url: body.data.authorization_url, reference: body.data.reference };
    },
    async verifyWebhook(rawBody, headers) {
      if (!secret) return null;
      const signature = headers.get("x-paystack-signature") ?? "";
      const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
      const a = Buffer.from(signature, "hex");
      const b = Buffer.from(expected, "hex");
      if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
      const evt = JSON.parse(rawBody) as { event: string; data: PaystackData };
      return normalize(evt.event, evt.data, `${evt.event}:${evt.data.id ?? evt.data.reference}`);
    },
    async verifyTransaction(reference) {
      if (!secret) return null;
      const res = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as { status: boolean; data?: PaystackData };
      return body.status && body.data ? normalize("transaction.verify", body.data, `verify:${reference}`) : null;
    },
  };
}
