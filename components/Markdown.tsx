"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import Link from "next/link";
import { Children, Fragment, isValidElement, useMemo, useRef, useState, type ReactNode } from "react";
import { Check, CheckCheck, Copy } from "lucide-react";
import { resolveLink, type DocItem, type DocSection } from "@/lib/markdown/document";
import type { ItemState } from "@/lib/markdown/format";
import { DueLabel, Menu, MenuItem, MenuSeparator, PriorityIcon, ProgressBar, StatusIcon } from "@/components/ui";
import { api } from "@/lib/client/api";
import { STATUS_LABEL } from "@/lib/status";

/** [[docs/PRIVACY.md]] → a link to that document inside RepoBoard. */
function linkify(text: string): string {
  // Only outside code: `RB-4` in backticks is an example, not a link.
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : linkifyProse(part)))
    .join("");
}

function linkifyProse(text: string): string {
  return text
    .replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_m, target: string, label?: string) =>
      `[${(label ?? target).trim()}](/docs?path=${encodeURIComponent(resolveLink(target))})`,
    )
    .replace(/\bRB-(\d{1,6})\b/g, (_m, n: string) => `[RB-${n}](/board?ref=${n})`);
}

function SmartLink({ href, children }: { href?: string; children?: ReactNode }) {
  if (href?.startsWith("/")) {
    return (
      <Link href={href} className="font-medium">
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

/** `target` written relative to the file at `from`, as a path from the repository root. */
function resolveRelative(from: string, target: string): string {
  const parts = from.split("/").slice(0, -1);
  for (const piece of target.replace(/^\//, "").split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== "." && piece !== "") parts.push(piece);
  }
  return parts.join("/");
}

/**
 * HTML comments are notes for whoever edits the file (and hold rb: ids); like
 * GitHub, the rendered page leaves them out. Each is replaced by as many line
 * breaks as it spanned, so line numbers — which items are matched by — stay.
 * Comments inside code are code.
 */
function hideComments(text: string): string {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, index) => (index % 2 === 1 ? part : part.replace(/<!--[\s\S]*?-->/g, (c) => "\n".repeat(c.split("\n").length - 1))))
    .join("");
}

/** A code block with a copy button, so a command can go straight into a terminal. */
function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    const text = ref.current?.textContent?.replace(/\n$/, "") ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the browser refused; nothing to undo */
    }
  };
  return (
    <div className="group/code relative">
      <pre ref={ref}>{children}</pre>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy"}
        className="absolute right-2 top-2 inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs font-medium text-muted opacity-0 shadow-card transition-opacity duration-100 hover:text-ink focus-visible:opacity-100 group-hover/code:opacity-100 [@media(hover:none)]:opacity-100"
      >
        {copied ? <Check className="size-3.5 text-state-done" /> : <Copy className="size-3.5" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

const inlineComponents: Components = {
  p: ({ children }) => <>{children}</>,
  a: ({ href, children }) => <SmartLink href={href}>{children}</SmartLink>,
};

/** One line of markdown, rendered inline (bold, code, links) — for item titles. */
export function InlineMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={inlineComponents}
      allowedElements={["p", "strong", "em", "code", "a", "del"]}
      unwrapDisallowed
    >
      {linkify(text)}
    </ReactMarkdown>
  );
}

const STATES: ItemState[] = ["todo", "doing", "review", "done", "cancelled"];

function ItemStateButton({
  item,
  state,
  onChange,
  onProof,
}: {
  item: DocItem;
  state: ItemState;
  onChange?: (item: DocItem, state: ItemState) => void;
  onProof?: (item: DocItem) => void;
}) {
  const icon = <StatusIcon status={state} size={15} />;
  if (!onChange) return <span className="mt-[3px] shrink-0">{icon}</span>;
  return (
    <span className="mt-px shrink-0" onClick={(event) => event.stopPropagation()}>
      <Menu
        trigger={
          <button
            className="grid size-[21px] place-items-center rounded-md transition-colors hover:bg-pill"
            aria-label={`${STATUS_LABEL[state]} — change`}
            onClick={(event) => {
              // A plain click ticks or unticks; the menu is for the other states.
              if (!event.altKey && (state === "todo" || state === "done")) {
                event.preventDefault();
                onChange(item, state === "done" ? "todo" : "done");
              }
            }}
          >
            {icon}
          </button>
        }
      >
        {onProof && (
          <>
            <MenuItem icon={<CheckCheck className="size-3.5" />} onSelect={() => onProof(item)}>
              Done with proof…
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        {STATES.map((s) => (
          <MenuItem key={s} icon={<StatusIcon status={s} />} checked={s === state} onSelect={() => onChange(item, s)}>
            {STATUS_LABEL[s]}
          </MenuItem>
        ))}
      </Menu>
    </span>
  );
}

export function ItemMetaChips({ item }: { item: Pick<DocItem, "priority" | "due" | "owners" | "tags"> }) {
  if (!item.priority && !item.due && item.owners.length === 0 && item.tags.length === 0) return null;
  return (
    <span className="ml-1.5 inline-flex flex-wrap items-center gap-1.5 align-middle text-2xs text-muted">
      {item.priority > 0 && <PriorityIcon priority={item.priority} size={13} />}
      {item.due && <DueLabel value={item.due} className="font-medium" />}
      {item.owners.map((o) => (
        <span key={o} className="rounded-sm bg-pill px-1 font-medium">@{o}</span>
      ))}
      {item.tags.map((t) => (
        <span key={t} className="text-faint">#{t}</span>
      ))}
    </span>
  );
}

function nestedLists(children: ReactNode): ReactNode[] {
  return Children.toArray(children).filter(
    (child) => isValidElement(child) && (child.type === "ul" || child.type === "ol"),
  );
}

/**
 * Renders a markdown document. When `items` are given (from parseDocument),
 * every checkbox line becomes a live item: its state icon can be clicked, its
 * metadata shows as chips, and headings carry their section's progress.
 */
export function Markdown({
  content,
  items,
  sections,
  states,
  onItemState,
  onItemProof,
  basePath,
  className = "",
}: {
  content: string;
  items?: DocItem[];
  sections?: DocSection[];
  /** Pending, not-yet-committed states by line — shown instead of the file's. */
  states?: Map<number, ItemState>;
  onItemState?: (item: DocItem, state: ItemState) => void;
  onItemProof?: (item: DocItem) => void;
  /** The document's path: pictures written relative to it are loaded from the repository. */
  basePath?: string;
  className?: string;
}) {
  const byLine = useMemo(() => new Map((items ?? []).map((i) => [i.line, i])), [items]);
  const sectionByLine = useMemo(
    () => new Map((sections ?? []).filter((s) => s.depth > 0).map((s) => [s.line, s])),
    [sections],
  );

  const components = useMemo<Components>(() => {
    const heading =
      (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
      // eslint-disable-next-line react/display-name
      ({ node, children }: { node?: { position?: { start: { line: number } } }; children?: ReactNode }) => {
        const line = (node?.position?.start.line ?? 0) - 1;
        const section = sectionByLine.get(line);
        const id = section ? `line-${line}` : undefined;
        return (
          <Tag id={id} className="group/heading scroll-mt-16">
            <span className="flex items-baseline gap-3">
              <span className="min-w-0 flex-1">{children}</span>
              {section && section.total > 0 && Tag !== "h1" && (
                <span className="flex w-28 shrink-0 items-center gap-2 self-center text-2xs font-normal tabular-nums text-faint">
                  <ProgressBar counts={{ done: section.done, doing: section.doing, total: section.total }} height={4} />
                  {section.done}/{section.total}
                </span>
              )}
            </span>
          </Tag>
        );
      };

    return {
      a: ({ href, children }) => <SmartLink href={href}>{children}</SmartLink>,
      h1: heading("h1"),
      h2: heading("h2"),
      h3: heading("h3"),
      h4: heading("h4"),
      h5: heading("h5"),
      h6: heading("h6"),
      ul: ({ children, className: cls }) => {
        return <ul className={cls}>{children}</ul>;
      },
      li: ({ node, children, className: cls }) => {
        const line = (node?.position?.start.line ?? 0) - 1;
        const item = byLine.get(line);
        if (!item) return <li className={cls}>{children}</li>;
        const state = states?.get(line) ?? item.state;
        const pending = states?.has(line) && states.get(line) !== item.state;
        const closed = state === "done" || state === "cancelled";
        return (
          <li className="task-list-item !mt-0 list-none" data-line={line}>
            <div
              className={`-mx-1.5 flex items-start gap-2 rounded-md px-1.5 py-[3px] transition-colors ${
                pending ? "bg-state-review/10" : "hover:bg-hover"
              }`}
            >
              <ItemStateButton item={item} state={state} onChange={onItemState} onProof={onItemProof} />
              <span className={`min-w-0 flex-1 ${closed ? "text-muted" : ""} ${state === "cancelled" ? "line-through decoration-faint" : ""}`}>
                <InlineMarkdown text={item.title} />
                <ItemMetaChips item={item} />
                {pending && <span className="ml-2 text-2xs font-medium text-state-review">not committed</span>}
              </span>
            </div>
            {nestedLists(children).map((child, index) => (
              <Fragment key={index}>{child}</Fragment>
            ))}
          </li>
        );
      },
      input: () => null,
      pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
      img: ({ src, alt }) => {
        const url = typeof src === "string" ? src : "";
        const resolved = /^(https?:|data:|blob:)/.test(url) || !basePath ? url : api.rawUrl(url.startsWith("/") ? url.slice(1) : resolveRelative(basePath, url));
        return (
          <a href={resolved} target="_blank" rel="noreferrer noopener" className="inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={resolved} alt={alt ?? ""} className="max-h-72 max-w-full rounded-lg ring-1 ring-border" />
          </a>
        );
      },
      table: ({ children }) => (
        <div className="overflow-x-auto">
          <table>{children}</table>
        </div>
      ),
    };
  }, [byLine, sectionByLine, states, onItemState, onItemProof, basePath]);

  return (
    <div className={`rb-prose ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {items ? hideComments(content) : linkify(hideComments(content))}
      </ReactMarkdown>
    </div>
  );
}
