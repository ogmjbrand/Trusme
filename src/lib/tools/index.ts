import "server-only";
import { ToolRegistry } from "@/lib/execution/registry";
import type { AppToolContext } from "./context";
import { draftReminders, findOverdueInvoices, sendReminders } from "./collectiq";
import { draftPurchaseOrders, restockReport } from "./stocksense";
import { cashflowForecast, marginReport, screenTransaction } from "./analysis";
import { careerDraftDocuments, careerSkillsGap, launchCreatePlan, workspaceSummary } from "./workspace";

let registry: ToolRegistry<AppToolContext> | undefined;

/** The complete allow-list of tools available to planners and the engine. */
export function toolRegistry(): ToolRegistry<AppToolContext> {
  if (!registry) {
    registry = new ToolRegistry<AppToolContext>()
      .register(workspaceSummary)
      .register(findOverdueInvoices)
      .register(draftReminders)
      .register(sendReminders)
      .register(restockReport)
      .register(draftPurchaseOrders)
      .register(marginReport)
      .register(cashflowForecast)
      .register(screenTransaction)
      .register(careerSkillsGap)
      .register(careerDraftDocuments)
      .register(launchCreatePlan);
  }
  return registry;
}
