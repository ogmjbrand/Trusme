import type { ExecutionPlan, PlanStep } from "@/lib/execution/types";

/**
 * Deterministic keyword planner. Used when no LLM provider is configured, or
 * when an LLM plan fails validation. It only ever emits registered tools.
 */
export function ruleBasedPlan(request: string): ExecutionPlan {
  const r = request.toLowerCase();
  const steps: PlanStep[] = [];
  const notes: string[] = [];
  const add = (s: PlanStep) => steps.push(s) - 1;

  const wantsReceivables = /\b(overdue|unpaid|owe|owing|receivable|collect|debtor|invoice|outstanding)\b/.test(r);
  const careerContext = /\b(job applications?|interviews?|cv|resume|career)\b/.test(r);
  const wantsReminders = /\b(remind|reminder|follow[- ]?up|chase|nudge)\w*/.test(r) && (!careerContext || /\b(invoice|payment|owe|debtor|receivable)/.test(r));
  const wantsSend = /\bsend\b|\bemail them\b/.test(r) && wantsReminders;
  if (wantsReceivables || wantsReminders) {
    const find = add({ toolId: "invoices.find_overdue", title: "Find overdue invoices", rationale: "Identify unpaid invoices past their due date.", input: { minDaysOverdue: 1, limit: 50 } });
    if (wantsReminders) {
      const draft = add({ toolId: "reminders.draft", title: "Prepare payment reminder drafts", rationale: "Drafts are reviewable and not sent.", input: { scope: "all_overdue", minDaysOverdue: 1 }, dependsOn: [find] });
      if (wantsSend) {
        add({ toolId: "reminders.send", title: "Send approved reminders", rationale: "Sending is an external action and needs your approval of the exact recipients.", input: { scope: "execution_drafts" }, dependsOn: [draft] });
      } else {
        notes.push("Reminders will be prepared as drafts only. Ask to send them, or send from the invoice page, when you are ready.");
      }
    }
  }

  if (/\b(margin|profit|profitab|leak|losing money|markup)\w*/.test(r)) {
    add({ toolId: "margins.product_report", title: "Analyze product margins", rationale: "Compare contribution margins with the previous period.", input: { periodDays: 30, declineThresholdPts: 3 } });
  }

  if (/\b(stock|inventory|restock|reorder|re-order|running low|stockout)\w*/.test(r)) {
    const report = add({ toolId: "inventory.restock_report", title: "Analyze stock levels", rationale: "Find low-stock and at-risk products.", input: { windowDays: 30 } });
    if (/\b(plan|purchase order|po\b|order more|restocking plan|buy)\w*/.test(r)) {
      add({ toolId: "purchase_orders.create_drafts", title: "Draft restock purchase orders", rationale: "Drafts commit no money and are not sent to suppliers.", input: { windowDays: 30, includeRisk: ["out_of_stock", "high", "medium"] }, dependsOn: [report] });
    }
  }

  if (/\b(cash ?flow|forecast|runway|shortage|short of cash|irregular income|budget|bills)\b/.test(r)) {
    add({ toolId: "cashflow.forecast", title: "Project cash flow", rationale: "Estimate balances from obligations and receivables.", input: { horizonDays: 60 } });
    notes.push("Cash-flow projections are estimates based on stated assumptions. Add your current balance in IncomePilot for accuracy.");
  }

  const url = request.match(/https?:\/\/[^\s)]+/)?.[0];
  if (/\b(scam|fraud|legit|legitimate|suspicious|safe to pay|is this real|fake)\w*/.test(r) || url) {
    add({ toolId: "risk.screen", title: "Screen for scam patterns", rationale: "Heuristic screening; it cannot prove or disprove fraud.", input: { text: request, url, save: true } });
  }

  if (/\b(launch|start(ing)? a business|register (my|a) business|new business|business idea)\b/.test(r)) {
    const name = request.match(/(?:called|named)\s+["“]?([^"”,.]+)/i)?.[1]?.trim() ?? "New business launch";
    add({ toolId: "launch.create_plan", title: "Create launch plan", rationale: "Build a checklist with official sources to verify.", input: { name, idea: request.slice(0, 4000) } });
  }

  if (/\b(jobs?|customers? confirm|dispute|jobproof|work orders?|service jobs?)\b/.test(r) && !/\bjob applications?\b/.test(r)) {
    add({ toolId: "jobs.attention_report", title: "Review service jobs needing attention", rationale: "Disputes, confirmations, unpaid completed work and deadlines.", input: { deadlineWithinDays: 3 } });
  }

  if (/\b(follow[- ]?ups?|applications?|interviews?)\b/.test(r) && /\b(job|career|application|interview)/.test(r)) {
    add({ toolId: "career.follow_ups", title: "Check application follow-ups", rationale: "Find follow-ups due and upcoming interviews.", input: { withinDays: 7 } });
  }

  if (/\b(cv|resume|cover letter)\b/.test(r)) {
    notes.push("Career documents need a specific saved application. Open CareerVault, select the application and choose “Draft documents”.");
  }

  if (!steps.length) {
    add({ toolId: "workspace.summary", title: "Review available data", rationale: "No specific action was recognized; summarize what data exists.", input: {} });
    notes.push("I could not match this request to a supported action. Try asking about overdue invoices, margins, stock, cash flow, scam checks or launch planning.");
  }

  const summary = steps.map((s, i) => `${i + 1}. ${s.title}`).join(" → ");
  return { goal: request.slice(0, 500), summary, steps, planner: "rules_v1", notes };
}
