import { ProsePage } from "@/components/ui/prose";

export const metadata = { title: "Security" };

export default function SecurityPage() {
  return (
    <ProsePage title="Security & control" intro="How TrustOS protects your data and keeps consequential actions under human control. This page describes what the software does today; it is not a certification.">
      <section><h2>Tenant isolation</h2><ul><li>Every record belongs to a workspace. PostgreSQL row-level security restricts reads and writes to active members of that workspace.</li><li>Server code checks roles (owner, admin, member, viewer) before every write; the database enforces the same rules as a backstop.</li><li>CareerVault records are private to the person who created them, even within a shared workspace.</li></ul></section>
      <section><h2>AI with guardrails</h2><ul><li>The AI never has direct database or system access. It can only propose plans made of explicitly registered tools with validated inputs.</li><li>Each tool declares whether it is read-only, a reversible write, or consequential. Consequential actions require an explicit approval bound to the exact action; any change invalidates the approval.</li><li>Permissions are re-checked when each step runs, not just when the plan is made.</li></ul></section>
      <section><h2>Financial integrity</h2><ul><li>Money is stored in integer minor units with an explicit currency; different currencies are never added together.</li><li>Invoice totals, paid amounts and stock levels are derived by database triggers and cannot be edited directly.</li><li>Provider payments are recorded only after a signed webhook is verified (and, for Paystack, re-confirmed with the provider API). Webhooks are idempotent.</li><li>Non-idempotent financial or messaging steps are never retried automatically.</li></ul></section>
      <section><h2>Records you can trust</h2><ul><li>Audit logs, inventory movements, execution events and job timelines are append-only.</li><li>Uploaded evidence is stored privately with a SHA-256 fingerprint. TrustOS records upload time and labels capture time as the uploader&apos;s statement.</li></ul></section>
      <section><h2>Secrets</h2><ul><li>Provider credentials are server-side environment variables, never sent to the browser or requested in chat.</li><li>Share and invitation links are random tokens stored only as hashes.</li></ul></section>
      <section><h2>Report a vulnerability</h2><p>Please contact the operator of this deployment. Do not include sensitive data in public channels.</p></section>
    </ProsePage>
  );
}
