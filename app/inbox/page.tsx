import { InboxScreen } from "@/components/InboxScreen";
import { getBoardData, listBoards } from "@/lib/board-service";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "Inbox" };

export default async function InboxPage() {
  const { connected } = await getPageContext();
  const boards = connected ? listBoards().map((info) => ({ info, data: getBoardData(info.id) })) : [];
  return <InboxScreen boards={boards} />;
}
