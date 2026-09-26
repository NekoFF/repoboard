"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCheck, ChevronRight, MessageSquareText, Paperclip, Plus, SquarePlus } from "lucide-react";
import type { DocItem, ParsedDocument } from "@/lib/markdown/document";
import type { ItemNote, ItemState } from "@/lib/markdown/format";
import { InlineMarkdown, ItemMetaChips } from "@/components/Markdown";
import { Menu, MenuItem, MenuSeparator, ProgressBar, StatusIcon, Tooltip } from "@/components/ui";
import { api } from "@/lib/client/api";
import { STATUS_LABEL } from "@/lib/status";

export type ChecklistFilter = "all" | "open" | "review" | "done";

const DETAIL_LABEL: Record<string, string> = {
  why: "Why",
  do: "Do",
  how: "How",
  verify: "Verify",
  source: "Source",
  note: "Note",
  done: "Done when",
  proof: "Proof",
  checked: "Checked",
};

/** A repository path written relative to the document, as a path from the repository root. */
function resolveFrom(docPath: string, target: string): string {
  const parts = docPath.split("/").slice(0, -1);
  for (const piece of target.split("/")) {
    if (piece === "..") parts.pop();
    else if (piece !== "." && piece !== "") parts.push(piece);
  }
  return parts.join("/");
}

/**
 * One piece of evidence: a screenshot as a picture that opens full size, a
 * link, or the quoted words — whatever the `Proof:` line holds.
 */
function ProofText({ text, docPath }: { text: string; docPath: string }) {
  const image = text.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
  if (image) {
    const src = /^https?:\/\//.test(image[2]) ? image[2] : api.rawUrl(resolveFrom(docPath, image[2]));
    return (
      <a href={src} target="_blank" rel="noreferrer noopener" className="block w-fit">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={image[1]} className="max-h-48 max-w-full rounded-lg object-contain ring-1 ring-border" />
      </a>
    );
  }
  const quote = text.match(/^[“"](.+)[”"]$/s);
  if (quote) {
    return <blockquote className="border-l-2 border-state-done/50 pl-2.5 italic text-ink">{quote[1]}</blockquote>;
  }
  return <DetailText text={text} />;
}

const STATES: ItemState[] = ["todo", "doing", "review", "done", "cancelled"];

function matches(state: ItemState, filter: ChecklistFilter) {
  if (filter === "all") return true;
  if (filter === "open") return state === "todo" || state === "doing";
  if (filter === "review") return state === "review";
  return state === "done" || state === "cancelled";
}

/** "https://…" in a Source line becomes a link; the rest stays text. */
function DetailText({ text }: { text: string }) {
  return <InlineMarkdown text={text.replace(/(^|\s)(https?:\/\/\S+)/g, "$1<$2>")} />;
}

function NoteRow({ note, pending }: { note: ItemNote; pending?: boolean }) {
  return (
    <div className={`flex gap-2.5 text-sm ${pending ? "opacity-80" : ""}`}>
      <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-pill text-[9px] font-semibold uppercase text-muted ring-1 ring-border">
        {(note.author ?? "?").slice(0, 2)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-2xs text-faint">
          <span className="font-medium text-muted">{note.author ?? "note"}</span>
          {note.date && <span className="ml-1.5">{note.date}</span>}
          {pending && <span className="ml-1.5 text-state-review">not committed</span>}
        </p>
        <p className="leading-relaxed text-ink">
          <DetailText text={note.text} />
        </p>
      </div>
    </div>
  );
}

function ItemRow({
  item,
  children,
  state,
  pending,
  pendingNotes,
  expanded,
  onToggle,
  onState,
  onNote,
  onCreateCard,
  onProof,
  docPath,
  pendingProofs,
  author,
  depth,
}: {
  item: DocItem;
  children: DocItem[];
  state: ItemState;
  pending: boolean;
  pendingNotes: ItemNote[];
  expanded: boolean;
  onToggle: () => void;
  onState: (state: ItemState) => void;
  onNote: (text: string) => void;
  onCreateCard?: () => void;
  onProof?: () => void;
  docPath: string;
  pendingProofs: number;
  author: string;
  depth: number;
}) {
  const [note, setNote] = useState("");
  const closed = state === "done" || state === "cancelled";
  const hasBody = item.details.length > 0 || item.notes.length > 0 || children.length > 0 || pendingNotes.length > 0;
  const childDone = children.filter((c) => c.state === "done").length;

  return (
    <div
      id={`line-${item.line}`}
      className={`group/item scroll-mt-24 rounded-lg transition-colors ${expanded ? "bg-canvas ring-1 ring-border" : "hover:bg-hover"} ${
        pending ? "ring-1 ring-state-review/40" : ""
      }`}
      style={{ marginLeft: depth * 24 }}
    >
      <div className="flex min-h-10 items-start gap-2.5 px-2.5 py-2">
        <span onClick={(event) => event.stopPropagation()} className="mt-px">
          <Menu
            trigger={
              <button
                className="grid size-[22px] place-items-center rounded-md hover:bg-pill"
                aria-label={`${STATUS_LABEL[state]} — change`}
                onClick={(event) => {
                  // A plain click ticks it off or re-opens it; the menu is for the rest.
                  if (!event.altKey && state !== "doing") {
                    event.preventDefault();
                    onState(closed ? "todo" : "done");
                  }
                }}
                onContextMenu={(event) => event.preventDefault()}
              >
                <StatusIcon status={state} size={16} />
              </button>
            }
          >
            {onProof && (
              <>
                <MenuItem icon={<CheckCheck className="size-3.5" />} onSelect={onProof}>
                  Done with proof…
                </MenuItem>
                <MenuSeparator />
              </>
            )}
            {STATES.map((s) => (
              <MenuItem key={s} icon={<StatusIcon status={s} />} checked={s === state} onSelect={() => onState(s)}>
                {s === "review" ? "Needs checking" : STATUS_LABEL[s]}
              </MenuItem>
            ))}
          </Menu>
        </span>

        <button className="min-w-0 flex-1 text-left" onClick={onToggle} aria-expanded={expanded}>
          <span className={`text-base leading-[1.45] ${closed ? "text-muted" : "text-ink"} ${state === "cancelled" ? "line-through decoration-faint" : ""}`}>
            <InlineMarkdown text={item.title} />
          </span>
          <ItemMetaChips item={item} />
          {state === "review" && (
            <span className="ml-2 inline-flex h-5 items-center rounded-sm bg-state-review/10 px-1.5 align-middle text-2xs font-medium text-state-review">
              Needs your check
            </span>
          )}
          {pending && (
            <span className="ml-2 align-middle text-2xs font-medium text-state-review">
              {pendingProofs > 0 ? `with ${pendingProofs} proof${pendingProofs === 1 ? "" : "s"}, not committed` : "not committed"}
            </span>
          )}
        </button>

        <span className="mt-0.5 flex shrink-0 items-center gap-2 text-2xs text-faint">
          {children.length > 0 && (
            <span className="tabular-nums" title="Sub-items">
              {childDone}/{children.length}
            </span>
          )}
          {item.details.some((d) => d.key === "proof") && (
            <span className="inline-flex items-center gap-0.5 text-state-done" title="Has proof">
              <Paperclip className="size-3" />
              {item.details.filter((d) => d.key === "proof").length}
            </span>
          )}
          {item.notes.length + pendingNotes.length > 0 && (
            <span className="inline-flex items-center gap-0.5" title="Notes">
              <MessageSquareText className="size-3" />
              {item.notes.length + pendingNotes.length}
            </span>
          )}
          <button
            className={`rb-icon-btn size-6 ${hasBody || expanded ? "" : "opacity-0 group-hover/item:opacity-100"}`}
            onClick={onToggle}
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronRight className={`size-3.5 transition-transform duration-100 ${expanded ? "rotate-90" : ""}`} />
          </button>
        </span>
      </div>

      {expanded && (
        <div className="rb-enter flex flex-col gap-4 pb-3 pl-[42px] pr-3">
          {item.details.length > 0 ? (
            <dl className="grid grid-cols-[76px_1fr] gap-x-3 gap-y-1.5 text-sm">
              {item.details.map((detail, index) => (
                <div key={index} className="contents">
                  <dt className="pt-px text-xs font-medium text-faint">{detail.key ? DETAIL_LABEL[detail.key] : ""}</dt>
                  <dd className={`leading-relaxed ${detail.key === "verify" ? "text-ink" : "text-muted"}`}>
                    {detail.key === "proof" ? <ProofText text={detail.text} docPath={docPath} /> : <DetailText text={detail.text} />}
                  </dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="text-xs text-faint">
              No details yet. Add them in the file as nested bullets — <code className="font-mono">- Why:</code>{" "}
              <code className="font-mono">- Do:</code> <code className="font-mono">- Verify:</code>
            </p>
          )}

          {(item.notes.length > 0 || pendingNotes.length > 0) && (
            <div className="flex flex-col gap-2.5 border-t border-border pt-3">
              {item.notes.map((n, index) => (
                <NoteRow key={index} note={n} />
              ))}
              {pendingNotes.map((n, index) => (
                <NoteRow key={`p${index}`} note={n} pending />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <form
              className="flex min-w-[220px] flex-1 items-center gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (!note.trim()) return;
                onNote(note.trim());
                setNote("");
              }}
            >
              <input
                className="rb-input h-8 flex-1"
                placeholder={`Add a note as ${author}…`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
              <button className="rb-btn rb-btn-sm" disabled={!note.trim()}>
                Add note
              </button>
            </form>
            {onProof && (
              <button className="rb-btn rb-btn-sm" onClick={onProof}>
                {state === "done" ? <Paperclip className="size-3.5" /> : <CheckCheck className="size-3.5" />}
                {state === "done" ? "Add proof" : "Done with proof"}
              </button>
            )}
            {onCreateCard && (
              <Tooltip content="Put this on the board as a card that links back here">
                <button className="rb-btn-ghost" onClick={onCreateCard}>
                  <SquarePlus className="size-3.5" /> Card
                </button>
              </Tooltip>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * A document as a checklist: sections with their progress, items that open
 * to show why, what to do and how to verify, and the notes people and agents
 * left under them. Sub-items stay folded inside their parent until opened.
 */
export function DocChecklist({
  doc,
  filter,
  states,
  pendingNotes,
  pendingAdds,
  author,
  onState,
  onNote,
  onAdd,
  onCreateCard,
  onProof,
  docPath,
  pendingProofs,
}: {
  doc: ParsedDocument;
  filter: ChecklistFilter;
  states: Map<number, ItemState>;
  pendingNotes: Map<number, ItemNote[]>;
  pendingAdds: { section: string | null; title: string }[];
  author: string;
  onState: (item: DocItem, state: ItemState) => void;
  onNote: (item: DocItem, text: string) => void;
  onAdd: (section: string | null, title: string) => void;
  onCreateCard?: (item: DocItem) => void;
  onProof?: (item: DocItem) => void;
  docPath: string;
  pendingProofs: Map<number, number>;
}) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [adding, setAdding] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  const childrenOf = useMemo(() => {
    const map = new Map<number, DocItem[]>();
    for (const item of doc.items) {
      if (item.parent == null) continue;
      map.set(item.parent, [...(map.get(item.parent) ?? []), item]);
    }
    return map;
  }, [doc.items]);

  // Links like #line-42 (from the overview or another document) open that
  // item, and every item above it, and bring it into view.
  useEffect(() => {
    const reveal = () => {
    const match = window.location.hash.match(/^#line-(\d+)$/);
    if (!match) return;
    const target = doc.items.find((i) => i.line === Number(match[1]));
    if (!target) return;
    const open = new Set<number>([target.line]);
    let parent = target.parent;
    while (parent != null) {
      open.add(parent);
      parent = doc.items.find((i) => i.line === parent)?.parent ?? null;
    }
    setExpanded(open);
    requestAnimationFrame(() =>
      document.getElementById(`line-${target.line}`)?.scrollIntoView({ block: "center", behavior: "smooth" }),
    );
    };
    reveal();
    // The command menu can point at another item of the document already open.
    window.addEventListener("hashchange", reveal);
    return () => window.removeEventListener("hashchange", reveal);
  }, [doc.items]);

  const stateOf = (item: DocItem) => states.get(item.line) ?? item.state;
  const toggle = (line: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(line)) next.delete(line);
      else next.add(line);
      return next;
    });

  const renderItem = (item: DocItem, depth: number): React.ReactNode => {
    const kids = childrenOf.get(item.line) ?? [];
    const state = stateOf(item);
    const visibleKids = kids.filter((k) => matches(stateOf(k), filter) || (childrenOf.get(k.line)?.length ?? 0) > 0);
    if (!matches(state, filter) && visibleKids.length === 0) return null;
    const open = expanded.has(item.line);
    return (
      <div key={item.line} className="flex flex-col gap-1">
        <ItemRow
          item={item}
          children={kids}
          state={state}
          pending={states.has(item.line) && states.get(item.line) !== item.state}
          pendingNotes={pendingNotes.get(item.line) ?? []}
          expanded={open}
          onToggle={() => toggle(item.line)}
          onState={(s) => onState(item, s)}
          onNote={(text) => onNote(item, text)}
          onCreateCard={onCreateCard ? () => onCreateCard(item) : undefined}
          onProof={onProof ? () => onProof(item) : undefined}
          docPath={docPath}
          pendingProofs={pendingProofs.get(item.line) ?? 0}
          author={author}
          depth={depth}
        />
        {open && kids.map((kid) => renderItem(kid, depth + 1))}
      </div>
    );
  };

  const sections = doc.sections
    .map((section, index) => ({
      section,
      index,
      items: doc.items.filter((i) => i.section === index && i.parent == null),
      adds: pendingAdds.filter((a) => (a.section ?? "") === section.heading),
    }))
    .filter((s) => s.section.depth !== 1 || s.items.length > 0 || s.adds.length > 0)
    .filter((s) => s.index !== 0 || s.items.length > 0 || s.adds.length > 0);

  return (
    <div className="flex flex-col gap-9">
      {sections.map(({ section, index, items, adds }) => {
        const rendered = items.map((item) => renderItem(item, 0)).filter(Boolean);
        const hasContent = rendered.length > 0 || adds.length > 0;
        if (!hasContent && filter !== "all") return null;
        const heading = section.heading || doc.title;
        return (
          <section key={index} id={`line-${section.line}`} className="scroll-mt-4">
            <div
              className="mb-2 flex items-end gap-4 border-b border-border pb-2"
              style={{ paddingLeft: Math.max(0, section.depth - 2) * 16 }}
            >
              <h2 className={`min-w-0 flex-1 font-semibold tracking-[-0.01em] text-ink ${section.depth <= 2 ? "text-lg" : "text-md"}`}>
                <InlineMarkdown text={heading} />
              </h2>
              {section.total > 0 && (
                <span className="mb-1 flex w-40 shrink-0 items-center gap-2.5 text-xs tabular-nums text-faint">
                  <ProgressBar counts={{ done: section.done, review: section.review, doing: section.doing, total: section.total }} height={5} />
                  {section.done}/{section.total}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              {rendered}
              {adds.map((a, i) => (
                <div key={`add-${i}`} className="flex min-h-10 items-center gap-2.5 rounded-lg px-2.5 ring-1 ring-state-review/40">
                  <StatusIcon status="todo" size={16} />
                  <span className="flex-1 text-base text-ink">{a.title}</span>
                  <span className="text-2xs font-medium text-state-review">not committed</span>
                </div>
              ))}
              {filter === "all" &&
                (adding === index ? (
                  <form
                    className="flex h-10 items-center gap-2.5 rounded-lg px-2.5 ring-1 ring-border-strong"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!draft.trim()) return;
                      onAdd(section.heading || null, draft.trim());
                      setDraft("");
                    }}
                  >
                    <StatusIcon status="todo" size={16} />
                    <input
                      autoFocus
                      className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint"
                      placeholder="New item — !high @name due:2026-10-01 #tag work here too"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setAdding(null);
                          setDraft("");
                        }
                      }}
                      onBlur={() => !draft.trim() && setAdding(null)}
                    />
                  </form>
                ) : (
                  <button
                    className="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-faint transition-colors hover:bg-hover hover:text-muted"
                    onClick={() => setAdding(index)}
                  >
                    <Plus className="size-4" /> Add item
                  </button>
                ))}
            </div>
          </section>
        );
      })}
      {doc.items.length === 0 && pendingAdds.length === 0 && (
        <p className="text-sm text-muted">This file has no checklist items yet.</p>
      )}
    </div>
  );
}
