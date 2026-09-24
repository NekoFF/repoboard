"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

/* ---------------------------------------------------------------- toasts -- */

type ToastKind = "info" | "success" | "error";
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

const ToastContext = createContext<{
  push: (toast: Omit<Toast, "id">) => void;
}>({ push: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastHost({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev, { ...toast, id }]);
    // Errors stay longer: they usually need reading, not just noticing.
    const ttl = toast.kind === "error" ? 7000 : 3600;
    setTimeout(
      () => setToasts((prev) => prev.filter((t) => t.id !== id)),
      ttl,
    );
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 left-1/2 z-[100] flex w-full max-w-md -translate-x-1/2 flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="rb-pop pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 shadow-pop"
          >
            <span
              aria-hidden
              className={`mt-[5px] size-1.5 shrink-0 rounded-full ${
                toast.kind === "error"
                  ? "bg-danger-fg"
                  : toast.kind === "success"
                    ? "bg-success-fg"
                    : "bg-muted"
              }`}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[12px] font-medium text-ink">{toast.message}</p>
              {toast.detail && (
                <p className="mt-0.5 text-[11px] leading-snug text-muted">
                  {toast.detail}
                </p>
              )}
            </div>
            {toast.action && (
              <button
                className="rb-btn-ghost shrink-0 px-2 py-1 text-ink"
                onClick={() => {
                  toast.action!.run();
                  setToasts((prev) => prev.filter((t) => t.id !== toast.id));
                }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ------------------------------------------------------------ skeletons -- */

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`rb-skeleton ${className}`} />;
}

export function RowSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="flex flex-col">
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="flex items-center gap-3 border-b border-border p-3 last:border-b-0"
          style={{ opacity: 1 - index * 0.13 }}
        >
          <Skeleton className="h-[18px] w-24 rounded-sm" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-[18px] w-20 rounded-sm" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-[18px] w-14 rounded-sm" />
      <Skeleton className="h-3 w-1/2" />
    </div>
  );
}

/* ---------------------------------------------------------- empty state -- */

export function EmptyState({
  title,
  body,
  action,
  icon = "◦",
}: {
  title: string;
  body: string;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="rb-enter flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <span className="text-[18px] text-muted/60" aria-hidden>
        {icon}
      </span>
      <p className="text-[13px] font-medium text-ink">{title}</p>
      <p className="max-w-sm text-[12px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------- relative time -- */

function formatRelative(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

/** Ticks on its own so "2m ago" never silently goes stale on screen. */
export function RelativeTime({
  value,
  className = "",
}: {
  value: number | string | null | undefined;
  className?: string;
}) {
  const timestamp = useMemo(() => {
    if (value == null) return null;
    return typeof value === "string" ? Date.parse(value) : value;
  }, [value]);

  const [, force] = useState(0);
  useEffect(() => {
    if (timestamp == null) return;
    const id = setInterval(() => force((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, [timestamp]);

  if (timestamp == null || Number.isNaN(timestamp)) {
    return <span className={className}>—</span>;
  }
  return (
    <span className={className} title={new Date(timestamp).toLocaleString()}>
      {formatRelative(timestamp)}
    </span>
  );
}

/* ---------------------------------------------------------------- modal -- */

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="rb-fade-in fixed inset-0 z-[80] flex items-center justify-center bg-ink/20 p-6 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal
        className={`rb-pop flex max-h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-pop ${
          wide ? "max-w-4xl" : "max-w-2xl"
        }`}
      >
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <div className="min-w-0 flex-1 text-[14px] font-semibold text-ink">
            {title}
          </div>
          <button className="rb-btn-ghost" onClick={onClose} aria-label="Close">
            Esc
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && (
          <div className="flex items-center gap-2 border-t border-border px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- inline UI -- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-pill p-1">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-all duration-150 ${
              active
                ? "bg-surface text-ink shadow-card"
                : "text-muted hover:text-ink"
            }`}
          >
            {option.label}
            {option.count !== undefined && (
              <span className={active ? "ml-1.5 text-muted" : "ml-1.5"}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-block size-3 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${className}`}
      aria-hidden
    />
  );
}
