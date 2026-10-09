/**
 * LaunchReady planning. Classification is keyword-based and must be confirmed
 * by the user. Regulatory tasks point to official authority sources and are
 * always marked `needsVerification` — TrustOS does not assert requirements it
 * has not retrieved from a maintained source.
 */
export type ProductCategory = "food_beverage" | "cosmetics" | "drugs_health" | "electrical" | "chemicals" | "services" | "general_goods";

const RULES: { category: ProductCategory; re: RegExp }[] = [
  { category: "drugs_health", re: /\b(drug|medicine|herbal|supplement|pharma|clinic|medical device|vitamin)s?\b/i },
  { category: "food_beverage", re: /\b(food|snack|drink|beverage|juice|water|bakery|bread|spice|sauce|chin ?chin|plantain chips|yoghurt|catering|zobo|kunu)\b/i },
  { category: "cosmetics", re: /\b(cosmetic|cream|lotion|soap|shea|hair|skincare|perfume|makeup|body butter)s?\b/i },
  { category: "chemicals", re: /\b(detergent|disinfectant|bleach|insecticide|chemical|sanitizer|sanitiser)s?\b/i },
  { category: "electrical", re: /\b(electrical|electronics?|cable|solar|battery|inverter|charger|appliance)s?\b/i },
  { category: "services", re: /\b(service|consulting|agency|repair|cleaning|tutoring|logistics|software|app|design)s?\b/i },
];

export function classifyIdea(idea: string): { category: ProductCategory; confidence: "keyword_match" | "default"; matched?: string } {
  for (const r of RULES) {
    const m = idea.match(r.re);
    if (m) return { category: r.category, confidence: "keyword_match", matched: m[0] };
  }
  return { category: "general_goods", confidence: "default" };
}

export interface PlannedTask {
  title: string;
  description: string;
  category: "registration" | "compliance" | "product" | "labeling" | "suppliers" | "marketing" | "finance" | "operations";
  authority?: "CAC" | "NAFDAC" | "SON" | "FIRS";
  needsVerification: boolean;
  requiresExpert: boolean;
  offsetDays: number;
}

export function launchPlan(category: ProductCategory): PlannedTask[] {
  const t: PlannedTask[] = [
    { title: "Decide on business structure", description: "Choose between a business name and a limited company. Confirm current options and fees on the CAC portal.", category: "registration", authority: "CAC", needsVerification: true, requiresExpert: false, offsetDays: 3 },
    { title: "Prepare business registration documents", description: "Gather the information the CAC portal asks for (names, addresses, IDs). TrustOS stores drafts; you submit on the official portal.", category: "registration", authority: "CAC", needsVerification: true, requiresExpert: false, offsetDays: 10 },
    { title: "Confirm tax registration obligations", description: "Check current registration requirements on the FIRS site once your business is registered.", category: "compliance", authority: "FIRS", needsVerification: true, requiresExpert: false, offsetDays: 21 },
    { title: "Shortlist suppliers and request quotes", description: "Record at least two suppliers with lead times and unit costs in StockSense.", category: "suppliers", needsVerification: false, requiresExpert: false, offsetDays: 14 },
    { title: "Build launch budget", description: "List one-off and monthly costs. Approved spend is tracked as expenses.", category: "finance", needsVerification: false, requiresExpert: false, offsetDays: 7 },
    { title: "Set pricing using MarginGuard", description: "Model unit cost, fees and shipping to choose a price with a positive contribution margin.", category: "finance", needsVerification: false, requiresExpert: false, offsetDays: 18 },
    { title: "Prepare launch marketing checklist", description: "Channels, launch offer, and customer contact consent.", category: "marketing", needsVerification: false, requiresExpert: false, offsetDays: 28 },
  ];
  if (category === "food_beverage" || category === "cosmetics" || category === "drugs_health" || category === "chemicals") {
    t.push(
      { title: "Check whether the product needs NAFDAC registration", description: "Products in this category are commonly regulated by NAFDAC. Confirm the applicable product class and process on the official NAFDAC site.", category: "compliance", authority: "NAFDAC", needsVerification: true, requiresExpert: true, offsetDays: 14 },
      { title: "Review product label against official guidance", description: "Use the label review workflow; record which official guideline (with URL and date) each checklist item comes from.", category: "labeling", authority: "NAFDAC", needsVerification: true, requiresExpert: true, offsetDays: 25 },
      { title: "Plan production premises inspection readiness", description: "Confirm with the regulator whether premises inspection applies to your product before committing to a facility.", category: "compliance", authority: "NAFDAC", needsVerification: true, requiresExpert: true, offsetDays: 30 },
    );
  }
  if (category === "electrical" || category === "general_goods" || category === "chemicals") {
    t.push({ title: "Check applicable product standards", description: "Confirm on the SON site whether your product falls under a mandatory standard or conformity programme.", category: "compliance", authority: "SON", needsVerification: true, requiresExpert: false, offsetDays: 20 });
  }
  return t;
}

export const LABEL_CHECKLIST_PROMPTS = [
  "Product name as registered/intended",
  "Manufacturer name and address",
  "Net quantity with units",
  "Ingredients / composition list",
  "Manufacturing and expiry dates / batch number",
  "Storage and usage instructions",
  "Registration number placeholder (only once issued)",
];
