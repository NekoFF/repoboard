import { BoardsScreen } from "@/components/BoardsScreen";
import { listBoards } from "@/lib/board-service";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function BoardsPage() {
  const { connected } = await getPageContext();
  return <BoardsScreen boards={connected ? listBoards() : []} />;
}
