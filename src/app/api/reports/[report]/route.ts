import { NextResponse } from "next/server";
import { getWorkspace } from "@/lib/auth/context";
import { can } from "@/lib/auth/permissions";
import { toMajorString } from "@/lib/money";
import { agingBucket, daysOverdue, outstanding, type InvoiceLike } from "@/lib/domain/receivables";

export const runtime = "nodejs";

function csv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) => r.map((v) => {
      const s = v === null || v === undefined ? "" : String(v);
      // Neutralise spreadsheet formula injection.
      const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    }).join(","))
    .join("\n");
}

export async function GET(_req: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const ws = await getWorkspace();
  const org = ws.org.organizationId;
  const today = new Date().toISOString().slice(0, 10);
  let rows: (string | number | null)[][] = [];

  switch (report) {
    case "receivables.csv": {
      const { data } = await ws.supabase.from("invoices").select("id, invoice_number, customer_id, status, currency, total_minor, amount_paid_minor, due_date, issue_date, is_sample, customers(name)").eq("organization_id", org).in("status", ["issued", "partially_paid"]);
      rows = [["invoice", "customer", "currency", "total", "paid", "balance", "due_date", "days_overdue", "aging_bucket", "sample"]];
      for (const i of (data ?? []) as unknown as (InvoiceLike & { is_sample: boolean; customers: { name: string } | null })[]) {
        const d = daysOverdue(i, today);
        rows.push([i.invoice_number, i.customers?.name ?? "", i.currency, toMajorString(i.total_minor, i.currency), toMajorString(i.amount_paid_minor, i.currency), toMajorString(outstanding(i), i.currency), i.due_date, d, agingBucket(d), i.is_sample ? "yes" : "no"]);
      }
      break;
    }
    case "payments.csv": {
      const { data } = await ws.supabase.from("payments").select("received_at, amount_minor, currency, method, source, provider, provider_reference, status, is_sample, invoices(invoice_number)").eq("organization_id", org).order("received_at", { ascending: false }).limit(5000);
      rows = [["received_at", "invoice", "amount", "currency", "method", "source", "provider", "provider_reference", "status", "sample"]];
      for (const p of (data ?? []) as unknown as { received_at: string; amount_minor: number; currency: string; method: string; source: string; provider: string | null; provider_reference: string | null; status: string; is_sample: boolean; invoices: { invoice_number: string } | null }[]) {
        rows.push([p.received_at, p.invoices?.invoice_number ?? "", toMajorString(p.amount_minor, p.currency), p.currency, p.method, p.source, p.provider, p.provider_reference, p.status, p.is_sample ? "yes" : "no"]);
      }
      break;
    }
    case "inventory.csv": {
      const { data } = await ws.supabase.from("products").select("sku, name, currency, stock_on_hand, reorder_point, unit_cost_minor, unit_price_minor, is_sample").eq("organization_id", org).order("sku");
      rows = [["sku", "name", "currency", "stock_on_hand", "reorder_point", "unit_cost", "unit_price", "stock_value_at_cost", "sample"]];
      for (const p of data ?? []) rows.push([p.sku, p.name, p.currency, Number(p.stock_on_hand), Number(p.reorder_point), toMajorString(p.unit_cost_minor, p.currency), toMajorString(p.unit_price_minor, p.currency), toMajorString(Math.round(Math.max(Number(p.stock_on_hand), 0) * p.unit_cost_minor), p.currency), p.is_sample ? "yes" : "no"]);
      break;
    }
    case "sales.csv": {
      const { data } = await ws.supabase.from("sales").select("sale_number, occurred_at, currency, channel, is_sample, sale_items(quantity, returned_quantity, unit_price_minor, unit_cost_minor, products(sku))").eq("organization_id", org).order("occurred_at", { ascending: false }).limit(5000);
      rows = [["sale", "occurred_at", "channel", "sku", "quantity", "returned", "unit_price", "unit_cost", "currency", "sample"]];
      for (const s of (data ?? []) as unknown as { sale_number: string; occurred_at: string; currency: string; channel: string | null; is_sample: boolean; sale_items: { quantity: number; returned_quantity: number; unit_price_minor: number; unit_cost_minor: number; products: { sku: string } | null }[] }[]) {
        for (const i of s.sale_items) rows.push([s.sale_number, s.occurred_at, s.channel, i.products?.sku ?? "", Number(i.quantity), Number(i.returned_quantity), toMajorString(i.unit_price_minor, s.currency), toMajorString(i.unit_cost_minor, s.currency), s.currency, s.is_sample ? "yes" : "no"]);
      }
      break;
    }
    case "audit.csv": {
      if (!can(ws.role, "audit.read")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const { data } = await ws.supabase.from("audit_logs").select("created_at, actor_type, actor_user_id, action, resource_type, resource_id, execution_id, metadata").eq("organization_id", org).order("id", { ascending: false }).limit(10000);
      rows = [["created_at", "actor_type", "actor_user_id", "action", "resource_type", "resource_id", "execution_id", "metadata"]];
      for (const a of data ?? []) rows.push([a.created_at, a.actor_type, a.actor_user_id, a.action, a.resource_type, a.resource_id, a.execution_id, JSON.stringify(a.metadata)]);
      break;
    }
    default:
      return NextResponse.json({ error: "Unknown report" }, { status: 404 });
  }
  return new Response(csv(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${ws.org.slug}-${report.replace(".csv", "")}-${today}.csv"`, "Cache-Control": "no-store" },
  });
}
