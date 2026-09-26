import { notFound } from "next/navigation";
import { CardPage } from "@/components/card/CardPage";
import { findCardBoard } from "@/lib/board-service";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

/** /board/card/<id> or /board/card/RB-12, on whichever board the card is. */
export default async function CardRoute({ params }: { params: { id: string } }) {
  const found = findCardBoard(decodeURIComponent(params.id));
  const { data, connected } = await getPageContext(found?.boardId ?? null);
  const task = found ? data.tasks.find((t) => t.id === found.taskId) : undefined;
  if (!task) notFound();
  return <CardPage key={task.id} task={task} data={data} connected={connected} />;
}
