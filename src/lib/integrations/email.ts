import "server-only";
import { env } from "@/lib/env";
import { ToolError } from "@/lib/execution/types";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
  idempotencyKey: string;
}

export interface EmailSender {
  readonly provider: string;
  readonly configured: boolean;
  readonly missing: string[];
  send(msg: EmailMessage): Promise<{ provider: string; messageId: string }>;
}

/** Resend adapter. A message is reported as sent only after the API accepts it. */
export function resendSender(): EmailSender {
  const e = env();
  const missing = [!e.RESEND_API_KEY && "RESEND_API_KEY", !e.EMAIL_FROM && "EMAIL_FROM"].filter(Boolean) as string[];
  return {
    provider: "resend",
    configured: missing.length === 0,
    missing,
    async send(msg) {
      if (missing.length) {
        throw new ToolError("Email delivery is not configured, so nothing was sent.", { code: "setup_required", setupRequired: missing });
      }
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${e.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": msg.idempotencyKey,
        },
        body: JSON.stringify({ from: e.EMAIL_FROM, to: [msg.to], subject: msg.subject, text: msg.text, reply_to: msg.replyTo }),
        signal: AbortSignal.timeout(15_000),
      });
      const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
      if (!res.ok || !body.id) {
        throw new ToolError(`Email provider rejected the message: ${body.message ?? res.status}`, {
          code: "provider_error",
          retryable: res.status >= 500 || res.status === 429,
        });
      }
      return { provider: "resend", messageId: body.id };
    },
  };
}
