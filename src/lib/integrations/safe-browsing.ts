import "server-only";
import { env } from "@/lib/env";
import type { RiskSignal } from "@/lib/domain/risk";

/**
 * Google Safe Browsing v4 Lookup API adapter. Only returns third-party signals
 * when the provider is configured and the call succeeds; otherwise reports
 * that the check was not performed.
 */
export async function safeBrowsingCheck(url: string): Promise<{ performed: boolean; signals: RiskSignal[]; note: string }> {
  const key = env().GOOGLE_SAFE_BROWSING_API_KEY;
  if (!key) return { performed: false, signals: [], note: "Google Safe Browsing is not configured (GOOGLE_SAFE_BROWSING_API_KEY)." };
  try {
    const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client: { clientId: "trustos", clientVersion: "1.0" },
        threatInfo: {
          threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
          platformTypes: ["ANY_PLATFORM"],
          threatEntryTypes: ["URL"],
          threatEntries: [{ url }],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { performed: false, signals: [], note: `Safe Browsing check failed (HTTP ${res.status}).` };
    const body = (await res.json()) as { matches?: { threatType: string }[] };
    const retrievedAt = new Date().toISOString();
    const signals: RiskSignal[] = (body.matches ?? []).map((m) => ({
      code: `gsb_${m.threatType.toLowerCase()}`,
      label: `Listed by Google Safe Browsing: ${m.threatType.replace(/_/g, " ").toLowerCase()}`,
      severity: "high",
      evidenceClass: "third_party_report",
      detail: "Google Safe Browsing reported a match for this URL at the time of checking.",
      sourceName: "Google Safe Browsing",
      sourceUrl: "https://safebrowsing.google.com/",
      retrievedAt,
    }));
    return { performed: true, signals, note: signals.length ? "Third-party match found." : "No Safe Browsing match at the time of checking (not a guarantee of safety)." };
  } catch (err) {
    return { performed: false, signals: [], note: `Safe Browsing check could not be completed: ${(err as Error).message}` };
  }
}
