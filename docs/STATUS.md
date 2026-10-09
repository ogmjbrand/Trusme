# Status — what is verified and what is not

TrustOS is **not yet production-ready**. This page is the honest ledger.

## Verified in this repository
| Area | How |
|---|---|
| All 7 migrations apply cleanly on PostgreSQL 16 | `npm run test:db` |
| Tenant isolation, viewer read-only, role changes, last-owner protection, invitation binding, private CareerVault data | `supabase/tests/01_tenancy_and_integrity.test.sql` |
| Stock derived from movements; immutable ledgers; sale RPC; invoice totals/tax; payment → status; currency mismatch rejected; duplicate payment idempotency; user cannot forge provider-verified payments; reversal reopens balance; audit log immutable | same |
| Sample data load/remove leaves real records intact | `02_sample_data.test.sql` |
| Rate limiter windows and service-role-only access | `03_rate_limits.test.sql` |
| Every rule-planner output validates against the real tool registry; consequential tools resolve targets before approval and are non-idempotent | `tests/unit/registry.test.ts` |
| Execution engine: plan validation, approvals bound to input hash, approver roles, rejection → skipped dependents, backoff retries, no auto-retry of non-idempotent steps, fresh approval on retry, run-time permission re-check, cancellation, idempotent creation, leases, crash recovery | `tests/unit/engine.test.ts` (in-memory store) |
| Money arithmetic, receivables aging, restock rules, margins (no double counting), cash-flow projection, risk heuristics, career/launch builders, rule planner, Stripe signature verification | `tests/unit/*.test.ts` |
| AI fallback: a model plan with an unregistered tool, invalid input or a provider error is replaced by the rule planner and never executed; structured output is constrained to registered tool IDs | `tests/unit/plan-service.test.ts` (mocked provider) |
| Lint, strict typecheck, production build | `npm run lint`, `npm run typecheck`, `npm run build` |
| Public pages render on desktop and mobile without horizontal overflow; security headers; `/app` gated; unsigned webhooks and cron calls rejected | `npm run test:e2e` |

## Not yet verified (needs a configured environment)
- Scheduled daily jobs (reminder drafting cadence, obligation roll-forward and alerts) run inside `/api/cron/executions`; their SQL access paths are untested against a live project.
- Full browser flows against a live Supabase project (auth emails, RLS through PostgREST, Storage uploads/signed URLs, RPCs called from the app). No Supabase project was available for testing; create one and run the post-deploy checks in `docs/DEPLOYMENT.md`.
- `SupabaseExecutionStore` against a live database (the engine logic is tested with the in-memory store; the Supabase adapter is a thin mapping).
- Live LLM planning/narration (Anthropic or OpenAI) — requires API keys. The rule planner path is tested.
- Resend email delivery, Paystack/Stripe checkout creation and live webhooks, Google Safe Browsing — adapters are implemented and report "not configured" until keys are set.

## Known limitations / next work
- No official API integration for CAC, NAFDAC, SON or job boards; these are manual, user-reported workflows by design.
- Invoices created directly in CollectIQ do not move stock; record product sales in StockSense (and invoice them from the sale) so inventory and margins stay correct.
- Regulatory sources are seeded as official homepages with `retrieved_at = null`; no maintained source ingestion yet.
- Rate limiting is application-level (PostgreSQL fixed windows on auth, share-link and command endpoints). Add edge protection (e.g. Vercel Firewall) for volumetric abuse.
- Billing has no self-serve checkout; prices are intentionally unset.
- Supabase TypeScript types are not generated; queries are validated at boundaries with Zod and typed locally.
- The original build brief was truncated at the database table list ("job_applicat…"); tables were completed from the module requirements.
