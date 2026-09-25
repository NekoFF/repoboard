import { MarkdownSyncScreen } from "@/components/MarkdownSyncScreen";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function MarkdownSyncPage() {
  const { data, header, connected } = await getPageContext();
  return (
    <MarkdownSyncScreen
      data={data}
      header={header}
      connected={connected}
    />
  );
}
