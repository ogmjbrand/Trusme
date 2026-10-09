import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: { default: "TrustOS — Plan, execute and verify real work", template: "%s · TrustOS" },
  description: "TrustOS turns goals into plans, executes them with authorized tools, verifies results and keeps a trustworthy record.",
};

export const viewport: Viewport = { themeColor: "#0a0c0d" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
