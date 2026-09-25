import { OverviewScreen } from "@/components/OverviewScreen";
import { listDocs } from "@/lib/docs-service";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const { data, header, connected } = await getPageContext();
  return <OverviewScreen data={data} header={header} docs={connected ? listDocs() : []} connected={connected} />;
}
