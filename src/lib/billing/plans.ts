/**
 * Plan catalogue. Prices are intentionally not hard-coded: they are a business
 * decision to be set when billing launches. Feature lists describe what the
 * software actually does today.
 */
export const PLANS = [
  { id: "free", name: "Free", priceLabel: "Free during early access", features: ["All eight modules", "Command Center with approvals", "Manual payment recording", "Up to 3 team members"] },
  { id: "starter", name: "Starter", priceLabel: "Pricing announced at launch", features: ["Everything in Free", "Email reminders (with consent)", "Payment links and verified webhooks", "Up to 10 team members"] },
  { id: "business", name: "Business", priceLabel: "Pricing announced at launch", features: ["Everything in Starter", "Audit log exports", "Priority support", "Unlimited team members"] },
] as const;
