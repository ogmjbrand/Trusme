import { ProsePage } from "@/components/ui/prose";

export const metadata = { title: "Help" };

const FAQ: [string, string][] = [
  ["What does the Command Center actually do?", "It turns your request into a plan of registered tools, shows each step's side effects, runs read-only and low-risk steps, and pauses for approval on anything consequential. You can follow progress, retry failed steps, cancel, and download a report."],
  ["Will TrustOS send messages or pay anyone without asking?", "No. Sending reminders, approving purchase orders and similar actions require explicit approval. TrustOS never initiates transfers."],
  ["Why does a reminder say “prepared” but not “sent”?", "Drafts are prepared automatically. A message is only marked sent after your email provider accepts it, which requires email to be configured, the customer's consent, and your approval."],
  ["How do I record a payment?", "Open the invoice and use “Record manual payment”, or create a payment link if Paystack or Stripe is configured. Provider payments appear only after verified confirmation."],
  ["Why is my stock number different from what I expected?", "Stock is the sum of recorded movements. Check the stock ledger in StockSense and record an adjustment if a count differs — movements are never edited."],
  ["Is the scam check a final answer?", "No. BeforeYouPay lists observed warning patterns and their source. It cannot prove fraud or safety; verify through official channels."],
  ["Can TrustOS register my business with CAC or NAFDAC?", "Not directly. LaunchReady helps you prepare, links to official sources and tracks the status you report. You submit on the official portal."],
  ["What is sample data?", "Clearly labelled demonstration records you can load in a new workspace and remove in one step. It is never shown as real data."],
];

export default function HelpPage() {
  return (
    <ProsePage title="Help center" intro="Answers to common questions. Admins can find setup and deployment instructions in the project documentation.">
      {FAQ.map(([q, a]) => <section key={q}><h2>{q}</h2><p>{a}</p></section>)}
    </ProsePage>
  );
}
