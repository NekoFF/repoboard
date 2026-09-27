"use client";

import { ArrowLeft, Home, RefreshCw } from "lucide-react";
import { StartFrame } from "@/components/connect/Frame";

/**
 * Something broke, or the page does not exist: say so plainly and always
 * offer a way on — back, home, or loading again. Used by app/error.tsx,
 * app/global-error.tsx and app/not-found.tsx.
 */
export function ErrorScreen({
  title,
  body,
  detail,
  onRetry,
}: {
  title: string;
  body: string;
  detail?: string;
  onRetry?: () => void;
}) {
  return (
    <StartFrame>
      <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.02em] text-ink">{title}</h1>
      <p className="mt-3 text-md leading-relaxed text-muted">{body}</p>
      {detail && <p className="mt-3 rounded-lg bg-pill p-3 font-mono text-xs text-muted">{detail}</p>}
      <div className="mt-6 flex flex-wrap gap-2">
        <button type="button" className="rb-btn-primary h-10 rounded-xl px-4" onClick={onRetry ?? (() => window.location.reload())}>
          <RefreshCw className="size-3.5" /> Try again
        </button>
        <button type="button" className="rb-btn h-10 rounded-xl px-4" onClick={() => window.history.back()}>
          <ArrowLeft className="size-3.5" /> Back
        </button>
        <a href="/" className="rb-btn h-10 rounded-xl px-4">
          <Home className="size-3.5" /> Overview
        </a>
      </div>
    </StartFrame>
  );
}
