"use server";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/context";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { parseMajor } from "@/lib/money";
import { getEngine } from "@/lib/execution/server";

const uuid = z.string().uuid();
const opt = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));
const num = z.coerce.number();

export async function saveProduct(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const currency = z.string().regex(/^[A-Z]{3}$/).parse(form.get("currency") ?? ws.org.defaultCurrency);
    const d = z
      .object({
        sku: z.string().trim().min(1).max(64),
        name: z.string().trim().min(1).max(200),
        category: z.string().trim().max(80).optional(),
        unit: z.string().trim().min(1).max(20).default("unit"),
        unit_price_minor: z.number().int().min(0),
        unit_cost_minor: z.number().int().min(0),
        reorder_point: num.min(0),
        reorder_quantity: num.min(0),
        lead_time_days: num.int().min(0).max(365).optional(),
        preferred_supplier_id: uuid.optional(),
      })
      .parse({
        sku: form.get("sku"), name: form.get("name"), category: opt(form.get("category")), unit: opt(form.get("unit")),
        unit_price_minor: parseMajor(String(form.get("unit_price") || "0"), currency), unit_cost_minor: parseMajor(String(form.get("unit_cost") || "0"), currency),
        reorder_point: form.get("reorder_point") || 0, reorder_quantity: form.get("reorder_quantity") || 0,
        lead_time_days: opt(form.get("lead_time_days")), preferred_supplier_id: opt(form.get("preferred_supplier_id")),
      });
    const org = ws.org.organizationId;
    const id = opt(form.get("id"));
    if (id) {
      const prev = unwrap(await ws.supabase.from("products").select("unit_cost_minor, currency").eq("id", id).eq("organization_id", org).single()) as { unit_cost_minor: number; currency: string };
      unwrap(await ws.supabase.from("products").update({ ...d, currency }).eq("id", id).eq("organization_id", org));
      if (prev.unit_cost_minor !== d.unit_cost_minor) {
        unwrap(await ws.supabase.from("product_cost_history").insert({ organization_id: org, product_id: id, supplier_id: d.preferred_supplier_id ?? null, currency, unit_cost_minor: d.unit_cost_minor, source: "manual", created_by: ws.user.id }));
      }
      await writeAudit(ws.supabase, { organizationId: org, actorUserId: ws.user.id, action: "product.updated", resourceType: "product", resourceId: id });
      revalidatePath("/app/inventory");
      return { id };
    }
    const row = unwrap(await ws.supabase.from("products").insert({ ...d, currency, organization_id: org, created_by: ws.user.id }).select("id").single()) as { id: string };
    unwrap(await ws.supabase.from("product_cost_history").insert({ organization_id: org, product_id: row.id, supplier_id: d.preferred_supplier_id ?? null, currency, unit_cost_minor: d.unit_cost_minor, source: "manual", created_by: ws.user.id }));
    const opening = Number(form.get("opening_stock") || 0);
    if (opening > 0) {
      unwrap(await ws.supabase.from("inventory_movements").insert({ organization_id: org, product_id: row.id, movement_type: "opening", quantity: opening, unit_cost_minor: d.unit_cost_minor, currency, reason: "Opening stock", created_by: ws.user.id }));
    }
    await writeAudit(ws.supabase, { organizationId: org, actorUserId: ws.user.id, action: "product.created", resourceType: "product", resourceId: row.id });
    revalidatePath("/app/inventory");
    return { id: row.id };
  }, "Product saved");
}

export async function recordMovement(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z
      .object({
        product_id: uuid,
        movement_type: z.enum(["opening", "adjustment", "customer_return", "spoilage", "supplier_return"]),
        quantity: num.refine((n) => n !== 0, "Quantity cannot be zero"),
        reason: z.string().trim().min(3, "Give a reason for the movement").max(300),
      })
      .parse({ product_id: form.get("product_id"), movement_type: form.get("movement_type"), quantity: form.get("quantity"), reason: form.get("reason") });
    const p = unwrap(await ws.supabase.from("products").select("unit_cost_minor, currency").eq("id", d.product_id).eq("organization_id", ws.org.organizationId).single()) as { unit_cost_minor: number; currency: string };
    // Direction is implied by the movement type for everything except adjustments.
    const signed = ["spoilage", "supplier_return"].includes(d.movement_type) ? -Math.abs(d.quantity) : d.movement_type === "adjustment" ? d.quantity : Math.abs(d.quantity);
    unwrap(await ws.supabase.from("inventory_movements").insert({ organization_id: ws.org.organizationId, product_id: d.product_id, movement_type: d.movement_type, quantity: signed, unit_cost_minor: p.unit_cost_minor, currency: p.currency, reason: d.reason, created_by: ws.user.id }));
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "inventory.movement_recorded", resourceType: "product", resourceId: d.product_id, metadata: { type: d.movement_type, quantity: signed } });
    revalidatePath("/app/inventory");
    return null;
  }, "Stock movement recorded");
}

export async function recordSale(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const currency = z.string().regex(/^[A-Z]{3}$/).parse(form.get("currency"));
    const productIds = form.getAll("sale_product").map(String);
    const qtys = form.getAll("sale_quantity").map(String);
    const prices = form.getAll("sale_price").map(String);
    const items = productIds
      .map((pid, i) => ({ pid, q: qtys[i] ?? "", p: prices[i] ?? "" }))
      .filter((x) => x.pid)
      .map((x) => ({ product_id: uuid.parse(x.pid), quantity: num.positive().parse(x.q), ...(x.p ? { unit_price_minor: parseMajor(x.p, currency) } : {}) }));
    if (!items.length) throw new Error("Add at least one product");
    const id = unwrap(
      await ws.supabase.rpc("record_sale", {
        p_org: ws.org.organizationId,
        p_customer: opt(form.get("customer_id")) ?? null,
        p_currency: currency,
        p_items: items,
        p_channel: opt(form.get("channel")) ?? null,
        p_payment_fee_minor: parseMajor(String(form.get("payment_fee") || "0"), currency),
        p_shipping_cost_minor: parseMajor(String(form.get("shipping_cost") || "0"), currency),
        p_discount_minor: parseMajor(String(form.get("discount") || "0"), currency),
      }),
    ) as string;
    revalidatePath("/app/inventory");
    revalidatePath("/app/profitability");
    return { id };
  }, "Sale recorded and stock updated");
}

export async function saveSupplier(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const d = z
      .object({ name: z.string().trim().min(1).max(200), contact_name: z.string().max(200).optional(), email: z.string().email().optional(), phone: z.string().max(40).optional(), lead_time_days: num.int().min(0).max(365).optional(), notes: z.string().max(1000).optional() })
      .parse({ name: form.get("name"), contact_name: opt(form.get("contact_name")), email: opt(form.get("email")), phone: opt(form.get("phone")), lead_time_days: opt(form.get("lead_time_days")), notes: opt(form.get("notes")) });
    const row = unwrap(await ws.supabase.from("suppliers").insert({ ...d, organization_id: ws.org.organizationId, created_by: ws.user.id }).select("id").single()) as { id: string };
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "supplier.created", resourceType: "supplier", resourceId: row.id });
    revalidatePath("/app/inventory");
    return null;
  }, "Supplier added");
}

export async function createPurchaseOrder(_: ActionResult<{ id: string }> | null, form: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const supplier = opt(form.get("supplier_id"));
    const currency = z.string().regex(/^[A-Z]{3}$/).parse(form.get("currency"));
    const pids = form.getAll("po_product").map(String);
    const qs = form.getAll("po_quantity").map(String);
    const cs = form.getAll("po_cost").map(String);
    const lines = pids
      .map((pid, i) => ({ pid, q: qs[i] ?? "", c: cs[i] ?? "" }))
      .filter((x) => x.pid)
      .map((x) => ({ product_id: uuid.parse(x.pid), quantity: num.positive().parse(x.q), unit_cost_minor: parseMajor(x.c || "0", currency) }));
    if (!lines.length) throw new Error("Add at least one line");
    const org = ws.org.organizationId;
    const number = unwrap(await ws.supabase.rpc("next_document_number", { p_org: org, p_kind: "purchase_order" })) as string;
    const po = unwrap(await ws.supabase.from("purchase_orders").insert({ organization_id: org, supplier_id: supplier ?? null, po_number: number, currency, expected_at: opt(form.get("expected_at")) ?? null, notes: opt(form.get("notes")) ?? null, created_by: ws.user.id }).select("id").single()) as { id: string };
    unwrap(await ws.supabase.from("purchase_order_items").insert(lines.map((l) => ({ ...l, organization_id: org, purchase_order_id: po.id }))));
    await writeAudit(ws.supabase, { organizationId: org, actorUserId: ws.user.id, action: "purchase_order.created", resourceType: "purchase_order", resourceId: po.id });
    revalidatePath("/app/inventory");
    return { id: po.id };
  }, "Draft purchase order created");
}

/** Approving a PO commits spend: admin-only, audited, and requires an explicit confirmation of the total. */
export async function setPurchaseOrderStatus(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const { id, status } = z.object({ id: uuid, status: z.enum(["approved", "sent", "cancelled"]) }).parse({ id: form.get("id"), status: form.get("status") });
    const ws = await requirePermission(status === "approved" ? "records.delete" : "records.write");
    const po = unwrap(await ws.supabase.from("purchase_orders").select("status, total_minor").eq("id", id).eq("organization_id", ws.org.organizationId).single()) as { status: string; total_minor: number };
    const allowed: Record<string, string[]> = { approved: ["draft"], sent: ["approved"], cancelled: ["draft", "approved", "sent"] };
    if (!allowed[status]!.includes(po.status)) throw new Error(`Cannot change a ${po.status} purchase order to ${status}`);
    if (status === "approved") {
      const confirmed = Number(form.get("confirm_total_minor"));
      if (confirmed !== po.total_minor) throw new Error("The order total changed since you reviewed it. Reload and review again.");
    }
    const patch: Record<string, unknown> = { status };
    if (status === "approved") Object.assign(patch, { approved_by: ws.user.id, approved_at: new Date().toISOString() });
    unwrap(await ws.supabase.from("purchase_orders").update(patch).eq("id", id).eq("organization_id", ws.org.organizationId));
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: `purchase_order.${status}`, resourceType: "purchase_order", resourceId: id, metadata: { total_minor: po.total_minor } });
    revalidatePath(`/app/inventory/purchase-orders/${id}`);
    return null;
  }, "Purchase order updated");
}

export async function receivePurchaseOrder(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const id = uuid.parse(form.get("id"));
    const itemIds = form.getAll("item_id").map(String);
    const qs = form.getAll("receive_quantity").map(String);
    const lines = itemIds.map((item_id, i) => ({ item_id: uuid.parse(item_id), quantity: Number(qs[i] || 0) })).filter((l) => l.quantity > 0);
    if (!lines.length) throw new Error("Enter a quantity received for at least one line");
    unwrap(await ws.supabase.rpc("receive_purchase_order", { p_po: id, p_lines: lines }));
    revalidatePath(`/app/inventory/purchase-orders/${id}`);
    revalidatePath("/app/inventory");
    return null;
  }, "Goods received; stock and costs updated");
}

export async function requestRestockPlan(_: ActionResult<{ executionId: string }> | null): Promise<ActionResult<{ executionId: string }>> {
  return runAction(async () => {
    const ws = await requirePermission("executions.create");
    const engine = getEngine();
    const exec = await engine.createExecution({
      orgId: ws.org.organizationId,
      actorUserId: ws.user.id,
      request: "Create a restocking plan",
      autoRunLowRisk: ws.preferences.ai_auto_run_low_risk,
      plan: {
        goal: "Create a restocking plan",
        summary: "Analyze stock, then draft purchase orders for at-risk products",
        planner: "manual",
        steps: [
          { toolId: "inventory.restock_report", title: "Analyze stock levels", input: { windowDays: 30 } },
          { toolId: "purchase_orders.create_drafts", title: "Draft restock purchase orders", input: { windowDays: 30 }, dependsOn: [0] },
        ],
      },
    });
    after(async () => {
      await engine.run(exec.id);
    });
    return { executionId: exec.id };
  });
}
