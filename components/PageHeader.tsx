"use client";

import type { ReactNode } from "react";

/**
 * The strip at the top of every screen: what this is on the left, what you
 * can do here on the right. One height everywhere, so switching screens never
 * makes the page jump.
 */
export function PageHeader({
  title,
  icon,
  meta,
  actions,
  children,
}: {
  title: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** A second row, for view switches and filters. */
  children?: ReactNode;
}) {
  return (
    <header className="shrink-0 border-b border-border bg-surface">
      <div className="flex h-12 items-center gap-3 px-4 lg:px-5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {icon && <span className="text-muted">{icon}</span>}
          <h1 className="truncate text-base font-semibold text-ink">{title}</h1>
          {meta && <span className="hidden truncate text-sm text-faint sm:inline">{meta}</span>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children && (
        <div className="flex min-h-11 flex-wrap items-center gap-2 border-t border-border px-4 py-1.5 lg:px-5">
          {children}
        </div>
      )}
    </header>
  );
}
