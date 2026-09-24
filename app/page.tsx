import { OverviewScreen } from "@/components/OverviewScreen";
import {
  ensureRepositoryRow,
  getBoardData,
  getRepoHeader,
} from "@/lib/board-service";
import { getAuthProvider } from "@/lib/github/auth-provider";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const token = await getAuthProvider().getToken();
  if (token) {
    try {
      await ensureRepositoryRow();
    } catch {
      /* offline: show whatever is stored locally */
    }
  }

  const data = getBoardData();
  const header = getRepoHeader();

  return (
    <OverviewScreen
      data={data}
      header={header}
      connected={Boolean(token && header.name)}
    />
  );
}
