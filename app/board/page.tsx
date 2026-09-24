import { BoardScreen } from "@/components/BoardScreen";
import {
  ensureRepositoryRow,
  getBoardData,
  getRepoHeader,
} from "@/lib/board-service";
import { getAuthProvider } from "@/lib/github/auth-provider";
import { GitHubClient } from "@/lib/github/client";

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
  const connected = Boolean(token && header.name);

  // Live counters come straight from GitHub; a failure here must not take the
  // board down, so they degrade to zero.
  let openPrs = 0;
  let branchCount = 0;
  if (connected) {
    try {
      const gh = await GitHubClient.create();
      const [pulls, branches] = await Promise.all([
        gh.listPullRequests(),
        gh.listBranches(),
      ]);
      openPrs = pulls.filter((p) => p.state === "open").length;
      branchCount = branches.length;
    } catch {
      /* offline or rate-limited: counters stay at zero */
    }
  }

  return (
    <BoardScreen
      data={data}
      header={header}
      connected={connected}
      openPrs={openPrs}
      branchCount={branchCount}
    />
  );
}
