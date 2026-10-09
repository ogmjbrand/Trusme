/**
 * BeforeYouPay heuristic screening. These are observable patterns commonly
 * associated with payment scams — NOT a determination that anyone is
 * fraudulent. Every signal is labelled 'heuristic_observation' and the result
 * states its uncertainty explicitly.
 */
export type Severity = "info" | "low" | "medium" | "high";
export type EvidenceClass = "verified_evidence" | "user_claim" | "third_party_report" | "ai_hypothesis" | "heuristic_observation";

export interface RiskSignal {
  code: string;
  label: string;
  severity: Severity;
  evidenceClass: EvidenceClass;
  detail: string;
  sourceName?: string;
  sourceUrl?: string;
  retrievedAt?: string;
}

export interface RiskInput {
  text?: string | null;
  url?: string | null;
  amountMinor?: number | null;
  counterpartyName?: string | null;
  paymentMethodRequested?: string | null;
  accountName?: string | null;
}

export interface RiskResult {
  level: "low" | "elevated" | "high" | "unknown";
  score: number;
  signals: RiskSignal[];
  summary: string;
  method: "heuristic_v1";
  limitations: string[];
}

const PATTERNS: { code: string; label: string; severity: Severity; re: RegExp; detail: string }[] = [
  { code: "urgency", label: "Pressure or urgency language", severity: "medium", re: /\b(urgent(ly)?|right now|immediately|today only|within (an|1|one) hour|last chance|limited slots?|act fast|before it'?s gone)\b/i, detail: "Requests that push you to pay quickly reduce the time available to verify." },
  { code: "advance_payment", label: "Payment requested before delivery or inspection", severity: "medium", re: /\b(pay (first|upfront|before)|advance (payment|fee)|deposit (first|now)|send (the )?money first|commitment fee|processing fee|clearance fee)\b/i, detail: "Advance-fee requests are a common feature of non-delivery scams." },
  { code: "credential_request", label: "Request for PIN, OTP, BVN, password or card details", severity: "high", re: /\b(otp|one[- ]time (password|pin)|\bpin\b|bvn|cvv|card number|password|token code)\b/i, detail: "Legitimate sellers and banks do not need your OTP, PIN or password to receive a payment." },
  { code: "too_good", label: "Unusually large discount or guaranteed returns", severity: "medium", re: /\b(\d{2,3}% off|guaranteed (profit|returns?)|double your|risk[- ]free|investment returns?|earn \S+ daily|giveaway|you (have )?won)\b/i, detail: "Offers far below market price or with guaranteed returns warrant independent verification." },
  { code: "off_platform", label: "Moving the conversation or payment off-platform", severity: "low", re: /\b(whatsapp me|dm me|telegram|chat me on|contact me directly|outside (the )?(app|platform))\b/i, detail: "Moving off a marketplace usually removes buyer protection." },
  { code: "gift_card_crypto", label: "Payment via gift cards, crypto or untraceable methods", severity: "high", re: /\b(gift ?cards?|itunes card|steam card|usdt|bitcoin|btc|crypto( ?currency)?|western union|moneygram)\b/i, detail: "These methods are difficult to reverse or trace." },
  { code: "impersonation", label: "Claims to represent a bank, agency or well-known brand", severity: "medium", re: /\b(efcc|cbn|central bank|customs|nafdac|firs|bank (official|staff)|account (officer|manager)|customer care|support team)\b/i, detail: "Verify any claimed affiliation through the organisation's official channels, not contact details provided in the message." },
];

const BRANDS = ["paystack", "flutterwave", "opay", "palmpay", "moniepoint", "gtbank", "accessbank", "zenithbank", "firstbank", "uba", "jumia", "konga", "paypal", "amazon", "apple", "microsoft"];

function hostOf(url: string): string | null {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function urlSignals(url: string): RiskSignal[] {
  const out: RiskSignal[] = [];
  const host = hostOf(url);
  if (!host) {
    return [{ code: "url_unparseable", label: "Link could not be parsed", severity: "low", evidenceClass: "heuristic_observation", detail: "The link is malformed; do not open it until you can confirm where it leads." }];
  }
  if (url.startsWith("http://")) out.push({ code: "url_no_tls", label: "Link does not use HTTPS", severity: "low", evidenceClass: "heuristic_observation", detail: "Data sent to this page is not encrypted in transit." });
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) out.push({ code: "url_ip_host", label: "Link points to a raw IP address", severity: "medium", evidenceClass: "heuristic_observation", detail: "Legitimate businesses rarely use bare IP addresses for payment pages." });
  if (host.includes("xn--")) out.push({ code: "url_punycode", label: "Internationalised (punycode) domain", severity: "medium", evidenceClass: "heuristic_observation", detail: "Punycode can be used to imitate familiar domain names with look-alike characters." });
  const labels = host.split(".");
  const registrable = labels.slice(-2).join(".");
  for (const b of BRANDS) {
    if (host.includes(b) && !registrable.startsWith(b + ".") && registrable !== `${b}.com.ng`) {
      out.push({ code: "url_brand_lookalike", label: `Domain mentions "${b}" but is not that brand's domain`, severity: "high", evidenceClass: "heuristic_observation", detail: `The registrable domain is ${registrable}. Verify the official ${b} domain independently.` });
      break;
    }
  }
  if (labels.length > 4) out.push({ code: "url_deep_subdomain", label: "Unusually deep subdomain", severity: "low", evidenceClass: "heuristic_observation", detail: `Host ${host} has many subdomain levels, sometimes used to disguise the real domain.` });
  if (/(bit\.ly|tinyurl\.com|t\.co|is\.gd|cutt\.ly|rb\.gy)$/.test(host)) out.push({ code: "url_shortener", label: "Shortened link hides the destination", severity: "low", evidenceClass: "heuristic_observation", detail: "Expand the link with a preview service before opening." });
  return out;
}

export function assessRisk(input: RiskInput): RiskResult {
  const signals: RiskSignal[] = [];
  const text = [input.text, input.paymentMethodRequested].filter(Boolean).join("\n");
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) signals.push({ code: p.code, label: p.label, severity: p.severity, evidenceClass: "heuristic_observation", detail: `${p.detail} Matched: “${m[0]}”.` });
  }
  if (input.url) signals.push(...urlSignals(input.url));
  if (input.counterpartyName && input.accountName) {
    const a = input.counterpartyName.toLowerCase().replace(/[^a-z]/g, "");
    const b = input.accountName.toLowerCase().replace(/[^a-z]/g, "");
    if (a && b && !a.includes(b) && !b.includes(a)) {
      signals.push({ code: "name_mismatch", label: "Account name differs from the seller/business name", severity: "medium", evidenceClass: "user_claim", detail: `You entered seller “${input.counterpartyName}” and account name “${input.accountName}”. Ask why payment goes to a different name.` });
    }
  }
  if (input.paymentMethodRequested && /personal|individual|friend|relative/i.test(input.paymentMethodRequested)) {
    signals.push({ code: "personal_account", label: "Business payment to a personal account", severity: "low", evidenceClass: "user_claim", detail: "Not unusual for small businesses, but reduces recourse if something goes wrong." });
  }

  const weights: Record<Severity, number> = { info: 0, low: 8, medium: 18, high: 35 };
  const score = Math.min(100, signals.reduce((s, x) => s + weights[x.severity], 0));
  const hasInput = Boolean(input.text || input.url);
  const level: RiskResult["level"] = !hasInput ? "unknown" : score >= 50 || signals.some((s) => s.severity === "high") ? "high" : score >= 18 ? "elevated" : "low";

  const summary =
    level === "unknown" ? "Not enough information was provided to screen this transaction."
    : level === "low" ? "No common warning patterns were detected. This does not confirm the counterparty is legitimate — verify identity and delivery terms before paying."
    : level === "elevated" ? "Some patterns often seen in payment scams were detected. Verify independently before paying."
    : "Several strong warning patterns were detected. Do not pay until you have independently verified the counterparty through official channels.";

  return {
    level,
    score,
    signals,
    summary,
    method: "heuristic_v1",
    limitations: [
      "Pattern matching only: it cannot confirm identity, intent or wrongdoing.",
      "No external reputation or URL-scanning service was consulted unless listed as a third-party signal.",
      "Absence of warning signs is not evidence that a transaction is safe.",
    ],
  };
}

export function draftScamReport(args: { title: string; counterparty?: string | null; amount?: string | null; narrative: string; signals: RiskSignal[] }): string {
  const lines = [
    `Report: ${args.title}`,
    "",
    "Prepared by the reporting party using TrustOS. This report records the reporter's own account and observations;",
    "it does not establish that any person committed an offence.",
    "",
    `Counterparty (as provided by reporter): ${args.counterparty ?? "not provided"}`,
    `Amount involved: ${args.amount ?? "not provided"}`,
    "",
    "Reporter's account:",
    args.narrative,
    "",
    "Observed warning patterns (automated heuristic screening — unverified):",
    ...args.signals.map((s) => `- ${s.label} [${s.evidenceClass.replace(/_/g, " ")}]`),
    "",
    "Attached evidence should be listed and described by the reporter before submission.",
  ];
  return lines.join("\n");
}
