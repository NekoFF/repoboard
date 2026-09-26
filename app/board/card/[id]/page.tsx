import { notFound } from "next/navigation";
import { CardPage } from "@/components/card/CardPage";
import { findCardBoard } from "@/lib/board-service";
import { listDocs } from "@/lib/docs-service";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

/** /board/card/<id> or /board/card/RB-12, on whichever board the card is. */
export default async function CardRoute({ params }: { params: { id: string } }) {
  const found = findCardBoard(decodeURIComponent(params.id));
  const { data, connected } = await getPageContext(found?.boardId ?? null);
  const task = found ? data.tasks.find((t) => t.id === found.taskId) : undefined;
  if (!task) notFound();
  // Checklist items anywhere in the project that name this card.
  const mentions =
    connected && task.number != null
      ? listDocs().flatMap((doc) =>
          doc.items
            .filter((item) => item.cards?.includes(task.number!))
            .map((item) => ({ path: doc.path, doc: doc.title, title: item.title, line: item.line, state: item.state ?? (item.done ? "done" : "todo") })),
        )
      : [];
  return <CardPage key={task.id} task={task} data={data} connected={connected} mentions={mentions} />;
}
