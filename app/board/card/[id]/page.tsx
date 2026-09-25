import { notFound } from "next/navigation";
import { CardPage } from "@/components/card/CardPage";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

/** /board/card/<id> or /board/card/RB-12 */
export default async function CardRoute({ params }: { params: { id: string } }) {
  const { data, connected } = await getPageContext();
  const ref = decodeURIComponent(params.id);
  const number = ref.match(/^(?:rb-)?(\d+)$/i)?.[1];
  const task = number
    ? data.tasks.find((t) => t.number === Number(number))
    : data.tasks.find((t) => t.id === ref);
  if (!task) notFound();
  return <CardPage key={task.id} task={task} data={data} connected={connected} />;
}
