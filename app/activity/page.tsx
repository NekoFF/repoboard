import { ActivityScreen } from "@/components/ActivityScreen";
import { getPageContext } from "@/lib/page-context";
import { getProjectData } from "@/lib/board-service";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const context = await getPageContext();
  const { header, connected } = context;
  // Cards are looked up on every board, not only the main one.
  const data = connected ? getProjectData(context.who) : context.data;

  return (
    <ActivityScreen
      data={data}
      header={header}
      connected={connected}
    />
  );
}
