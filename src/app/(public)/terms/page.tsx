import { ProsePage } from "@/components/ui/prose";

export const metadata = { title: "Terms of Service" };

export default function TermsPage() {
  return (
    <ProsePage title="Terms of Service" updated="9 October 2026" intro="Draft terms for early access. The operator of this deployment should have these reviewed by qualified counsel before general availability.">
      <section><h2>The service</h2><p>TrustOS provides software to plan, record and execute business tasks you authorize. It is a tool, not a professional adviser. Information about regulation, finance, careers or risk is general guidance to be verified.</p></section>
      <section><h2>Your responsibilities</h2><ul><li>Provide accurate information and only upload content you have the right to use.</li><li>Obtain any consent required before TrustOS contacts your customers on your behalf.</li><li>Review and approve consequential actions carefully; you are responsible for actions you approve.</li></ul></section>
      <section><h2>No regulated services</h2><p>TrustOS does not hold funds, initiate transfers, provide credit, give legal advice, adjudicate disputes or submit government applications on your behalf.</p></section>
      <section><h2>Availability</h2><p>Early-access features may change. Integrations depend on third-party providers and may be unavailable.</p></section>
      <section><h2>Limitation of liability</h2><p>To the extent permitted by law, the operator is not liable for indirect losses arising from use of the service. Specific limits will be set out in the final terms.</p></section>
    </ProsePage>
  );
}
