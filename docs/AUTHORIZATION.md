# Authorization

Roles per workspace: **owner (4) > admin (3) > member (2) > viewer (1)**. Code: `src/lib/auth/permissions.ts`. Database: `public.has_org_role()` in RLS policies (`supabase/migrations/*_security.sql`). Server actions call `requirePermission()` before writes; RLS is the backstop. Membership and role are always read from the database, never from the client.

| Resource / action | Viewer | Member | Admin | Owner | Enforced by |
|---|:-:|:-:|:-:|:-:|---|
| Read workspace business records | ✓ | ✓ | ✓ | ✓ | RLS `is_org_member` |
| Create/edit customers, products, invoices, jobs, etc. | | ✓ | ✓ | ✓ | `records.write` + RLS insert/update ≥ member |
| Delete records | | | ✓ | ✓ | RLS delete ≥ admin |
| Record manual payment | | ✓ | ✓ | ✓ | `payments.record` + RLS (`source='manual'`, `recorded_by=self`) |
| Record provider-verified payment | | | | | Webhook (service role) only, after signature verification |
| Reverse payment | | | ✓ | ✓ | `payments.reverse` + RLS update ≥ admin; amounts immutable (trigger) |
| Approve purchase order (commit spend) | | | ✓ | ✓ | `records.delete` + total re-confirmation |
| Stock adjustments | | ✓ | ✓ | ✓ | append-only ledger, `created_by=self` |
| Run Command Center / create executions | | ✓ | ✓ | ✓ | `executions.create` + engine membership check |
| Approve consequential step | | per tool (`approverMinRole`) | | | engine `decideApproval` |
| Execution tables (write) | | | | | Service role only; users have SELECT |
| Invite members | | | ✓ | ✓ | `members.invite` + RLS; admin invites only by owner |
| Change roles / remove members | | | ✓ (members/viewers) | ✓ | `update_member_role` / `remove_member` RPC; last owner protected |
| Read audit log / export | | | ✓ | ✓ | `audit.read` + RLS |
| Workspace settings, sample data | | | ✓ | ✓ | `organization.update` |
| Billing | | | | ✓ | `billing.manage` |
| CareerVault records | own only | own only | own only | own only | RLS `user_id = auth.uid()` |
| Conversations / messages | own only | own only | own only | own only | RLS |
| JobProof customer actions | — | — | — | — | Possession of share token (hash stored), scoped to one job |
| Storage objects | read | upload | delete | delete | Storage policies on `<org_id>/…` paths |

Cross-tenant access is tested in `supabase/tests/01_tenancy_and_integrity.test.sql` (read, insert and update attempts across organizations, viewer write attempts, self-promotion, invitation misuse, private career data).
