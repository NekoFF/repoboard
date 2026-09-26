"use client";

import type { ReactNode } from "react";

/**
 * The strip at the top of every screen, drawn as glass over the page: what
 * this is on the left, what you can do here on the right, and an optional
 * row for view switches and filters. No rules under it — the page scrolls
 * beneath and the blur is the separation. The scroll area that follows adds
 * `rb-under-header` so its first line starts below the glass.
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
    <header className="rb-header rb-glass-bar absolute inset-x-0 top-0 z-20" data-rows={children ? 2 : 1}>
      <div className="flex h-14 items-center gap-3 px-4 lg:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {icon && <span className="text-muted">{icon}</span>}
          <h1 className="truncate text-md font-semibold tracking-[-0.01em] text-ink">{title}</h1>
          {meta && <span className="hidden truncate text-sm text-faint sm:inline">{meta}</span>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
      </div>
      {children && (
        <div className="flex min-h-11 flex-wrap items-center gap-2 px-4 pb-2 lg:px-6">{children}</div>
      )}
    </header>
  );
}
