/**
 * The five states an item can be in, shared by board cards and document
 * checkboxes so both read the same everywhere: same icon, same colour.
 */
export type Status = "todo" | "doing" | "review" | "done" | "cancelled";

export const STATUS_LABEL: Record<Status, string> = {
  todo: "Todo",
  doing: "In progress",
  review: "In review",
  done: "Done",
  cancelled: "Cancelled",
};

/** Board columns are free text; map the usual names onto a state. */
export function statusOfColumn(name: string | null | undefined): Status {
  const n = (name ?? "").trim().toLowerCase();
  if (/^(done|complete|completed|shipped|closed)$/.test(n)) return "done";
  if (/review|qa|testing|verify/.test(n)) return "review";
  if (/progress|doing|wip|active|started/.test(n)) return "doing";
  if (/cancel|won'?t|dropped|abandon/.test(n)) return "cancelled";
  return "todo";
}

export const PRIORITY_LABEL = ["No priority", "Urgent", "High", "Medium", "Low"] as const;

/** Sort key: urgent first, "no priority" last. */
export function prioritySort(priority: number): number {
  return priority === 0 ? 5 : priority;
}

/** Card reference as shown to people and written in commit messages. */
export function cardRef(number: number | null | undefined): string | null {
  return number == null ? null : `RB-${number}`;
}
