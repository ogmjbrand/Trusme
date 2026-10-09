import { notFound } from "next/navigation";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney } from "@/lib/money";
import { PageHeader, DefinitionList, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm, InlineAction, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/field";
import { LinkButton } from "@/components/ui/button";
import { fmtDate, fmtDateTime, qty } from "@/lib/format";
import { receivePurchaseOrder, requestPurchaseOrderEmail, setPurchaseOrderStatus } from "../../actions";

export const metadata = { title: "Purchase order" };

export default async function PurchaseOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ws = await getWorkspace();
  const { data: po } = await ws.supabase.from("purchase_orders").select("*, suppliers(name, email, phone, lead_time_days)").eq("id", id).eq("organization_id", ws.org.organizationId).maybeSingle();
  if (!po) notFound();
  const { data: items } = await ws.supabase.from("purchase_order_items").select("id, quantity, received_quantity, unit_cost_minor, products(name, sku)").eq("purchase_order_id", id);
  type Item = { id: string; quantity: number; received_quantity: number; unit_cost_minor: number; products: { name: string; sku: string } | null };
  const lines = (items ?? []) as unknown as Item[];
  const canWrite = can(ws.role, "records.write");
  const canApprove = can(ws.role, "records.delete");
  const receivable = ["approved", "sent", "partially_received"].includes(po.status);
  return (
    <>
      <PageHeader
        eyebrow="StockSense · Purchase order"
        title={<span className="flex items-center gap-2">{po.po_number} <StatusBadge status={po.status} /></span>}
        description={`${po.suppliers?.name ?? "No supplier assigned"} · created ${fmtDateTime(po.created_at)}`}
        actions={<LinkButton href="/app/inventory?tab=orders" variant="ghost" size="sm">All orders</LinkButton>}
      />
      {po.source_execution_id ? <Notice className="mb-4" title="Drafted by TrustOS">This order was drafted from restock recommendations. Review quantities and unit costs with your supplier before approving.</Notice> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Lines" />
          <ActionForm action={receivePurchaseOrder}>
            <input type="hidden" name="id" value={po.id} />
            <Table>
              <THead><TR><TH>Product</TH><TH className="text-right">Ordered</TH><TH className="text-right">Received</TH><TH className="text-right">Unit cost</TH><TH className="text-right">Line total</TH>{receivable && canWrite ? <TH>Receive now</TH> : null}</TR></THead>
              <TBody>
                {lines.map((l) => (
                  <TR key={l.id}>
                    <TD><div>{l.products?.name}</div><div className="font-mono text-[11px] text-fg-subtle">{l.products?.sku}</div></TD>
                    <TD className="tabular text-right">{qty(l.quantity)}</TD>
                    <TD className="tabular text-right">{qty(l.received_quantity)}</TD>
                    <TD className="tabular text-right">{formatMoney(l.unit_cost_minor, po.currency)}</TD>
                    <TD className="tabular text-right">{formatMoney(Math.round(Number(l.quantity) * l.unit_cost_minor), po.currency)}</TD>
                    {receivable && canWrite ? (
                      <TD>
                        <input type="hidden" name="item_id" value={l.id} />
                        <Input name="receive_quantity" inputMode="decimal" aria-label={`Quantity received for ${l.products?.name}`} placeholder={`max ${Number(l.quantity) - Number(l.received_quantity)}`} className="h-8 w-24 text-xs" />
                      </TD>
                    ) : null}
                  </TR>
                ))}
              </TBody>
            </Table>
            {receivable && canWrite ? <CardBody className="border-t border-line"><SubmitButton size="sm">Record goods received</SubmitButton></CardBody> : null}
          </ActionForm>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <CardBody>
              <DefinitionList items={[
                { label: "Total", value: <span className="tabular font-semibold">{formatMoney(po.total_minor, po.currency)}</span> },
                { label: "Expected", value: fmtDate(po.expected_at) },
                { label: "Approved", value: po.approved_at ? fmtDateTime(po.approved_at) : "Not approved" },
                { label: "Supplier contact", value: [po.suppliers?.email, po.suppliers?.phone].filter(Boolean).join(" · ") || "—" },
              ]} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Actions" />
            <CardBody className="space-y-3">
              {po.status === "draft" ? (
                canApprove ? (
                  <ActionForm action={setPurchaseOrderStatus}>
                    <input type="hidden" name="id" value={po.id} />
                    <input type="hidden" name="status" value="approved" />
                    <input type="hidden" name="confirm_total_minor" value={po.total_minor} />
                    <p className="mb-2 text-xs text-fg-muted">Approving commits {formatMoney(po.total_minor, po.currency)} of spend. TrustOS does not place the order with the supplier for you.</p>
                    <SubmitButton size="sm">Approve purchase order</SubmitButton>
                  </ActionForm>
                ) : <p className="text-xs text-fg-muted">An admin must approve this order.</p>
              ) : null}
              {po.status === "approved" && can(ws.role, "executions.create") ? (
                <ActionForm action={requestPurchaseOrderEmail} redirectTo={(d) => `/app/tasks/${d.executionId}`}>
                  <input type="hidden" name="id" value={po.id} />
                  <SubmitButton size="sm" disabled={!po.suppliers?.email}>Email to supplier (needs admin approval)</SubmitButton>
                  {!po.suppliers?.email ? <p className="mt-1 text-xs text-fg-subtle">The supplier has no email address.</p> : null}
                </ActionForm>
              ) : null}
              {po.status === "approved" && canWrite ? <InlineAction action={setPurchaseOrderStatus} fields={{ id: po.id, status: "sent" }} label="I sent it myself" variant="ghost" confirm="Confirm you have sent this order to the supplier yourself." /> : null}
              {po.sent_at ? <p className="text-xs text-fg-muted">Sent {fmtDateTime(po.sent_at)}{po.sent_to ? ` to ${po.sent_to}` : " (recorded manually)"}</p> : null}
              {["draft", "approved", "sent"].includes(po.status) && canWrite ? <InlineAction action={setPurchaseOrderStatus} fields={{ id: po.id, status: "cancelled" }} label="Cancel order" variant="danger" confirm="Cancel this purchase order?" /> : null}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
