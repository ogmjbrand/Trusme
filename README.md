# TrustOS

AI execution platform and business operating system. Tell TrustOS what you want accomplished; it turns the goal into a typed plan of registered tools, runs safe steps, pauses for human approval on consequential ones, verifies results and keeps an auditable record.

Eight connected modules share one workspace, permission model, execution engine and audit trail:

| Module | Route | What it does |
|---|---|---|
| CollectIQ | `/app/invoices` | Invoices, payments (manual + provider-verified), promises, consent-aware reminders, aging, PDF, payment links |
| StockSense | `/app/inventory` | Ledger-based stock, sales, suppliers, purchase orders, rule-based restock recommendations |
| MarginGuard | `/app/profitability` | Gross/contribution margins per product, cost changes, what-if pricing |
| IncomePilot | `/app/income` | Income, obligations, savings goals, editable-assumption cash-flow projection |
| BeforeYouPay | `/app/trust` | Scam-pattern screening with evidence classes, evidence uploads, report drafting |
| JobProof | `/app/jobs` | Versioned agreements, change requests, evidence, customer share link |
| CareerVault | `/app/career` | Skills, history, credentials, portfolio, applications, tailored drafts |
| LaunchReady | `/app/launch` | Launch checklist with official sources, budget, registrations, label review, experts |

Plus: Command Center (`/app/command`), executions (`/app/tasks`), approval inbox, activity, customers, reports with CSV exports, integrations status, settings, billing, team/roles, audit log.

## Stack
Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict) · Tailwind CSS 4 · Supabase (Postgres, Auth, RLS, Storage) · Anthropic SDK (Claude) with an optional OpenAI provider via the Vercel AI SDK · Zod · Vitest · Playwright.

## Quick start
```bash
npm install
cp .env.example .env.local      # fill in Supabase keys (see docs/DEPLOYMENT.md)
supabase db push                # or apply supabase/migrations/*.sql in order
npm run dev
```
Without Supabase configured, public pages work and `/app` redirects to `/setup`.
Without an AI key, the Command Center uses a deterministic rule-based planner (clearly labelled).

## Verification commands
| Command | What it checks |
|---|---|
| `npm run lint` | ESLint (Next + React hooks rules) |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm test` | Unit tests: money, domain calculations, execution engine, planner, webhook signatures |
| `npm run test:db` | Applies all migrations to a throwaway PostgreSQL and runs tenancy/RLS/integrity tests (needs PostgreSQL server binaries; run as non-root) |
| `npm run build` | Production build |
| `npm run test:e2e` | Playwright smoke tests (desktop + mobile) against `next start` |

## Documentation
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data model, execution engine, AI layer
- [docs/AUTHORIZATION.md](docs/AUTHORIZATION.md) — roles and the authorization matrix
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — environment, migrations, Vercel, webhooks, cron
- [docs/STATUS.md](docs/STATUS.md) — what is verified, what is not, and known limitations
