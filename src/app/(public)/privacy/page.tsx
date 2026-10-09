import { ProsePage } from "@/components/ui/prose";

export const metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  return (
    <ProsePage title="Privacy Policy" updated="9 October 2026" intro="Draft policy for early access, written to reflect what the software does. The operator should have it reviewed for compliance with the Nigeria Data Protection Act and other applicable laws.">
      <section><h2>What we store</h2><ul><li>Account details (name, email, optional phone).</li><li>Workspace records you create: customers, invoices, products, jobs, documents and so on.</li><li>Execution history, approvals and audit logs, to provide an accountable record.</li></ul></section>
      <section><h2>How AI is used</h2><p>When an AI provider is configured, your request and summary counts of your workspace records are sent to that provider to generate a plan. Tools then read the specific records needed, on TrustOS servers. Providers are configured by the operator.</p></section>
      <section><h2>Sharing</h2><p>Records are visible to members of the workspace according to their role. JobProof share links expose a single job record to whoever holds the link until it is revoked. We do not sell personal data.</p></section>
      <section><h2>Your choices</h2><ul><li>Customer contact consent is recorded per channel and checked before any message is sent.</li><li>You can export workspace data as CSV and request deletion from the operator.</li></ul></section>
      <section><h2>Security</h2><p>See the Security page for how data is isolated and protected.</p></section>
    </ProsePage>
  );
}
