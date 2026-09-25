import { DocsIndex } from "@/components/docs/DocsIndex";
import { DocScreen } from "@/components/docs/DocScreen";
import { listDocs } from "@/lib/docs-service";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function DocsPage({ searchParams }: { searchParams: { path?: string } }) {
  const { connected } = await getPageContext();
  if (searchParams.path) return <DocScreen key={searchParams.path} path={searchParams.path} />;
  return <DocsIndex docs={connected ? listDocs() : []} />;
}
