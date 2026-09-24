import { RepositoryScreen } from "@/components/RepositoryScreen";
import { getBoardData, getRepoHeader } from "@/lib/board-service";
import { getAuthProvider } from "@/lib/github/auth-provider";

export const dynamic = "force-dynamic";

const TABS = ["branches", "commits", "pulls", "issues"] as const;
type Tab = (typeof TABS)[number];

export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const data = getBoardData();
  const header = getRepoHeader();
  const token = await getAuthProvider().getToken();
  const requested = searchParams.tab as Tab | undefined;
  const initialTab: Tab =
    requested && TABS.includes(requested) ? requested : "branches";

  return (
    <RepositoryScreen
      data={data}
      header={header}
      connected={Boolean(token && header.name)}
      initialTab={initialTab}
    />
  );
}
