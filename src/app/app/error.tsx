"use client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg py-16">
      <Notice tone="danger" title="Something went wrong">
        This page could not be loaded. {error.digest ? <>Reference: <code>{error.digest}</code>.</> : null}
      </Notice>
      <Button className="mt-4" variant="secondary" onClick={reset}>Try again</Button>
    </div>
  );
}
