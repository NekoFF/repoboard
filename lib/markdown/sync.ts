import { diffLines } from "diff";

/**
 * Conflict rules for Markdown writes.
 *
 * The invariant: RepoBoard never overwrites a file whose remote SHA moved since
 * the copy it based its edit on. The check is pure so it is unit-testable
 * without touching the network; the Contents API `sha` parameter enforces the
 * same rule a second time on GitHub's side.
 */

export type ConflictCheck =
  | { ok: true }
  | {
      ok: false;
      reason: "sha_mismatch" | "missing_base";
      expectedSha: string | null;
      currentSha: string;
    };

export function checkWriteSafety(
  expectedSha: string | null | undefined,
  currentSha: string,
): ConflictCheck {
  if (!expectedSha) {
    return {
      ok: false,
      reason: "missing_base",
      expectedSha: expectedSha ?? null,
      currentSha,
    };
  }
  if (expectedSha !== currentSha) {
    return {
      ok: false,
      reason: "sha_mismatch",
      expectedSha,
      currentSha,
    };
  }
  return { ok: true };
}

export type DiffLine = {
  type: "add" | "del" | "context";
  text: string;
};

/** Compact line diff for the preview shown before any GitHub write. */
export function buildDiff(
  before: string,
  after: string,
  contextLines = 2,
): DiffLine[] {
  const parts = diffLines(before, after);
  const out: DiffLine[] = [];

  parts.forEach((part, index) => {
    const lines = part.value.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();

    if (part.added || part.removed) {
      for (const text of lines) {
        out.push({ type: part.added ? "add" : "del", text });
      }
      return;
    }

    // Trim untouched regions down to a few lines of context.
    const isFirst = index === 0;
    const isLast = index === parts.length - 1;
    if (lines.length <= contextLines * 2) {
      for (const text of lines) out.push({ type: "context", text });
      return;
    }
    if (!isFirst) {
      for (const text of lines.slice(0, contextLines)) {
        out.push({ type: "context", text });
      }
    }
    if (!isLast) {
      for (const text of lines.slice(-contextLines)) {
        out.push({ type: "context", text });
      }
    }
  });

  return out;
}

export function diffStats(diff: DiffLine[]): {
  additions: number;
  deletions: number;
} {
  return {
    additions: diff.filter((d) => d.type === "add").length,
    deletions: diff.filter((d) => d.type === "del").length,
  };
}

export function commitMessageForMove(summary: string): string {
  return `RepoBoard: ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`;
}
