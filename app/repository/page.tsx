import { RepositoryScreen } from "@/components/RepositoryScreen";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

const TABS = ["branches", "commits", "pulls", "issues"] as const;
type Tab = (typeof TABS)[number];

export default async function RepositoryPage({
  searchParams,
}: {
  searchParams: { tab?: string };
}) {
  const { data, header, connected } = await getPageContext();
  const requested = searchParams.tab as Tab | undefined;
  const initialTab: Tab =
    requested && TABS.includes(requested) ? requested : "branches";

  return (
    <RepositoryScreen
      data={data}
      header={header}
      connected={connected}
      initialTab={initialTab}
    />
  );
}
