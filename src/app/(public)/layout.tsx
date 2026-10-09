import Link from "next/link";
import { Wordmark } from "@/components/shell/brand";
import { LinkButton } from "@/components/ui/button";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-bg/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Wordmark />
          <nav className="hidden items-center gap-6 text-sm text-fg-muted md:flex" aria-label="Site">
            <Link href="/#modules" className="hover:text-fg">Modules</Link>
            <Link href="/pricing" className="hover:text-fg">Pricing</Link>
            <Link href="/security" className="hover:text-fg">Security</Link>
            <Link href="/help" className="hover:text-fg">Help</Link>
          </nav>
          <div className="flex items-center gap-2">
            <LinkButton href="/login" variant="ghost" size="sm">Sign in</LinkButton>
            <LinkButton href="/signup" size="sm">Get started</LinkButton>
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-fg-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Wordmark />
          <nav className="flex flex-wrap gap-4" aria-label="Footer">
            <Link href="/pricing" className="hover:text-fg">Pricing</Link>
            <Link href="/security" className="hover:text-fg">Security</Link>
            <Link href="/help" className="hover:text-fg">Help</Link>
            <Link href="/terms" className="hover:text-fg">Terms</Link>
            <Link href="/privacy" className="hover:text-fg">Privacy</Link>
          </nav>
          <span>Built for Nigeria, ready for everywhere.</span>
        </div>
      </footer>
    </div>
  );
}
