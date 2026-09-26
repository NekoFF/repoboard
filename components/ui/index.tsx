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
import * as Dialog from "@radix-ui/react-dialog";
import * as RadixTooltip from "@radix-ui/react-tooltip";
import { Check, CircleAlert, Info, X } from "lucide-react";

export * from "@/components/ui/glyphs";
export * from "@/components/ui/menu";

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

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
      // Errors and undo offers stay longer: they need reading or a decision.
      const ttl = toast.kind === "error" ? 8000 : toast.action ? 6000 : 3200;
      setTimeout(() => dismiss(id), ttl);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-[min(380px,calc(100vw-32px))] flex-col items-stretch gap-2"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="rb-pop rb-glass-strong pointer-events-auto flex items-start gap-2.5 rounded-xl px-3 py-2.5"
          >
            <span className="mt-px">
              {toast.kind === "error" ? (
                <CircleAlert className="size-4 text-danger" />
              ) : toast.kind === "success" ? (
                <Check className="size-4 text-state-done" />
              ) : (
                <Info className="size-4 text-muted" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{toast.message}</p>
              {toast.detail && <p className="mt-0.5 break-words text-xs text-muted">{toast.detail}</p>}
            </div>
            {toast.action && (
              <button
                className="rb-btn rb-btn-sm shrink-0"
                onClick={() => {
                  toast.action!.run();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button className="rb-icon-btn -mr-1 size-6" onClick={() => dismiss(toast.id)} aria-label="Dismiss">
              <X className="size-3.5" />
            </button>
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
          className="flex h-10 items-center gap-3 border-b border-border px-3 last:border-b-0"
          style={{ opacity: 1 - index * 0.14 }}
        >
          <Skeleton className="size-3.5 rounded-full" />
          <Skeleton className="h-3 flex-1" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <Skeleton className="h-3.5 w-2/3" />
      <Skeleton className="h-3 w-1/3" />
    </div>
  );
}

/* ---------------------------------------------------------- empty state -- */

export function EmptyState({
  title,
  body,
  action,
  icon,
  compact,
}: {
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div
      className={`rb-enter flex flex-col items-center justify-center gap-1.5 text-center ${
        compact ? "px-4 py-6" : "px-6 py-14"
      }`}
    >
      {icon && <div className="mb-2 text-faint">{icon}</div>}
      <p className="text-base font-medium text-ink">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-3 flex flex-wrap items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

/* --------------------------------------------------------- relative time -- */

function formatRelative(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000);
  const future = seconds < 0;
  const s = Math.abs(seconds);
  const say = (n: number, unit: string) => (future ? `in ${n}${unit}` : `${n}${unit} ago`);
  if (s < 10) return "just now";
  if (s < 60) return say(s, "s");
  const minutes = Math.round(s / 60);
  if (minutes < 60) return say(minutes, "m");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return say(hours, "h");
  const days = Math.round(hours / 24);
  if (days < 30) return say(days, "d");
  return formatDate(timestamp, { day: "numeric", month: "short", year: "numeric" });
}

/** A locale the server and the browser always agree on. */
const STABLE_LOCALE = "en-GB";

export function formatDate(
  value: number | string,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" },
): string {
  const time = typeof value === "string" ? Date.parse(value) : value;
  return new Date(time).toLocaleDateString(STABLE_LOCALE, { timeZone: "UTC", ...options });
}

export function formatDateTime(value: number | string): string {
  const time = typeof value === "string" ? Date.parse(value) : value;
  return new Date(time).toLocaleString(STABLE_LOCALE, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Days from today (UTC) to a date; negative when it is in the past. */
export function daysUntil(value: number | string): number {
  const time = typeof value === "string" ? Date.parse(value) : value;
  const today = new Date();
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((time - start) / 86_400_000);
}

/** "Today", "Tomorrow", "in 3d", "2d late" — or a date when it is far away. */
export function DueLabel({ value, className = "" }: { value: number | string; className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return <span className={className}>{formatDate(value)}</span>;
  const d = daysUntil(value);
  const text =
    d === 0 ? "Today" : d === 1 ? "Tomorrow" : d < 0 ? `${-d}d late` : d < 14 ? `in ${d}d` : formatDate(value);
  const tone = d < 0 ? "text-danger" : d <= 2 ? "text-state-doing" : "";
  return (
    <span className={`${tone} ${className}`} title={formatDate(value, { weekday: "short", day: "numeric", month: "long", year: "numeric" })}>
      {text}
    </span>
  );
}

/**
 * Ticks on its own so "2m ago" never silently goes stale on screen.
 *
 * The first render must match what the server sent, or React throws away the
 * whole tree: "now" differs between the two, and the browser's locale is not
 * the server's. So the absolute date is rendered until mount, and only then
 * does it become relative.
 */
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

  const [mounted, setMounted] = useState(false);
  const [, force] = useState(0);

  useEffect(() => {
    setMounted(true);
    if (timestamp == null) return;
    const id = setInterval(() => force((n) => n + 1), 15000);
    return () => clearInterval(id);
  }, [timestamp]);

  if (timestamp == null || Number.isNaN(timestamp)) {
    return <span className={className}>—</span>;
  }

  return (
    <time
      className={className}
      dateTime={new Date(timestamp).toISOString()}
      title={formatDateTime(timestamp)}
      suppressHydrationWarning
    >
      {mounted ? formatRelative(timestamp) : formatDate(timestamp)}
    </time>
  );
}

/* --------------------------------------------------------- modal, sheet -- */

export function Modal({
  title,
  description,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode;
  description?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="rb-fade-in rb-scrim fixed inset-0 z-[80]" />
        <Dialog.Content
          className={`rb-pop rb-glass-strong fixed left-1/2 top-[8vh] z-[81] flex max-h-[84vh] w-[calc(100vw-24px)] -translate-x-1/2 flex-col overflow-hidden rounded-2xl focus:outline-none ${
            wide ? "max-w-[920px]" : "max-w-[560px]"
          }`}
          aria-describedby={undefined}
        >
          <div className="flex items-start gap-3 px-5 pb-2 pt-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-md font-semibold text-ink">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-0.5 text-sm text-muted">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="rb-icon-btn -mr-1" aria-label="Close">
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-3">{children}</div>
          {footer && <div className="flex items-center gap-2 px-5 pb-4 pt-3">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A large panel centred over the page it belongs to (the card, a commit). */
export function Sheet({
  label,
  onClose,
  children,
  width = 760,
}: {
  label: string;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="rb-fade-in rb-scrim fixed inset-0 z-[60]" />
        <Dialog.Content
          className="rb-pop rb-glass-strong fixed inset-0 z-[61] m-auto flex h-full w-full flex-col overflow-hidden focus:outline-none sm:h-[calc(100dvh-48px)] sm:w-[calc(100vw-48px)] sm:rounded-[22px]"
          style={{ maxWidth: width, maxHeight: 920 }}
          aria-describedby={undefined}
          tabIndex={-1}
          // Focus the panel itself, not its first button: otherwise that
          // button's tooltip pops up the moment the panel opens.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement).focus();
          }}
        >
          <Dialog.Title className="sr-only">{label}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ------------------------------------------------------------- inline UI -- */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
}: {
  options: { value: T; label: ReactNode; count?: number; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex items-center gap-0.5 rounded-md bg-pill p-0.5" role="tablist">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            role="tab"
            aria-selected={active}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-colors duration-100 ${
              size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-sm"
            } ${active ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink"}`}
          >
            {option.label}
            {option.count !== undefined && (
              <span className="tabular-nums text-faint">{option.count}</span>
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
      className={`inline-block size-3.5 animate-spin rounded-full border-[1.5px] border-current border-t-transparent ${className}`}
      aria-hidden
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rb-kbd">{children}</kbd>;
}

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={350} skipDelayDuration={150}>
      {children}
    </RadixTooltip.Provider>
  );
}

export function Tooltip({
  content,
  children,
  side = "top",
  shortcut,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  shortcut?: string;
}) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          side={side}
          sideOffset={6}
          className="rb-fade-in z-[95] flex items-center gap-2 rounded-md bg-ink px-2 py-1 text-xs font-medium text-on-ink shadow-pop"
        >
          {content}
          {shortcut && <span className="text-on-ink/60">{shortcut}</span>}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  );
}

/** A labelled row of the detail panels: fixed label column, flexible value. */
export function PropertyRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 items-center gap-3">
      <span className="w-[92px] shrink-0 text-xs text-muted">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}
