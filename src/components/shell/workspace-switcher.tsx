"use client";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Building2, User } from "lucide-react";
import { switchWorkspace } from "@/app/app/actions";
import type { ActionResult } from "@/lib/errors";

export function WorkspaceSwitcher({ current, options }: { current: string; options: { id: string; name: string; kind: "personal" | "business"; role: string }[] }) {
  const [state, action] = useActionState<ActionResult<null> | null, FormData>(switchWorkspace, null);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  const cur = options.find((o) => o.id === current);
  const Icon = cur?.kind === "personal" ? User : Building2;
  return (
    <form ref={formRef} action={action}>
      <label htmlFor="ws-switch" className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.14em] text-fg-subtle">
        Workspace
      </label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden />
        <select
          id="ws-switch"
          name="organizationId"
          defaultValue={current}
          onChange={() => formRef.current?.requestSubmit()}
          className="h-9 w-full appearance-none rounded-lg border border-line-strong bg-surface-2 pl-8 pr-3 text-sm text-fg focus:border-brand focus:outline-none"
        >
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name} · {o.role}
            </option>
          ))}
        </select>
      </div>
      {state && !state.ok ? <p className="mt-1 text-xs text-danger">{state.error}</p> : null}
    </form>
  );
}
