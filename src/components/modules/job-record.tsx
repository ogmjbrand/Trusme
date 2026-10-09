import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, StatusBadge } from "@/components/ui/badge";

export interface JobRecordData {
  job: { title: string; description: string | null; location: string | null; currency: string; price_minor: number; deadline: string | null; status: string; payment_status: string; warranty_terms: string | null; customer_confirmed_at: string | null; customer_confirmed_name: string | null };
  agreements: { id: string; version: number; scope: string; materials: string | null; price_minor: number; currency: string; deadline: string | null; terms: string | null; content_hash: string; provider_accepted_at: string | null; customer_accepted_at: string | null; customer_accepted_name: string | null; created_at: string }[];
  changes: { id: string; description: string; price_delta_minor: number; new_deadline: string | null; status: string; requested_by_party: string; decided_by_name: string | null; decided_at: string | null; created_at: string }[];
  updates: { id: string; kind: string; body: string; amount_minor: number | null; author_party: string; author_name: string | null; created_at: string }[];
  evidence: { id: string; phase: string; caption: string | null; claimed_captured_at: string | null; created_at: string; file_name: string; sha256: string | null; href: string | null }[];
}

/** The shared job record, rendered identically for provider and customer. */
export function JobRecord({ data }: { data: JobRecordData }) {
  const { job, agreements, changes, updates, evidence } = data;
  const latest = agreements[0];
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Agreed scope" description={latest ? `Version ${latest.version} · fingerprint ${latest.content_hash.slice(0, 12)}…` : "No agreement proposed yet"} />
        <CardBody className="space-y-3 text-sm">
          {latest ? (
            <>
              <p className="whitespace-pre-wrap text-fg">{latest.scope}</p>
              {latest.materials ? <p className="text-fg-muted"><b className="text-fg">Materials:</b> {latest.materials}</p> : null}
              {latest.terms ? <p className="whitespace-pre-wrap text-fg-muted"><b className="text-fg">Terms:</b> {latest.terms}</p> : null}
              <div className="flex flex-wrap gap-4 text-xs text-fg-muted">
                <span>Price at agreement: <b className="tabular text-fg">{formatMoney(latest.price_minor, latest.currency)}</b></span>
                <span>Deadline: {fmtDate(latest.deadline)}</span>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge tone={latest.provider_accepted_at ? "brand" : "neutral"}>Provider {latest.provider_accepted_at ? `accepted ${fmtDateTime(latest.provider_accepted_at)}` : "has not accepted"}</Badge>
                <Badge tone={latest.customer_accepted_at ? "brand" : "gold"}>Customer {latest.customer_accepted_at ? `(${latest.customer_accepted_name}) accepted ${fmtDateTime(latest.customer_accepted_at)}` : "has not accepted"}</Badge>
              </div>
            </>
          ) : <p className="text-fg-muted">{job.description ?? "—"}</p>}
          {agreements.length > 1 ? <p className="text-xs text-fg-subtle">{agreements.length - 1} earlier version(s) are kept in the record.</p> : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Change requests" description="Approved changes adjust the current price and deadline." />
        <ul className="divide-y divide-line">
          {changes.map((c) => (
            <li key={c.id} className="px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><StatusBadge status={c.status} /><span className="text-xs text-fg-subtle">requested by {c.requested_by_party} · {fmtDateTime(c.created_at)}</span></div>
              <p className="mt-1">{c.description}</p>
              <p className="text-xs text-fg-muted">{c.price_delta_minor ? `Price ${c.price_delta_minor > 0 ? "+" : "−"}${formatMoney(Math.abs(c.price_delta_minor), job.currency)}` : "No price change"}{c.new_deadline ? ` · new deadline ${fmtDate(c.new_deadline)}` : ""}{c.decided_at ? ` · ${c.status} by ${c.decided_by_name ?? "—"} on ${fmtDateTime(c.decided_at)}` : ""}</p>
            </li>
          ))}
          {!changes.length ? <li className="px-5 py-4 text-sm text-fg-subtle">No change requests.</li> : null}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Evidence" description="Upload time is recorded by TrustOS. Capture time is the uploader's statement, not independent proof." />
        <ul className="divide-y divide-line">
          {evidence.map((e) => (
            <li key={e.id} className="px-5 py-2.5 text-sm">
              <div className="flex flex-wrap items-center gap-2"><Badge>{e.phase}</Badge>{e.href ? <a href={e.href} className="text-brand hover:underline" target="_blank" rel="noreferrer">{e.file_name}</a> : <span>{e.file_name}</span>}</div>
              {e.caption ? <p className="text-xs text-fg-muted">{e.caption}</p> : null}
              <p className="text-[11px] text-fg-subtle">Uploaded {fmtDateTime(e.created_at)}{e.claimed_captured_at ? ` · stated capture time ${fmtDateTime(e.claimed_captured_at)}` : ""}{e.sha256 ? ` · sha256 ${e.sha256.slice(0, 12)}…` : ""}</p>
            </li>
          ))}
          {!evidence.length ? <li className="px-5 py-4 text-sm text-fg-subtle">No evidence uploaded.</li> : null}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Job timeline" description="Entries are append-only and attributed to their author." />
        <ol className="divide-y divide-line">
          {updates.map((u) => (
            <li key={u.id} className="px-5 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs"><Badge tone={u.kind === "dispute_note" ? "danger" : u.author_party === "customer" ? "info" : "neutral"}>{u.kind.replace("_", " ")}</Badge><span className="text-fg-subtle">{u.author_party}: {u.author_name ?? "—"} · {fmtDateTime(u.created_at)}</span></div>
              <p className="mt-1 whitespace-pre-wrap">{u.body}</p>
              {u.amount_minor ? <p className="text-xs text-fg-muted">Amount: {formatMoney(u.amount_minor, job.currency)}</p> : null}
            </li>
          ))}
          {!updates.length ? <li className="px-5 py-4 text-sm text-fg-subtle">No updates yet.</li> : null}
        </ol>
      </Card>
    </div>
  );
}
