"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth/context";
import { runAction, unwrap, type ActionResult } from "@/lib/errors";
import { writeAudit } from "@/lib/audit";
import { parseMajor } from "@/lib/money";

const opt = (v: FormDataEntryValue | null) => (v === null || v === "" ? undefined : String(v));

export async function recordExpense(_: ActionResult<null> | null, form: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const ws = await requirePermission("records.write");
    const currency = z.string().regex(/^[A-Z]{3}$/).parse(form.get("currency"));
    const d = z
      .object({
        description: z.string().trim().min(2).max(300),
        category: z.string().trim().min(1).max(80),
        cost_type: z.enum(["inventory_purchase", "shipping", "payment_fee", "other_direct", "overhead", "personal"]),
        amount_minor: z.number().int().positive(),
        incurred_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        product_id: z.string().uuid().optional(),
        supplier_id: z.string().uuid().optional(),
        launch_project_id: z.string().uuid().optional(),
      })
      .parse({
        description: form.get("description"), category: form.get("category") || "general", cost_type: form.get("cost_type"),
        amount_minor: parseMajor(String(form.get("amount") ?? ""), currency), incurred_at: form.get("incurred_at"),
        product_id: opt(form.get("product_id")), supplier_id: opt(form.get("supplier_id")), launch_project_id: opt(form.get("launch_project_id")),
      });
    const row = unwrap(await ws.supabase.from("expenses").insert({ ...d, currency, organization_id: ws.org.organizationId, created_by: ws.user.id }).select("id").single()) as { id: string };
    await writeAudit(ws.supabase, { organizationId: ws.org.organizationId, actorUserId: ws.user.id, action: "expense.recorded", resourceType: "expense", resourceId: row.id, metadata: { cost_type: d.cost_type } });
    revalidatePath("/app/profitability");
    revalidatePath("/app/income");
    if (d.launch_project_id) revalidatePath(`/app/launch/${d.launch_project_id}`);
    return null;
  }, "Expense recorded");
}
