# Deployment

## 1. Supabase
1. Create a Supabase project (region close to your users; e.g. `eu-west-1` for Nigeria latency is acceptable).
2. Apply migrations in order: `supabase link --project-ref <ref> && supabase db push`, or run each file in `supabase/migrations/` in the SQL editor. Migration 5 creates the private `documents` Storage bucket and its policies when Storage is available.
3. Auth settings: enable email confirmations; set Site URL to your app URL; add `<APP_URL>/auth/confirm` to redirect URLs. Configure custom SMTP for production email delivery.
4. Email templates: point confirmation and recovery links to `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` (or `type=recovery`).

## 2. Environment variables (server)
See `.env.example`. Required: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET` (≥16 chars).
Optional: `AI_PROVIDER`/`AI_MODEL`/`ANTHROPIC_API_KEY` (default model `claude-opus-5-5`), `OPENAI_API_KEY`, `RESEND_API_KEY` + `EMAIL_FROM`, `PAYSTACK_SECRET_KEY`, `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, `GOOGLE_SAFE_BROWSING_API_KEY`.
Never expose the service-role key or provider secrets as `NEXT_PUBLIC_*`.

## 3. Vercel
- Import the repository; framework preset Next.js; build `npm run build`.
- `vercel.json` schedules `/api/cron/executions` every 5 minutes (Vercel sends `Authorization: Bearer $CRON_SECRET`). On plans limited to daily crons, executions still resume via `after()` and the Resume button; reduce the schedule accordingly.

## 4. Webhooks
- Paystack: `https://<app>/api/webhooks/paystack` (HMAC-SHA512 verified, then re-confirmed via the Paystack verify API).
- Stripe: `https://<app>/api/webhooks/stripe` with event `checkout.session.completed` (signature verified with tolerance 300s).
Events are stored once in `webhook_events` (unique per provider/event); payments are unique per provider reference.

## 5. Post-deploy checks
1. Sign up, verify email, land in your personal workspace.
2. Settings → Load labelled sample data; open Overview, Invoices, Inventory, Profitability, Income.
3. Command Center → run the example request; confirm drafts are "prepared", nothing is "sent", and approvals appear when you ask to send.
4. `/app/integrations` reflects exactly which providers are configured.
