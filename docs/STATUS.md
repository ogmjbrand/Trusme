# Status — what is verified and what is not

TrustOS is **not yet production-ready**. This page is the honest ledger.

## Verified in this repository
| Area | How |
|---|---|
| All 7 migrations apply cleanly on PostgreSQL 16 | `npm run test:db` |
| Tenant isolation, viewer read-only, role changes, last-owner protection, invitation binding, private CareerVault data | `supabase/tests/01_tenancy_and_integrity.test.sql` |
| Stock derived from movements; immutable ledgers; sale RPC; invoice totals/tax; payment → status; currency mismatch rejected; duplicate payment idempotency; user cannot forge provider-verified payments; reversal reopens balance; audit log immutable | same |
| Sample data load/remove leaves real records intact | `02_sample_data.test.sql` |
| Execution engine: plan validation, approvals bound to input hash, approver roles, rejection → skipped dependents, backoff retries, no auto-retry of non-idempotent steps, fresh approval on retry, run-time permission re-check, cancellation, idempotent creation, leases, crash recovery | `tests/unit/engine.test.ts` (in-memory store) |
| Money arithmetic, receivables aging, restock rules, margins (no double counting), cash-flow projection, risk heuristics, career/launch builders, rule planner, Stripe signature verification | `tests/unit/*.test.ts` |
| Lint, strict typecheck, production build | `npm run lint`, `npm run typecheck`, `npm run build` |
| Public pages render on desktop and mobile without horizontal overflow; security headers; `/app` gated; unsigned webhooks and cron calls rejected | `npm run test:e2e` |

## Not yet verified (needs a configured environment)
- Full browser flows against a live Supabase project (auth emails, RLS through PostgREST, Storage uploads/signed URLs, RPCs called from the app). No Supabase project was available for testing; create one and run the post-deploy checks in `docs/DEPLOYMENT.md`.
- `SupabaseExecutionStore` against a live database (the engine logic is tested with the in-memory store; the Supabase adapter is a thin mapping).
- Live LLM planning/narration (Anthropic or OpenAI) — requires API keys. The rule planner path is tested.
- Resend email delivery, Paystack/Stripe checkout creation and live webhooks, Google Safe Browsing — adapters are implemented and report "not configured" until keys are set.

## Known limitations / next work
- No official API integration for CAC, NAFDAC, SON or job boards; these are manual, user-reported workflows by design.
- Purchase orders are not emailed to suppliers from TrustOS ("Mark as sent" records that you sent it).
- Invoices are not linked to stock movements; record product sales through StockSense to affect inventory and margins.
- Regulatory sources are seeded as official homepages with `retrieved_at = null`; no maintained source ingestion yet.
- Public share-link endpoints have no rate limiting; add edge rate limiting (e.g. Vercel Firewall) before launch.
- Billing has no self-serve checkout; prices are intentionally unset.
- Supabase TypeScript types are not generated; queries are validated at boundaries with Zod and typed locally.
- The original build brief was truncated at the database table list ("job_applicat…"); tables were completed from the module requirements.
