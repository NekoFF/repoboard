import { MyWorkScreen } from "@/components/MyWorkScreen";
import { getBoardData, listBoards } from "@/lib/board-service";
import { listDocs } from "@/lib/docs-service";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";
export const metadata = { title: "My work" };

export default async function MyWorkPage() {
  const { connected, who } = await getPageContext();
  const boards = connected ? listBoards(who).map((info) => ({ info, data: getBoardData(info.id) })) : [];
  return <MyWorkScreen boards={boards} docs={connected ? listDocs() : []} />;
}
