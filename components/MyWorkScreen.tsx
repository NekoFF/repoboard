"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, CircleUserRound } from "lucide-react";
import type { BoardData, BoardSummary } from "@/lib/board-service";
import type { TrackedDoc } from "@/lib/docs-service";
import { api } from "@/lib/client/api";
import { flatten, locate, setDone, type ChecklistItem } from "@/lib/checklist";
import { statusOfColumn, type Status } from "@/lib/status";
import { PageHeader } from "@/components/PageHeader";
import { ActorAvatar } from "@/components/Actor";
import { useShell } from "@/components/shell/ShellContext";
import { DueLabel, EmptyState, Menu, MenuItem, PriorityIcon, StatusIcon, daysUntil, useToast } from "@/components/ui";

interface WorkItem {
  key: string;
  title: string;
  /** Where it lives, in words: "Design, RB-4 Tab strip, item 1.2". */
  where: string;
  href: string;
  status: Status;
  due: number | null;
  priority: number;
  /** Set for an item inside a card, which can be ticked right here. */
  tick?: { boardId: string; taskId: string; itemId: string; checklist: ChecklistItem[] };
}

const same = (a: string | null | undefined, b: string) => (a ?? "").replace(/^@/, "").toLowerCase() === b;

function dueOf(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  return typeof value === "number" ? value : Date.parse(`${value}T00:00:00Z`);
}

/** Everything one person has to do, from every board, every card and every checklist. */
function workFor(person: string, boards: { info: BoardSummary; data: BoardData }[], docs: TrackedDoc[]): WorkItem[] {
  const out: WorkItem[] = [];
  for (const { info, data } of boards) {
    const status = new Map(data.columns.map((c) => [c.id, statusOfColumn(c.name)]));
    for (const task of data.tasks) {
      const state = status.get(task.columnId) ?? "todo";
      const ref = task.number != null ? `RB-${task.number}` : "";
      // A card is someone's when it is assigned to them, or unassigned on their own board.
      const theirs = same(task.assignee, person) || (!task.assignee && same(info.owner, person));
      if (theirs && state !== "done" && state !== "cancelled") {
        out.push({
          key: task.id,
          title: task.title,
          where: [info.name, ref].filter(Boolean).join(", "),
          href: `/board/card/${task.id}`,
          status: state,
          due: task.dueDate,
          priority: task.priority,
        });
      }
      for (const item of flatten(task.checklist)) {
        if (item.done || !same(item.assignee, person)) continue;
        out.push({
          key: `${task.id}-${item.id}`,
          title: item.text,
          where: `${info.name}, ${ref ? `${ref} ` : ""}${task.title}, item ${locate(task.checklist, item.id)?.number ?? ""}`,
          href: `/board/card/${task.id}`,
          status: "todo",
          due: dueOf(item.due),
          priority: 0,
          tick: { boardId: info.id, taskId: task.id, itemId: item.id, checklist: task.checklist },
        });
      }
    }
  }
  for (const doc of docs) {
    for (const item of doc.items) {
      const state = (item.state ?? (item.done ? "done" : "todo")) as Status;
      if (state === "done" || state === "cancelled") continue;
      if (!(item.owners ?? []).some((o) => same(o, person))) continue;
      out.push({
        key: `${doc.id}-${item.line}`,
        title: item.title,
        where: doc.title,
        href: `/docs?path=${encodeURIComponent(doc.path)}#line-${item.line}`,
        status: state,
        due: dueOf(item.due),
        priority: item.priority ?? 0,
      });
    }
  }
  return out;
}

const GROUPS: { key: string; title: string; test: (days: number | null) => boolean }[] = [
  { key: "late", title: "Overdue", test: (d) => d != null && d < 0 },
  { key: "week", title: "This week", test: (d) => d != null && d >= 0 && d <= 7 },
  { key: "later", title: "Later", test: (d) => d != null && d > 7 },
  { key: "none", title: "No due date", test: (d) => d == null },
];

function Row({ item, onTick }: { item: WorkItem; onTick: (item: WorkItem) => void }) {
  return (
    <div className="group -mx-2 flex h-11 items-center gap-3 rounded-lg px-2 hover:bg-hover">
      {item.tick ? (
        <button
          className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-pill"
          aria-label="Mark as done"
          onClick={() => onTick(item)}
        >
          <StatusIcon status="todo" size={16} />
        </button>
      ) : (
        <span className="grid size-6 shrink-0 place-items-center">
          <StatusIcon status={item.status} size={16} />
        </span>
      )}
      <Link href={item.href} className="flex min-w-0 flex-1 items-baseline gap-3">
        <span className="min-w-0 truncate text-sm text-ink">{item.title}</span>
        <span className="hidden min-w-0 flex-1 truncate text-xs text-faint sm:block">{item.where}</span>
      </Link>
      {item.priority > 0 && <PriorityIcon priority={item.priority} />}
      {item.due != null && <DueLabel value={item.due} className="w-16 shrink-0 text-right text-xs font-medium" />}
    </div>
  );
}

/**
 * My work: everything assigned to one person across the project — cards on
 * any board, items inside cards, items in checklists marked @name — by when
 * it is due. Anyone's list can be opened, so whoever leads can see a
 * teammate's.
 */
export function MyWorkScreen({ boards, docs }: { boards: { info: BoardSummary; data: BoardData }[]; docs: TrackedDoc[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const { viewer } = useShell();
  const [ticked, setTicked] = useState<Set<string>>(new Set());

  // Everyone the project names: board owners, assignees, @owners in checklists.
  const people = useMemo(() => {
    const names = new Map<string, string>();
    const add = (n: string | null | undefined) => {
      const clean = (n ?? "").replace(/^@/, "").trim();
      if (clean && !names.has(clean.toLowerCase())) names.set(clean.toLowerCase(), clean);
    };
    add(viewer);
    for (const { info, data } of boards) {
      add(info.owner);
      for (const t of data.tasks) {
        add(t.assignee);
        flatten(t.checklist).forEach((i) => add(i.assignee));
      }
    }
    docs.forEach((d) => d.items.forEach((i) => (i.owners ?? []).forEach(add)));
    return [...names.values()];
  }, [boards, docs, viewer]);

  const person = params.get("person") ?? viewer ?? people[0] ?? "";
  const key = person.toLowerCase();
  const isMe = viewer != null && key === viewer.toLowerCase();
  const items = useMemo(
    () =>
      workFor(key, boards, docs)
        .filter((i) => !ticked.has(i.key))
        .sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity) || b.priority - a.priority),
    [key, boards, docs, ticked],
  );

  const choose = (name: string) => {
    const next = new URLSearchParams(params.toString());
    if (viewer && name.toLowerCase() === viewer.toLowerCase()) next.delete("person");
    else next.set("person", name);
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  const tick = async (item: WorkItem) => {
    if (!item.tick) return;
    setTicked((s) => new Set(s).add(item.key));
    try {
      await api.boardAction({
        boardId: item.tick.boardId,
        action: "update",
        taskId: item.tick.taskId,
        checklist: setDone(item.tick.checklist, item.tick.itemId, true),
      });
      toast.push({ kind: "success", message: "Done", detail: item.title });
      router.refresh();
    } catch (error) {
      setTicked((s) => {
        const next = new Set(s);
        next.delete(item.key);
        return next;
      });
      toast.push({ kind: "error", message: "Could not tick it off", detail: (error as Error).message });
    }
  };

  return (
    <>
      <PageHeader
        title={isMe || !person ? "My work" : `${person}’s work`}
        icon={<CircleUserRound className="size-4" />}
        actions={
          people.length > 1 && (
            <Menu
              align="end"
              trigger={
                <button className="rb-btn rb-btn-sm">
                  {person && <ActorAvatar name={person} size={16} />} {isMe ? "Me" : person} <ChevronDown className="size-3.5 text-faint" />
                </button>
              }
            >
              {people.map((p) => (
                <MenuItem key={p} icon={<ActorAvatar name={p} size={16} />} checked={p.toLowerCase() === key} onSelect={() => choose(p)}>
                  {viewer && p.toLowerCase() === viewer.toLowerCase() ? `${p} (me)` : p}
                </MenuItem>
              ))}
            </Menu>
          )
        }
      />
      <div className="rb-under-header rb-scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[860px] flex-col gap-10 px-6 pb-20 pt-8 sm:px-10">
          {items.length === 0 ? (
            <EmptyState
              icon={<CircleUserRound className="size-7" />}
              title={isMe ? "Nothing assigned to you" : `Nothing assigned to ${person || "anyone"} yet`}
              body="Assign a card, or an item inside a card, to a person — or write @name on a checklist item — and it shows up here."
            />
          ) : (
            GROUPS.map((group) => {
              const list = items.filter((i) => group.test(i.due == null ? null : daysUntil(i.due)));
              if (list.length === 0) return null;
              return (
                <section key={group.key} className="flex flex-col gap-1">
                  <h2 className={`flex items-baseline gap-2 pb-1 text-sm font-semibold ${group.key === "late" ? "text-danger" : "text-ink"}`}>
                    {group.title}
                    <span className="text-xs font-normal tabular-nums text-faint">{list.length}</span>
                  </h2>
                  {list.map((item) => (
                    <Row key={item.key} item={item} onTick={tick} />
                  ))}
                </section>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
