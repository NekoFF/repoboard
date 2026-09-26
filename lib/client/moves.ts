"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import type { BoardData } from "@/lib/board-service";
import { api } from "@/lib/client/api";
import { useToast } from "@/components/ui";

/**
 * The one path for every way a card changes column — drag, the tick, the
 * keyboard, the list, the card page — so a markdown-backed card always joins
 * the queue of changes that are reviewed before anything is written to
 * GitHub, and every move offers the same undo.
 *
 * `orderedIds` is the target column's order after the move. The optional
 * callbacks let a screen with optimistic state put it back.
 */
export function useCommitMove(
  data: BoardData,
  local: { revert?: () => void; undo?: (taskId: string, columnId: string) => void } = {},
) {
  const router = useRouter();
  const toast = useToast();
  const { revert, undo } = local;

  return useCallback(
    async (taskId: string, targetColumnId: string, orderedIds: string[]) => {
      const original = data.tasks.find((t) => t.id === taskId);
      if (!original) return;
      const changedColumn = original.columnId !== targetColumnId;
      const currentOrder = data.tasks
        .filter((t) => t.columnId === targetColumnId)
        .sort((a, b) => a.position - b.position)
        .map((t) => t.id);
      // Dropped back where it was: nothing to write (and nothing to make "newer").
      if (!changedColumn && currentOrder.join() === orderedIds.join()) return;

      try {
        if (changedColumn) {
          await api.boardAction({
            boardId: data.boardId,
            action: "move",
            taskId,
            columnId: targetColumnId,
            position: Math.max(orderedIds.indexOf(taskId), 0),
          });
        }
        if (changedColumn || currentOrder.join() !== orderedIds.join()) {
          await api.boardAction({ boardId: data.boardId, action: "reorder", columnId: targetColumnId, orderedIds });
        }

        if (changedColumn) {
          const heading = data.columns.find((c) => c.id === targetColumnId)?.name;
          const from = data.columns.find((c) => c.id === original.columnId)?.name;
          const back = data.tasks
            .filter((t) => t.columnId === original.columnId && t.id !== taskId)
            .sort((a, b) => a.position - b.position)
            .map((t) => t.id);
          back.splice(Math.min(original.position, back.length), 0, taskId);
          toast.push({
            kind: "success",
            message: `Moved to ${heading}`,
            detail: original.markdownTaskId
              ? "Queued for the next commit to the markdown file"
              : from
                ? `${original.title} · was ${from}`
                : undefined,
            action: {
              label: "Undo",
              run: () => {
                undo?.(taskId, original.columnId);
                void api
                  .boardAction({ boardId: data.boardId, action: "move", taskId, columnId: original.columnId, position: original.position })
                  .then(() => api.boardAction({ boardId: data.boardId, action: "reorder", columnId: original.columnId, orderedIds: back }))
                  .finally(() => {
                    window.dispatchEvent(new CustomEvent("rb:pending-changed"));
                    router.refresh();
                  });
              },
            },
          });
          window.dispatchEvent(new CustomEvent("rb:pending-changed"));
        }
        router.refresh();
      } catch (error) {
        revert?.();
        toast.push({ kind: "error", message: "Could not move the card", detail: (error as Error).message });
      }
    },
    [data, router, toast, revert, undo],
  );
}

/** Moves a card to the end of another column through the same path. */
export function orderAfterMove(data: BoardData, taskId: string, columnId: string): string[] {
  return [
    ...data.tasks
      .filter((t) => t.columnId === columnId && t.id !== taskId)
      .sort((a, b) => a.position - b.position)
      .map((t) => t.id),
    taskId,
  ];
}
