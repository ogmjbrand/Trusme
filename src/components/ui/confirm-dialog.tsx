"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "./button";

/** Accessible modal confirmation built on the native <dialog> element. */
export function ConfirmDialog({ open, title, message, confirmLabel = "Confirm", tone = "primary", onConfirm, onCancel }: { open: boolean; title?: string; message: ReactNode; confirmLabel?: string; tone?: "primary" | "danger"; onConfirm: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      aria-labelledby="confirm-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius-card)] border border-line-strong bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60"
    >
      <div className="flex gap-3 p-5">
        <AlertTriangle className={tone === "danger" ? "mt-0.5 h-5 w-5 shrink-0 text-danger" : "mt-0.5 h-5 w-5 shrink-0 text-gold"} aria-hidden />
        <div className="min-w-0">
          <h2 id="confirm-title" className="text-sm font-semibold">{title ?? "Please confirm"}</h2>
          <div className="mt-1 text-sm text-fg-muted">{message}</div>
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
        <Button variant="ghost" size="sm" onClick={onCancel} autoFocus>Cancel</Button>
        <Button variant={tone === "danger" ? "danger" : "primary"} size="sm" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  );
}
