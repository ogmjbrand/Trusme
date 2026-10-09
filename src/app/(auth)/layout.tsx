import Link from "next/link";
import { Wordmark } from "@/components/shell/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between border-r border-line bg-surface p-10 lg:flex">
        <Wordmark />
        <div>
          <p className="text-2xl font-semibold leading-snug text-fg">Tell TrustOS what you want done.<br /><span className="text-fg-muted">It plans, executes with your permission, verifies and keeps the record.</span></p>
          <ul className="mt-6 space-y-2 text-sm text-fg-muted">
            <li>• Consequential actions always wait for your approval</li>
            <li>• Every step is logged and auditable</li>
            <li>• Your workspace data is isolated by default</li>
          </ul>
        </div>
        <p className="text-xs text-fg-subtle">© {new Date().getFullYear()} TrustOS · <Link href="/privacy" className="hover:text-fg">Privacy</Link> · <Link href="/terms" className="hover:text-fg">Terms</Link></p>
      </div>
      <div className="flex flex-col justify-center px-4 py-10 sm:px-10">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Wordmark /></div>
          {children}
        </div>
      </div>
    </div>
  );
}
