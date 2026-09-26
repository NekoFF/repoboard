import { BoardScreen } from "@/components/BoardScreen";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const { data, header, connected } = await getPageContext();

  return (
    <BoardScreen
      data={data}
      header={header}
      connected={connected}
    />
  );
}
