import { ActivityScreen } from "@/components/ActivityScreen";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const { data, header, connected } = await getPageContext();

  return (
    <ActivityScreen
      data={data}
      header={header}
      connected={connected}
    />
  );
}
