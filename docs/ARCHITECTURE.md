# Architecture

## Layout
```
src/
  app/                 Next.js routes
    (public)/          landing, pricing, security, help, terms, privacy
    (auth)/            login, signup, forgot/reset password (+ server actions)
    app/               authenticated workspace (one folder per module, each with actions.ts)
    api/               command (streaming), executions, reports, PDFs, documents, webhooks, cron
    share/jobs/[token] public JobProof record for customers (token-authorized)
  components/          ui kit, app shell, module components
  lib/
    auth/              workspace context, permission matrix
    supabase/          server (user session), admin (service role), browser clients
    domain/            pure, tested business logic (money-safe): receivables, inventory, margins,
                       cash flow, risk, career, launch, hashing
    execution/         engine, store port, Supabase + in-memory stores, registry, types
    tools/             registered tools (the only actions the AI can request)
    ai/                provider abstraction (Anthropic SDK, OpenAI via Vercel AI SDK), rule planner
    integrations/      email (Resend), payments (Paystack, Stripe), Safe Browsing, status
    services/          shared server services (documents, webhooks, JobProof)
supabase/migrations/   schema, RLS, triggers, transactional functions, sample data
supabase/tests/        SQL tests for tenancy, RLS and integrity (scripts/test-db.sh)
```

## Data model highlights
- Every tenant table carries `organization_id`; a personal workspace (organization `kind = personal`) is created for each user on signup.
- Money: `bigint` minor units + ISO currency. No cross-currency sums anywhere (UI groups by currency; `lib/money.ts` throws on mixing; conversion requires an explicit rate with timestamp).
- Derived values are owned by triggers: `products.stock_on_hand` (from append-only `inventory_movements`), invoice totals (from `invoice_items`), `amount_paid_minor`/status (from succeeded `payments`), JobProof payment status (from its invoice). Guards reject direct edits.
- Transactional RPCs: `record_sale` (sale + lines with cost snapshot + stock movements), `receive_purchase_order` (stock + cost history + PO status), `create_organization`, `accept_invitation`, `update_member_role`, `remove_member`, `next_document_number`, `load_sample_data` / `remove_sample_data`.
- Append-only: `audit_logs`, `execution_events`, `inventory_movements`, `job_updates`.
- Connected flows: payment → invoice status → receivables/aging → cash-flow actuals (payments counted once; `income_entries` are only non-invoice income). Sale → stock → margins. PO receipt → stock + cost history → margins. Completed JobProof job → invoice → payment status; job → portfolio evidence after user confirmation. Launch project ↔ expenses, suppliers, documents.

## Execution engine (`lib/execution`)
- A plan (from an LLM or the rule planner) is only a proposal. `validatePlan` rejects unknown tools and schema-invalid inputs before anything is persisted.
- Executions and steps are rows in PostgreSQL (`executions`, `execution_steps`, `execution_events`, `approval_requests`). Any worker can resume after taking a lease (`lease_owner`, `lease_expires_at`).
- States: draft, pending_approval, queued, running, waiting, completed, partially_completed, failed, cancelled. Steps record tool, validated input, permission check, attempts, timestamps, output, result references, error, verification and an outcome label (`prepared` vs `sent`, etc.).
- Side-effect classes: `read`, `reversible_write` (auto-runs when the user enables it), `consequential` (always needs approval). Approvals store a SHA-256 of tool + exact input; any change supersedes them. Approver role is per tool.
- Late binding (`resolve`) turns scoped inputs like "the reminders drafted above" into concrete recipients **before** approval, so approvers see exactly who will be contacted.
- Retries: bounded exponential backoff only for idempotent tools. Non-idempotent tools are never retried automatically; a step interrupted mid-run is failed with "outcome unknown". Manual retry of consequential steps requires a fresh approval.
- Idempotency: execution keys per request; step keys derive from execution, position and canonical input; tools write with `idempotency_key` unique constraints (reminders, invoices, purchase orders, assessments, documents, launch projects).
- Runtime: `after()` runs the engine once the HTTP response is sent; `/api/cron/executions` (Vercel Cron, `CRON_SECRET`) resumes waiting/queued executions and recovers expired leases; users can press Resume.
- Permissions are re-checked at execution time against current membership.

## AI layer (`lib/ai`)
- `AIProvider` interface: `plan()` returns a structured plan constrained to registered tool IDs; `narrate()` streams an explanation that must not claim completion. Anthropic uses the official SDK with structured outputs (`messages.parse` + Zod) and server-side refusal fallbacks; OpenAI uses the Vercel AI SDK.
- The model receives the tool catalogue (with JSON Schemas), the request and record **counts** — not raw records. Tools fetch data on the server at run time.
- If the model is unavailable or its plan fails validation, the rule planner is used and the fallback is recorded in the plan notes.

## Background & external integrations
Integration adapters report `configured`/`missing` from environment variables; `/app/integrations` displays this honestly. Email sending, payment links and Safe Browsing all degrade to explicit "setup required" states.
