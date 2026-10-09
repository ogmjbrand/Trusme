import Link from "next/link";

export function Wordmark({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2" aria-label="TrustOS home">
      <span className="grid h-7 w-7 place-items-center rounded-lg border border-brand/40 bg-brand-soft">
        <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
          <path d="M12 2.5 4 5.8v5.7c0 4.9 3.4 8.9 8 10 4.6-1.1 8-5.1 8-10V5.8L12 2.5Z" fill="none" stroke="var(--color-brand)" strokeWidth="1.8" strokeLinejoin="round" />
          <path d="m8.5 12 2.4 2.4 4.6-4.8" fill="none" stroke="var(--color-gold)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight text-fg">
          Trust<span className="text-brand">OS</span>
        </span>
      )}
    </Link>
  );
}
