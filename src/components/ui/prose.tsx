import type { ReactNode } from "react";

export function ProsePage({ title, intro, children, updated }: { title: string; intro?: ReactNode; children: ReactNode; updated?: string }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
      <h1 className="text-3xl font-semibold">{title}</h1>
      {updated ? <p className="mt-1 text-xs text-fg-subtle">Last updated {updated}</p> : null}
      {intro ? <p className="mt-4 text-fg-muted">{intro}</p> : null}
      <div className="mt-8 space-y-8 text-sm leading-relaxed text-fg-muted [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-fg [&_li]:ml-4 [&_li]:list-disc [&_ul]:space-y-1">{children}</div>
    </article>
  );
}
