import { OverviewScreen } from "@/components/OverviewScreen";
import { getBoardData, listBoards } from "@/lib/board-service";
import { listDocs } from "@/lib/docs-service";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { data, header, connected, who } = await getPageContext();
  const boards = connected ? listBoards(who).map((info) => ({ info, data: getBoardData(info.id) })) : [];
  return (
    <OverviewScreen data={data} header={header} docs={connected ? listDocs() : []} boards={boards} connected={connected} />
  );
}
