import { MarkdownSyncScreen } from "@/components/MarkdownSyncScreen";
import { getBoardData, getRepoHeader } from "@/lib/board-service";
import { getAuthProvider } from "@/lib/github/auth-provider";

export const dynamic = "force-dynamic";

export default async function MarkdownSyncPage() {
  const data = getBoardData();
  const header = getRepoHeader();
  const token = await getAuthProvider().getToken();
  return (
    <MarkdownSyncScreen
      data={data}
      header={header}
      connected={Boolean(token && header.name)}
    />
  );
}
