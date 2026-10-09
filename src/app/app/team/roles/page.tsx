import { Check, Minus } from "lucide-react";
import { PERMISSIONS, ROLES, can, type Permission } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody } from "@/components/ui/card";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";

export const metadata = { title: "Roles" };

const LABELS: Record<Permission, string> = {
  "records.read": "View workspace records",
  "records.write": "Create and edit records (invoices, products, jobs…)",
  "records.delete": "Delete records, approve purchase orders",
  "payments.record": "Record manual payments, create payment links",
  "payments.reverse": "Reverse payments",
  "executions.create": "Run Command Center plans",
  "executions.cancel": "Cancel executions",
  "approvals.decide": "Approve/reject actions (subject to each action's required role)",
  "documents.upload": "Upload documents and evidence",
  "documents.delete": "Delete documents",
  "members.read": "See workspace members",
  "members.invite": "Invite members",
  "members.manage": "Change roles / remove members",
  "roles.grant_admin": "Grant or remove admin/owner",
  "audit.read": "Read the audit log",
  "integrations.manage": "Manage integrations",
  "billing.manage": "Manage billing",
  "organization.update": "Edit workspace settings, sample data",
  "organization.delete": "Delete the workspace",
};

export default function RolesPage() {
  return (
    <>
      <PageHeader title="Roles & permissions" description="This matrix is enforced in server code and mirrored by database row-level security. CareerVault records are always private to their owner, regardless of role." />
      <Card>
        <Table>
          <THead><TR><TH>Permission</TH>{ROLES.map((r) => <TH key={r} className="text-center capitalize">{r}</TH>)}</TR></THead>
          <TBody>
            {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
              <TR key={p}>
                <TD><div>{LABELS[p]}</div><div className="font-mono text-[11px] text-fg-subtle">{p}</div></TD>
                {ROLES.map((r) => <TD key={r} className="text-center">{can(r, p) ? <Check className="mx-auto h-4 w-4 text-brand" aria-label="allowed" /> : <Minus className="mx-auto h-4 w-4 text-fg-subtle" aria-label="not allowed" />}</TD>)}
              </TR>
            ))}
          </TBody>
        </Table>
        <CardBody className="border-t border-line text-xs text-fg-muted">Consequential AI actions additionally require an approval from someone holding the role the action specifies (for example, sending customer emails requires member or higher).</CardBody>
      </Card>
    </>
  );
}
