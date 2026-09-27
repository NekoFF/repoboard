/**
 * The Inbox folds a burst of work into one entry: an agent that makes sixty
 * changes in one sitting shows as "Claude made 60 changes", which opens to the
 * list. A burst is one person's or agent's events with no pause longer than
 * `gapMs` between them, even when someone else worked at the same time.
 */

export interface InboxEvent {
  id: string;
  type: string;
  message: string;
  taskId: string | null;
  actor: string | null;
  actorKind: "person" | "agent" | null;
  createdAt: number;
}

export type InboxEntry<E extends InboxEvent> =
  | { kind: "event"; key: string; event: E }
  | { kind: "group"; key: string; actor: string | null; actorKind: E["actorKind"]; events: E[]; newest: number; oldest: number };

export const BURST_GAP_MS = 30 * 60_000;
/** Fewer than this stay as separate rows: two changes read fine on their own. */
export const BURST_MIN = 3;

/** Events newest first in, entries newest first out. */
export function groupEvents<E extends InboxEvent>(events: E[], gapMs = BURST_GAP_MS, min = BURST_MIN): InboxEntry<E>[] {
  const bursts: E[][] = [];
  const open = new Map<string, E[]>();
  for (const event of events) {
    const who = `${event.actorKind ?? ""}:${(event.actor ?? "").toLowerCase()}`;
    const burst = open.get(who);
    // Walking back in time: the burst's oldest event so far is its last one.
    if (burst && burst[burst.length - 1].createdAt - event.createdAt <= gapMs) {
      burst.push(event);
    } else {
      const next = [event];
      bursts.push(next);
      open.set(who, next);
    }
  }
  const entries: InboxEntry<E>[] = [];
  for (const burst of bursts) {
    if (burst.length < min) {
      for (const event of burst) entries.push({ kind: "event", key: event.id, event });
    } else {
      entries.push({
        kind: "group",
        key: `group:${burst[burst.length - 1].id}`,
        actor: burst[0].actor,
        actorKind: burst[0].actorKind,
        events: burst,
        newest: burst[0].createdAt,
        oldest: burst[burst.length - 1].createdAt,
      });
    }
  }
  const at = (e: InboxEntry<E>) => (e.kind === "event" ? e.event.createdAt : e.newest);
  return entries.sort((a, b) => at(b) - at(a));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "created 12 cards, moved 30, commented 18 times", and how many cards it touched. */
export function summarise(events: InboxEvent[]): { did: string; cards: number } {
  const count = (type: string) => events.filter((e) => e.type === type).length;
  const created = count("card_created");
  const moved = count("card_moved");
  const changed = count("card_updated");
  const comments = count("comment");
  const deleted = count("card_deleted");
  const restored = count("card_restored");
  const boards = count("board_created");
  const known = created + moved + changed + comments + deleted + restored + boards;
  const other = events.length - known;
  const parts = [
    created && `created ${plural(created, "card")}`,
    boards && `made ${plural(boards, "board")}`,
    moved && `moved ${created ? moved : plural(moved, "card")}`,
    changed && `changed ${changed}`,
    comments && `commented ${plural(comments, "time")}`,
    deleted && `deleted ${deleted}`,
    restored && `restored ${restored}`,
    other && `${other} more`,
  ].filter(Boolean) as string[];
  const cards = new Set(events.map((e) => e.taskId).filter(Boolean)).size;
  return { did: parts.join(", "), cards };
}
