import { BoardsScreen } from "@/components/BoardsScreen";
import { listArchivedBoards, listBoards } from "@/lib/board-service";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function BoardsPage() {
  const { connected, who } = await getPageContext();
  return <BoardsScreen boards={connected ? listBoards(who) : []} archived={connected ? listArchivedBoards() : []} />;
}
