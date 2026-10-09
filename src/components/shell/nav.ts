import type { OrgRole } from "@/lib/auth/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string;
  minRole?: OrgRole;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    label: "Operate",
    items: [
      { href: "/app", label: "Overview", icon: "LayoutDashboard" },
      { href: "/app/command", label: "Command Center", icon: "Sparkles" },
      { href: "/app/tasks", label: "Executions", icon: "ListChecks" },
      { href: "/app/approvals", label: "Approvals", icon: "ShieldCheck" },
      { href: "/app/activity", label: "Activity", icon: "Activity" },
    ],
  },
  {
    label: "Modules",
    items: [
      { href: "/app/invoices", label: "CollectIQ", icon: "Receipt" },
      { href: "/app/inventory", label: "StockSense", icon: "Boxes" },
      { href: "/app/profitability", label: "MarginGuard", icon: "TrendingUp" },
      { href: "/app/income", label: "IncomePilot", icon: "Wallet" },
      { href: "/app/trust", label: "BeforeYouPay", icon: "ShieldAlert" },
      { href: "/app/jobs", label: "JobProof", icon: "Hammer" },
      { href: "/app/career", label: "CareerVault", icon: "Briefcase" },
      { href: "/app/launch", label: "LaunchReady", icon: "Rocket" },
    ],
  },
  {
    label: "Workspace",
    items: [
      { href: "/app/customers", label: "Customers", icon: "Users" },
      { href: "/app/reports", label: "Reports", icon: "FileBarChart" },
      { href: "/app/integrations", label: "Integrations", icon: "Plug" },
      { href: "/app/settings", label: "Settings", icon: "Settings" },
      { href: "/app/billing", label: "Billing", icon: "CreditCard" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/app/team", label: "Team", icon: "UsersRound" },
      { href: "/app/audit", label: "Audit log", icon: "ScrollText", minRole: "admin" },
    ],
  },
];
