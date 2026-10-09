/** CareerVault helpers. Documents are assembled only from the user's own records. */
export interface CareerData {
  fullName: string;
  email?: string | null;
  headline?: string | null;
  summary?: string | null;
  location?: string | null;
  skills: { name: string; level: string; years?: number | null }[];
  employment: { employer: string; title: string; start_date: string | null; end_date: string | null; description: string | null }[];
  credentials: { name: string; issuer: string | null; issued_on: string | null; verification_status: string }[];
  projects: { title: string; description: string | null; outcomes: string | null; url: string | null; confirmed_accurate: boolean }[];
}

const STOP = new Set("a an and are as at be by for from has have in is it of on or our the to we will with you your this that their they who can able years year experience work team role skills strong excellent good using including such about into across within".split(" "));

export function extractKeywords(text: string, max = 40): string[] {
  const counts = new Map<string, number>();
  const tokens = text.toLowerCase().match(/[a-z][a-z0-9+#.\-]{1,30}/g) ?? [];
  for (const raw of tokens) {
    const t = raw.replace(/[.\-]+$/, "");
    if (t.length < 2 || STOP.has(t)) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([k]) => k);
}

export function skillsGap(jobDescription: string, skills: { name: string }[]) {
  const keywords = extractKeywords(jobDescription);
  const have = skills.map((s) => s.name.toLowerCase());
  const matched: string[] = [];
  const missing: string[] = [];
  for (const k of keywords) {
    if (have.some((h) => h === k || h.includes(k) || k.includes(h))) matched.push(k);
    else missing.push(k);
  }
  const coverage = keywords.length ? Math.round((matched.length / keywords.length) * 100) : 0;
  return { keywords, matched, missing: missing.slice(0, 20), coveragePct: coverage, method: "keyword_overlap_v1" as const };
}

function period(start: string | null, end: string | null) {
  const f = (d: string | null) => (d ? d.slice(0, 7) : "");
  return `${f(start) || "?"} – ${end ? f(end) : "present"}`;
}

/** Plain-text CV built strictly from stored records; unconfirmed projects are excluded. */
export function buildCv(d: CareerData, focusKeywords: string[] = []): string {
  const skills = [...d.skills].sort((a, b) => {
    const fa = focusKeywords.some((k) => a.name.toLowerCase().includes(k)) ? 0 : 1;
    const fb = focusKeywords.some((k) => b.name.toLowerCase().includes(k)) ? 0 : 1;
    return fa - fb;
  });
  const out: string[] = [d.fullName.toUpperCase()];
  const contact = [d.email, d.location].filter(Boolean).join(" · ");
  if (contact) out.push(contact);
  if (d.headline) out.push("", d.headline);
  if (d.summary) out.push("", "SUMMARY", d.summary);
  if (skills.length) out.push("", "SKILLS", skills.map((s) => `${s.name} (${s.level}${s.years ? `, ${s.years} yrs` : ""})`).join(" · "));
  if (d.employment.length) {
    out.push("", "EXPERIENCE");
    for (const e of d.employment) {
      out.push(`${e.title} — ${e.employer} (${period(e.start_date, e.end_date)})`);
      if (e.description) out.push(e.description);
    }
  }
  const confirmed = d.projects.filter((p) => p.confirmed_accurate);
  if (confirmed.length) {
    out.push("", "PROJECTS");
    for (const p of confirmed) {
      out.push(`${p.title}${p.url ? ` — ${p.url}` : ""}`);
      if (p.description) out.push(p.description);
      if (p.outcomes) out.push(`Outcomes: ${p.outcomes}`);
    }
  }
  if (d.credentials.length) {
    out.push("", "CERTIFICATIONS");
    for (const c of d.credentials) {
      const flag = c.verification_status === "self_reported" ? " (self-reported)" : "";
      out.push(`${c.name}${c.issuer ? `, ${c.issuer}` : ""}${c.issued_on ? ` (${c.issued_on.slice(0, 4)})` : ""}${flag}`);
    }
  }
  return out.join("\n");
}

export function buildCoverLetter(d: CareerData, app: { company: string; role_title: string }, matched: string[]): string {
  const recent = d.employment[0];
  const strengths = matched.slice(0, 5);
  return [
    `Dear Hiring Team at ${app.company},`,
    "",
    `I am applying for the ${app.role_title} position.${recent ? ` Most recently I worked as ${recent.title} at ${recent.employer}.` : ""}`,
    strengths.length ? `My background aligns with several of the role's requirements, including ${strengths.join(", ")}.` : "",
    d.summary ? d.summary : "",
    "",
    "I would welcome the opportunity to discuss how I can contribute. Thank you for your consideration.",
    "",
    "Sincerely,",
    d.fullName,
    "",
    "[Review before sending: this draft uses only details from your CareerVault records. Add specific examples you can stand behind.]",
  ].filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}

export function interviewQuestions(app: { role_title: string }, missing: string[]): string[] {
  const base = [
    `Walk me through your experience most relevant to the ${app.role_title} role.`,
    "Describe a difficult problem you solved. What was your approach and the measurable outcome?",
    "Tell me about a time you disagreed with a colleague and how you resolved it.",
    "Why are you interested in this company and role?",
  ];
  return [...base, ...missing.slice(0, 4).map((m) => `How would you approach work involving “${m}”? (Gap area — prepare an honest answer.)`)];
}
