import { LinkButton } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-gold">404</p>
      <h1 className="mt-2 text-2xl font-semibold">Not found</h1>
      <p className="mt-2 text-sm text-fg-muted">This page doesn&apos;t exist, or you don&apos;t have access to it in the current workspace.</p>
      <LinkButton href="/app" className="mt-6">Go to your workspace</LinkButton>
    </div>
  );
}
