import { notFound } from "next/navigation";
import { BoardScreen } from "@/components/BoardScreen";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

/** Any board of the project other than the primary one (which lives at /board). */
export default async function OtherBoardPage({ params }: { params: { boardId: string } }) {
  const { data, header, connected } = await getPageContext(decodeURIComponent(params.boardId));
  if (connected && !data.boardId) notFound();
  return <BoardScreen key={data.boardId} data={data} header={header} connected={connected} />;
}
