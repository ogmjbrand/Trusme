export interface CheckoutRequest {
  amountMinor: number;
  currency: string;
  email: string;
  reference: string;
  callbackUrl: string;
  metadata: Record<string, string>;
}

export interface VerifiedPaymentEvent {
  provider: "paystack" | "stripe";
  eventId: string;
  eventType: string;
  reference: string;
  status: "succeeded" | "failed" | "other";
  amountMinor: number;
  currency: string;
  paidAt: string | null;
  metadata: Record<string, string>;
}

export interface PaymentProvider {
  readonly id: "paystack" | "stripe";
  readonly configured: boolean;
  readonly missing: string[];
  createCheckout(req: CheckoutRequest): Promise<{ url: string; reference: string }>;
  /** Returns the parsed event only if the signature is valid. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedPaymentEvent | null>;
  /** Confirms a transaction directly with the provider's API (authoritative). */
  verifyTransaction?(reference: string): Promise<VerifiedPaymentEvent | null>;
}
