import { RepositoryScreen } from "@/components/RepositoryScreen";
import { getPageContext } from "@/lib/page-context";
import { getProjectData } from "@/lib/board-service";

export const dynamic = "force-dynamic";

const TABS = ["graph", "branches", "commits", "pulls", "issues"] as const;
type Tab = (typeof TABS)[number];

export default async function RepositoryPage({ searchParams }: { searchParams: { tab?: string } }) {
  const context = await getPageContext();
  const { header, connected } = context;
  // Cards are looked up on every board, not only the main one.
  const data = connected ? getProjectData(context.who) : context.data;
  const requested = searchParams.tab as Tab | undefined;
  const initialTab: Tab = requested && TABS.includes(requested) ? requested : "graph";
  return <RepositoryScreen data={data} header={header} connected={connected} initialTab={initialTab} />;
}
