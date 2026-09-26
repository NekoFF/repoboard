"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { CalendarDays, CircleDot, Filter, Flag, ListFilter, User, X } from "lucide-react";
import type { BoardData } from "@/lib/board-service";
import {
  addToken,
  describeToken,
  joinQuery,
  removeToken,
  splitQuery,
  token,
  tokenize,
} from "@/lib/client/filters";
import { Menu, MenuItem, MenuLabel, MenuSeparator, PriorityIcon, StatusIcon } from "@/components/ui";
import { displayLabel, labelColor } from "@/components/labelColor";
import { PRIORITY_LABEL, STATUS_LABEL, type Status } from "@/lib/status";

export interface FilterBarHandle {
  focus: () => void;
}

/**
 * One line that filters the board. Operators become chips as soon as they are
 * complete ("label:bug " or Enter); the Filter menu writes the same operators,
 * so the text and the chips can never disagree.
 */
export const FilterBar = forwardRef<
  FilterBarHandle,
  { data: BoardData; query: string; onChange: (query: string) => void; matches: number }
>(function FilterBar({ data, query, onChange, matches }, ref) {
  const inputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => inputRef.current?.focus() }));

  // What is in the input box. Operators typed there stay text until a space or
  // Enter completes them — "label:b" must not become a chip mid-word.
  const [draft, setDraft] = useState(() => splitQuery(query).text);
  useEffect(() => {
    if (!query) setDraft("");
  }, [query]);

  const draftTokens = new Set(tokenize(draft));
  const operators = splitQuery(query).operators.filter((op) => !draftTokens.has(op));
  const text = draft;

  const commitDraft = () => {
    const { text: words } = splitQuery(draft);
    setDraft(words ? `${words} ` : "");
  };

  const labels = Array.from(new Set(data.tasks.flatMap((t) => t.labels))).sort();
  const assignees = Array.from(new Set(data.tasks.map((t) => t.assignee).filter(Boolean) as string[])).sort();
  const add = (t: string) => onChange(addToken(query, t));

  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
      <Menu
        width={240}
        trigger={
          <button className="rb-btn rb-btn-sm">
            <ListFilter className="size-3.5" /> Filter
          </button>
        }
      >
        <MenuLabel>Status</MenuLabel>
        {(["todo", "doing", "review", "done"] as Status[]).map((s) => (
          <MenuItem key={s} icon={<StatusIcon status={s} />} onSelect={() => add(token.status(s))}>
            {STATUS_LABEL[s]}
          </MenuItem>
        ))}
        <MenuItem icon={<CircleDot className="size-3.5" />} onSelect={() => add("is:open")}>
          Anything not done
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Priority</MenuLabel>
        {[1, 2, 3, 4, 0].map((p) => (
          <MenuItem key={p} icon={<PriorityIcon priority={p} />} onSelect={() => add(token.priority(p))}>
            {PRIORITY_LABEL[p]}
          </MenuItem>
        ))}
        <MenuSeparator />
        <MenuLabel>Due</MenuLabel>
        <MenuItem icon={<CalendarDays className="size-3.5" />} onSelect={() => add(token.due("overdue"))}>
          Overdue
        </MenuItem>
        <MenuItem icon={<CalendarDays className="size-3.5" />} onSelect={() => add(token.due("week"))}>
          Due in the next 7 days
        </MenuItem>
        <MenuItem icon={<CalendarDays className="size-3.5" />} onSelect={() => add(token.due("none"))}>
          No due date
        </MenuItem>
        {data.milestones.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Milestone</MenuLabel>
            {data.milestones.map((m) => (
              <MenuItem key={m.id} icon={<Flag className="size-3.5" />} onSelect={() => add(token.milestone(m.name))}>
                {m.name}
              </MenuItem>
            ))}
          </>
        )}
        {labels.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Label</MenuLabel>
            {labels.map((l) => (
              <MenuItem
                key={l}
                icon={<span className="size-2 rounded-full" style={{ backgroundColor: labelColor(l) }} />}
                onSelect={() => add(token.label(l))}
              >
                {displayLabel(l)}
              </MenuItem>
            ))}
          </>
        )}
        {assignees.length > 0 && (
          <>
            <MenuSeparator />
            <MenuLabel>Assignee</MenuLabel>
            {assignees.map((a) => (
              <MenuItem key={a} icon={<User className="size-3.5" />} onSelect={() => add(token.assignee(a))}>
                {a}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>

      {operators.map((op) => {
        const { key, value } = describeToken(op);
        return (
          <span
            key={op}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border bg-pill pl-2 text-xs"
          >
            <span className="text-muted">{key}</span>
            <span className="max-w-[160px] truncate font-medium text-ink">{value}</span>
            <button
              className="grid size-6 place-items-center rounded-md text-faint hover:text-ink"
              aria-label={`Remove ${key} ${value}`}
              onClick={() => onChange(removeToken(query, op))}
            >
              <X className="size-3" />
            </button>
          </span>
        );
      })}

      <label className="flex h-7 min-w-[160px] flex-1 items-center gap-1.5 px-1 text-sm">
        <Filter className="size-3.5 shrink-0 text-faint" />
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint"
          placeholder={operators.length ? "Add words or filters…" : "Filter cards — try label:bug  @name  !high  due:week"}
          aria-label="Filter cards"
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            setDraft(value);
            onChange(joinQuery(operators, value));
            if (value.endsWith(" ") && splitQuery(value).operators.length) {
              const { text: words } = splitQuery(value);
              setDraft(words ? `${words} ` : "");
            }
          }}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitDraft();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              if (query) onChange("");
              else inputRef.current?.blur();
            }
            if (event.key === "Backspace" && !text && operators.length) {
              onChange(removeToken(query, operators[operators.length - 1]));
            }
          }}
        />
      </label>

      {query && (
        <span className="flex items-center gap-1 text-xs text-faint">
          {matches} match{matches === 1 ? "" : "es"}
          <button
            className="rb-btn-ghost"
            onClick={() => {
              setDraft("");
              onChange("");
            }}
          >
            Clear
          </button>
        </span>
      )}
    </div>
  );
});
