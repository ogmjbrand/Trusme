import Link from "next/link";
import { Boxes, Sparkles, Truck } from "lucide-react";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { formatMoney, SUPPORTED_CURRENCIES, toMajorString, totalsByCurrency } from "@/lib/money";
import { recommendRestock, type ProductStock } from "@/lib/domain/inventory";
import { PageHeader, EmptyState, Notice } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge, SampleBadge, StatusBadge } from "@/components/ui/badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select } from "@/components/ui/field";
import { RepeatRows } from "@/components/ui/repeat-rows";
import { fmtDate, fmtDateTime, qty } from "@/lib/format";
import { cn } from "@/lib/cn";
import { createPurchaseOrder, invoiceFromSale, recordMovement, recordSale, requestRestockPlan, saveProduct, saveSupplier } from "./actions";

export const metadata = { title: "Inventory" };
const TABS = ["products", "restock", "sales", "suppliers", "orders", "movements"] as const;

export default async function InventoryPage({ searchParams }: { searchParams: Promise<{ tab?: string; edit?: string }> }) {
  const { tab = "products", edit } = await searchParams;
  const ws = await getWorkspace();
  const org = ws.org.organizationId;
  const canWrite = can(ws.role, "records.write");
  const [products, suppliers, orders, movements, customers, sales] = await Promise.all([
    ws.supabase.from("products").select("*, suppliers:preferred_supplier_id(name, lead_time_days)").eq("organization_id", org).order("name"),
    ws.supabase.from("suppliers").select("*").eq("organization_id", org).order("name"),
    ws.supabase.from("purchase_orders").select("id, po_number, status, currency, total_minor, created_at, expected_at, is_sample, suppliers(name)").eq("organization_id", org).order("created_at", { ascending: false }).limit(100),
    ws.supabase.from("inventory_movements").select("id, movement_type, quantity, reason, occurred_at, reference_type, products(name, sku)").eq("organization_id", org).order("occurred_at", { ascending: false }).limit(100),
    ws.supabase.from("customers").select("id, name").eq("organization_id", org).order("name"),
    ws.supabase.from("sales").select("id, sale_number, occurred_at, currency, channel, discount_minor, invoice_id, is_sample, customers(name), sale_items(quantity, returned_quantity, unit_price_minor)").eq("organization_id", org).order("occurred_at", { ascending: false }).limit(30),
  ]);
  type P = ProductStock & { category: string | null; unit: string; unit_price_minor: number; is_active: boolean; is_sample: boolean; suppliers: { name: string; lead_time_days: number | null } | null };
  const prods = ((products.data ?? []) as unknown as P[]).map((p) => ({ ...p, stock_on_hand: Number(p.stock_on_hand), reorder_point: Number(p.reorder_point), reorder_quantity: Number(p.reorder_quantity) }));
  const productOptions = prods.map((p) => ({ value: p.id, label: `${p.sku} · ${p.name}` }));
  const valuation = totalsByCurrency(prods.map((p) => ({ amountMinor: Math.round(Math.max(p.stock_on_hand, 0) * p.unit_cost_minor), currency: p.currency })));
  const recs = recommendRestock(prods.map((p) => ({ ...p, lead_time_days: p.lead_time_days ?? p.suppliers?.lead_time_days ?? null })), []);
  const editing = edit ? prods.find((p) => p.id === edit) : null;

  return (
    <>
      <PageHeader
        eyebrow="StockSense"
        title="Inventory"
        description="Stock levels are derived only from recorded movements. Corrections are new adjustments, never edits."
        actions={can(ws.role, "executions.create") ? (
          <ActionForm action={requestRestockPlan} redirectTo={(d) => `/app/tasks/${d.executionId}`}>
            <SubmitButton variant="gold" size="sm"><Sparkles className="h-4 w-4" />Build restock plan</SubmitButton>
          </ActionForm>
        ) : null}
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"><div className="text-xs text-fg-muted">Active products</div><div className="mt-1 text-xl font-semibold">{prods.filter((p) => p.is_active).length}</div></div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"><div className="text-xs text-fg-muted">At/below reorder point</div><div className="mt-1 text-xl font-semibold text-gold">{prods.filter((p) => p.stock_on_hand <= p.reorder_point).length}</div></div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"><div className="text-xs text-fg-muted">Out of stock</div><div className="mt-1 text-xl font-semibold text-danger">{prods.filter((p) => p.stock_on_hand <= 0).length}</div></div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface px-4 py-3"><div className="text-xs text-fg-muted">Stock value at cost</div><div className="tabular mt-1 text-xl font-semibold">{valuation.length ? valuation.map((v) => formatMoney(v.amountMinor, v.currency)).join(" · ") : "—"}</div></div>
      </div>

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Inventory sections">
        {TABS.map((t) => (
          <Link key={t} href={`/app/inventory?tab=${t}`} className={cn("rounded-lg border px-3 py-1.5 text-xs capitalize", tab === t ? "border-brand/40 bg-brand-soft text-brand" : "border-line text-fg-muted hover:text-fg")}>{t === "orders" ? "Purchase orders" : t}</Link>
        ))}
      </nav>

      {tab === "products" ? (
        <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
          <Card>
            {prods.length ? (
              <Table>
                <THead><TR><TH>Product</TH><TH className="text-right">On hand</TH><TH className="text-right">Reorder at</TH><TH className="text-right">Price</TH><TH className="text-right">Cost</TH><TH>Supplier</TH><TH /></TR></THead>
                <TBody>
                  {prods.map((p) => (
                    <TR key={p.id}>
                      <TD><div className="font-medium">{p.name} {p.is_sample ? <SampleBadge /> : null}</div><div className="font-mono text-[11px] text-fg-subtle">{p.sku}{p.category ? ` · ${p.category}` : ""}</div></TD>
                      <TD className={cn("tabular text-right", p.stock_on_hand <= 0 ? "text-danger" : p.stock_on_hand <= p.reorder_point ? "text-gold" : "")}>{qty(p.stock_on_hand)} {p.unit}</TD>
                      <TD className="tabular text-right text-fg-muted">{qty(p.reorder_point)}</TD>
                      <TD className="tabular text-right">{formatMoney(p.unit_price_minor, p.currency)}</TD>
                      <TD className="tabular text-right text-fg-muted">{formatMoney(p.unit_cost_minor, p.currency)}</TD>
                      <TD className="text-xs text-fg-muted">{p.suppliers?.name ?? "—"}</TD>
                      <TD>{canWrite ? <Link href={`/app/inventory?tab=products&edit=${p.id}`} className="text-xs text-fg-muted hover:text-fg">Edit</Link> : null}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <EmptyState icon={Boxes} title="No products yet" description="Add products with opening stock to start tracking inventory." />
            )}
          </Card>
          {canWrite ? (
            <div className="space-y-6">
              <Card>
                <CardHeader title={editing ? `Edit ${editing.sku}` : "Add product"} actions={editing ? <Link href="/app/inventory" className="text-xs text-fg-muted">Cancel</Link> : null} />
                <CardBody>
                  <ActionForm key={editing?.id ?? "new"} action={saveProduct} resetOnSuccess={!editing} redirectTo={() => (editing ? "/app/inventory" : null)} className="grid grid-cols-2 gap-3">
                    {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
                    <Field label="SKU" htmlFor="sku"><Input id="sku" name="sku" defaultValue={editing?.sku} required maxLength={64} /></Field>
                    <Field label="Unit" htmlFor="unit"><Input id="unit" name="unit" defaultValue={editing?.unit ?? "unit"} /></Field>
                    <Field label="Name" htmlFor="pname" className="col-span-2"><Input id="pname" name="name" defaultValue={editing?.name} required /></Field>
                    <Field label="Category" htmlFor="category"><Input id="category" name="category" defaultValue={editing?.category ?? ""} /></Field>
                    <Field label="Currency" htmlFor="pcurrency"><Select id="pcurrency" name="currency" defaultValue={editing?.currency ?? ws.org.defaultCurrency}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                    <Field label="Selling price" htmlFor="unit_price"><Input id="unit_price" name="unit_price" inputMode="decimal" defaultValue={editing ? toMajorString(editing.unit_price_minor, editing.currency) : ""} required /></Field>
                    <Field label="Unit cost" htmlFor="unit_cost"><Input id="unit_cost" name="unit_cost" inputMode="decimal" defaultValue={editing ? toMajorString(editing.unit_cost_minor, editing.currency) : ""} required /></Field>
                    <Field label="Reorder point" htmlFor="reorder_point"><Input id="reorder_point" name="reorder_point" inputMode="decimal" defaultValue={editing ? String(editing.reorder_point) : "0"} /></Field>
                    <Field label="Reorder quantity" htmlFor="reorder_quantity"><Input id="reorder_quantity" name="reorder_quantity" inputMode="decimal" defaultValue={editing ? String(editing.reorder_quantity) : "0"} /></Field>
                    <Field label="Lead time (days)" htmlFor="lead_time_days"><Input id="lead_time_days" name="lead_time_days" inputMode="numeric" defaultValue={editing?.lead_time_days ?? ""} /></Field>
                    <Field label="Preferred supplier" htmlFor="preferred_supplier_id"><Select id="preferred_supplier_id" name="preferred_supplier_id" defaultValue={editing?.preferred_supplier_id ?? ""}><option value="">None</option>{(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                    {!editing ? <Field label="Opening stock" htmlFor="opening_stock" hint="Recorded as an opening movement" className="col-span-2"><Input id="opening_stock" name="opening_stock" inputMode="decimal" defaultValue="0" /></Field> : null}
                    <SubmitButton className="col-span-2">{editing ? "Save product" : "Add product"}</SubmitButton>
                  </ActionForm>
                </CardBody>
              </Card>
              {prods.length ? (
                <Card>
                  <CardHeader title="Record stock movement" description="Adjustments may be positive or negative" />
                  <CardBody>
                    <ActionForm action={recordMovement} resetOnSuccess className="grid grid-cols-2 gap-3">
                      <Field label="Product" htmlFor="mproduct" className="col-span-2"><Select id="mproduct" name="product_id" required defaultValue=""><option value="" disabled>Select</option>{productOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</Select></Field>
                      <Field label="Type" htmlFor="mtype"><Select id="mtype" name="movement_type"><option value="adjustment">Adjustment (+/−)</option><option value="opening">Opening stock (+)</option><option value="customer_return">Customer return (+)</option><option value="spoilage">Spoilage / damage (−)</option><option value="supplier_return">Return to supplier (−)</option></Select></Field>
                      <Field label="Quantity" htmlFor="mqty"><Input id="mqty" name="quantity" inputMode="decimal" required /></Field>
                      <Field label="Reason" htmlFor="mreason" className="col-span-2"><Input id="mreason" name="reason" required minLength={3} placeholder="e.g. Stock count correction" /></Field>
                      <SubmitButton variant="secondary" className="col-span-2">Record movement</SubmitButton>
                    </ActionForm>
                  </CardBody>
                </Card>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "restock" ? (
        <Card>
          <CardHeader title="Restock recommendations" description="Rule-based: configured reorder points and lead times. The Build restock plan action also uses recent sales velocity when at least 14 days of history exist." />
          {recs.length ? (
            <Table>
              <THead><TR><TH>Product</TH><TH>Risk</TH><TH className="text-right">On hand</TH><TH className="text-right">Suggested qty</TH><TH className="text-right">Est. cost</TH><TH>Why</TH></TR></THead>
              <TBody>
                {recs.map((r) => (
                  <TR key={r.productId}>
                    <TD><div className="font-medium">{r.name}</div><div className="font-mono text-[11px] text-fg-subtle">{r.sku}</div></TD>
                    <TD><StatusBadge status={r.stockoutRisk} /></TD>
                    <TD className="tabular text-right">{qty(r.stockOnHand)}</TD>
                    <TD className="tabular text-right font-medium">{qty(r.recommendedQuantity)}</TD>
                    <TD className="tabular text-right">{formatMoney(r.estimatedCostMinor, r.currency)}</TD>
                    <TD className="max-w-sm text-xs text-fg-muted">{r.reasons.join(" ")}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <CardBody><p className="text-sm text-fg-muted">No products are at or below their reorder point.</p></CardBody>
          )}
        </Card>
      ) : null}

      {tab === "sales" ? (
        <div className="space-y-6">
        <Card>
          <CardHeader title="Recent sales" description="Invoicing a sale does not touch stock again — the sale already moved it." />
          {(sales.data ?? []).length ? (
            <Table>
              <THead><TR><TH>Sale</TH><TH>Customer</TH><TH>Channel</TH><TH className="text-right">Net total</TH><TH>Invoice</TH></TR></THead>
              <TBody>
                {((sales.data ?? []) as unknown as { id: string; sale_number: string; occurred_at: string; currency: string; channel: string | null; discount_minor: number; invoice_id: string | null; is_sample: boolean; customers: { name: string } | null; sale_items: { quantity: number; returned_quantity: number; unit_price_minor: number }[] }[]).map((s) => (
                  <TR key={s.id}>
                    <TD><div className="font-medium">{s.sale_number} {s.is_sample ? <SampleBadge /> : null}</div><div className="text-xs text-fg-subtle">{fmtDateTime(s.occurred_at)}</div></TD>
                    <TD className="text-fg-muted">{s.customers?.name ?? "Walk-in"}</TD>
                    <TD className="text-fg-muted">{s.channel ?? "—"}</TD>
                    <TD className="tabular text-right">{formatMoney(s.sale_items.reduce((t, i) => t + Math.round((Number(i.quantity) - Number(i.returned_quantity)) * i.unit_price_minor), 0) - s.discount_minor, s.currency)}</TD>
                    <TD>
                      {s.invoice_id ? <Link href={`/app/invoices/${s.invoice_id}`} className="text-xs text-brand hover:underline">View invoice</Link>
                        : canWrite && s.customers ? <ActionForm action={invoiceFromSale} redirectTo={(d) => `/app/invoices/${d.id}`}><input type="hidden" name="sale_id" value={s.id} /><SubmitButton size="sm" variant="ghost">Create invoice</SubmitButton></ActionForm>
                        : <span className="text-xs text-fg-subtle">{s.customers ? "—" : "No customer"}</span>}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : <CardBody><p className="text-sm text-fg-muted">No sales recorded yet.</p></CardBody>}
        </Card>
        <Card>
          <CardHeader title="Record a sale" description="Reduces stock, snapshots unit cost for MarginGuard, all in one transaction." />
          <CardBody>
            {!canWrite ? <p className="text-sm text-fg-muted">Viewers cannot record sales.</p> : !prods.length ? <Notice>Add products first.</Notice> : (
              <ActionForm action={recordSale} resetOnSuccess className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Customer (optional)" htmlFor="scust"><Select id="scust" name="customer_id" defaultValue=""><option value="">Walk-in / none</option>{(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
                  <Field label="Currency" htmlFor="scur"><Select id="scur" name="currency" defaultValue={ws.org.defaultCurrency}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                  <Field label="Channel" htmlFor="schan"><Input id="schan" name="channel" placeholder="shop, whatsapp, instagram…" /></Field>
                </div>
                <RepeatRows addLabel="Add product" columns={[
                  { name: "sale_product", label: "Product", type: "select", options: productOptions, width: "2fr", required: true },
                  { name: "sale_quantity", label: "Quantity", placeholder: "1", required: true },
                  { name: "sale_price", label: "Unit price (blank = list price)", placeholder: "list price" },
                ]} />
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Payment fees" htmlFor="sfee"><Input id="sfee" name="payment_fee" inputMode="decimal" placeholder="0.00" /></Field>
                  <Field label="Shipping / delivery cost" htmlFor="sship"><Input id="sship" name="shipping_cost" inputMode="decimal" placeholder="0.00" /></Field>
                  <Field label="Discount given" htmlFor="sdisc"><Input id="sdisc" name="discount" inputMode="decimal" placeholder="0.00" /></Field>
                </div>
                <SubmitButton>Record sale</SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
        </div>
      ) : null}

      {tab === "suppliers" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <Card>
            {(suppliers.data ?? []).length ? (
              <Table>
                <THead><TR><TH>Supplier</TH><TH>Contact</TH><TH className="text-right">Lead time</TH></TR></THead>
                <TBody>
                  {(suppliers.data ?? []).map((s) => (
                    <TR key={s.id}><TD className="font-medium">{s.name} {s.is_sample ? <SampleBadge /> : null}</TD><TD className="text-xs text-fg-muted">{[s.contact_name, s.email, s.phone].filter(Boolean).join(" · ") || "—"}</TD><TD className="text-right">{s.lead_time_days ?? "—"} days</TD></TR>
                  ))}
                </TBody>
              </Table>
            ) : <EmptyState icon={Truck} title="No suppliers yet" />}
          </Card>
          {canWrite ? (
            <Card>
              <CardHeader title="Add supplier" />
              <CardBody>
                <ActionForm action={saveSupplier} resetOnSuccess className="space-y-3">
                  <Field label="Name" htmlFor="sname"><Input id="sname" name="name" required /></Field>
                  <Field label="Contact person" htmlFor="scontact"><Input id="scontact" name="contact_name" /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Email" htmlFor="semail"><Input id="semail" name="email" type="email" /></Field>
                    <Field label="Phone" htmlFor="sphone"><Input id="sphone" name="phone" /></Field>
                  </div>
                  <Field label="Lead time (days)" htmlFor="slead"><Input id="slead" name="lead_time_days" inputMode="numeric" /></Field>
                  <SubmitButton>Add supplier</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "orders" ? (
        <div className="space-y-6">
          <Card>
            <CardHeader title="Purchase orders" description="Drafts commit nothing. Approval (admin) commits spend; receiving goods updates stock." />
            {(orders.data ?? []).length ? (
              <Table>
                <THead><TR><TH>PO</TH><TH>Supplier</TH><TH>Status</TH><TH>Expected</TH><TH className="text-right">Total</TH></TR></THead>
                <TBody>
                  {((orders.data ?? []) as unknown as { id: string; po_number: string; status: string; currency: string; total_minor: number; expected_at: string | null; is_sample: boolean; suppliers: { name: string } | null }[]).map((o) => (
                    <TR key={o.id}>
                      <TD><Link href={`/app/inventory/purchase-orders/${o.id}`} className="font-medium hover:text-brand">{o.po_number}</Link></TD>
                      <TD className="text-fg-muted">{o.suppliers?.name ?? "Unassigned"}</TD>
                      <TD><StatusBadge status={o.status} /></TD>
                      <TD className="text-fg-muted">{fmtDate(o.expected_at)}</TD>
                      <TD className="tabular text-right">{formatMoney(o.total_minor, o.currency)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : <CardBody><p className="text-sm text-fg-muted">No purchase orders yet.</p></CardBody>}
          </Card>
          {canWrite && prods.length ? (
            <Card>
              <CardHeader title="New purchase order" />
              <CardBody>
                <ActionForm action={createPurchaseOrder} redirectTo={(d) => `/app/inventory/purchase-orders/${d.id}`} className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Supplier" htmlFor="posup"><Select id="posup" name="supplier_id" defaultValue=""><option value="">Unassigned</option>{(suppliers.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
                    <Field label="Currency" htmlFor="pocur"><Select id="pocur" name="currency" defaultValue={ws.org.defaultCurrency}>{SUPPORTED_CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
                    <Field label="Expected delivery" htmlFor="poexp"><Input id="poexp" name="expected_at" type="date" /></Field>
                  </div>
                  <RepeatRows addLabel="Add line" columns={[
                    { name: "po_product", label: "Product", type: "select", options: productOptions, width: "2fr", required: true },
                    { name: "po_quantity", label: "Quantity", required: true },
                    { name: "po_cost", label: "Unit cost", required: true },
                  ]} />
                  <SubmitButton>Create draft PO</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      ) : null}

      {tab === "movements" ? (
        <Card>
          <CardHeader title="Stock ledger" description="Latest 100 movements. This ledger is append-only." />
          <Table>
            <THead><TR><TH>When</TH><TH>Product</TH><TH>Type</TH><TH className="text-right">Qty</TH><TH>Reason / reference</TH></TR></THead>
            <TBody>
              {((movements.data ?? []) as unknown as { id: string; movement_type: string; quantity: number; reason: string | null; occurred_at: string; reference_type: string | null; products: { name: string; sku: string } | null }[]).map((m) => (
                <TR key={m.id}>
                  <TD className="text-xs text-fg-muted">{fmtDateTime(m.occurred_at)}</TD>
                  <TD>{m.products?.name}</TD>
                  <TD><Badge>{m.movement_type.replace("_", " ")}</Badge></TD>
                  <TD className={cn("tabular text-right", Number(m.quantity) < 0 ? "text-danger" : "text-brand")}>{Number(m.quantity) > 0 ? "+" : ""}{qty(m.quantity)}</TD>
                  <TD className="text-xs text-fg-muted">{m.reason ?? m.reference_type ?? "—"}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
