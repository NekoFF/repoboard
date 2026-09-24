import { BoardScreen } from "@/components/BoardScreen";
import {
  ensureRepositoryRow,
  getBoardData,
  getRepoHeader,
} from "@/lib/board-service";
import { getAuthProvider } from "@/lib/github/auth-provider";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const token = await getAuthProvider().getToken();
  if (token) {
    try {
      await ensureRepositoryRow();
    } catch {
      /* offline: fall through to whatever is already stored locally */
    }
  }

  const data = getBoardData();
  const header = getRepoHeader();

  return (
    <BoardScreen
      data={data}
      header={header}
      connected={Boolean(token && header.name)}
    />
  );
}
