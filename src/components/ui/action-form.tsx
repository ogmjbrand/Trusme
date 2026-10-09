"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./confirm-dialog";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import type { ActionResult } from "@/lib/errors";
import { buttonClass } from "./button";
import { useToast } from "./toast";
import { cn } from "@/lib/cn";

type Action<T> = (prev: ActionResult<T> | null, formData: FormData) => Promise<ActionResult<T>>;

/**
 * Progressive form wrapper for server actions. Shows field errors, a toast
 * on completion, and optionally resets or redirects.
 */
export function ActionForm<T>({
  action,
  children,
  className,
  resetOnSuccess = false,
  successMessage,
  redirectTo,
  onSuccess,
}: {
  action: Action<T>;
  children: ReactNode | ((state: ActionResult<T> | null) => ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: string;
  redirectTo?: (data: T) => string | null;
  onSuccess?: (data: T) => void;
}) {
  const [state, formAction] = useActionState<ActionResult<T> | null, FormData>(action, null);
  const toast = useToast();
  const ref = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!state) return;
    if (state.ok) {
      const msg = state.message ?? successMessage;
      if (msg) toast({ tone: "success", message: msg });
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.(state.data);
      const to = redirectTo?.(state.data);
      if (to) router.push(to);
      else router.refresh();
    } else {
      toast({ tone: "error", message: state.error });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form ref={ref} action={formAction} className={className} noValidate={false}>
      {typeof children === "function" ? children(state) : children}
      {state && !state.ok && state.fieldErrors ? (
        <ul className="mt-3 space-y-0.5 text-xs text-danger" role="alert">
          {Object.entries(state.fieldErrors).map(([k, v]) => (
            <li key={k}>
              <span className="font-medium">{k}</span>: {v}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", size = "md", className, pendingLabel, name, value, disabled }: { children: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger" | "gold"; size?: "sm" | "md" | "lg"; className?: string; pendingLabel?: string; name?: string; value?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} className={cn(buttonClass(variant, size), className)} aria-busy={pending}>
      {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

/** Small inline form posting hidden fields, with optional confirmation prompt. */
export function InlineAction<T>({ action, fields, label, variant = "secondary", size = "sm", confirm, successMessage }: { action: Action<T>; fields: Record<string, string>; label: ReactNode; variant?: "primary" | "secondary" | "ghost" | "danger" | "gold"; size?: "sm" | "md"; confirm?: string; successMessage?: string }) {
  return (
    <ActionForm action={action} successMessage={successMessage} className="inline">
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <ConfirmSubmit variant={variant} size={size} confirm={confirm}>
        {label}
      </ConfirmSubmit>
    </ActionForm>
  );
}

function ConfirmSubmit({ children, variant, size, confirm }: { children: ReactNode; variant: "primary" | "secondary" | "ghost" | "danger" | "gold"; size: "sm" | "md"; confirm?: string }) {
  const { pending } = useFormStatus();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const confirmed = useRef(false);
  return (
    <>
      <button
        ref={btn}
        type="submit"
        disabled={pending}
        className={buttonClass(variant, size)}
        onClick={(e) => {
          if (confirm && !confirmed.current) {
            e.preventDefault();
            setOpen(true);
          }
          confirmed.current = false;
        }}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
        {children}
      </button>
      {confirm ? (
        <ConfirmDialog
          open={open}
          message={confirm}
          tone={variant === "danger" ? "danger" : "primary"}
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            setOpen(false);
            confirmed.current = true;
            btn.current?.form?.requestSubmit(btn.current);
          }}
        />
      ) : null}
    </>
  );
}
