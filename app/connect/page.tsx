import { ConnectScreen } from "@/components/connect/ConnectScreen";
import { isEnvironmentConfigured, listProjects } from "@/lib/github/auth-provider";
import { repoSlug } from "@/lib/github/slug";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect" };

/** First start, a new project, or a new key for one (?repo=owner/name). Reachable without a working connection. */
export default function ConnectPage({ searchParams }: { searchParams: { repo?: string } }) {
  if (isEnvironmentConfigured()) redirect("/settings");
  const projects = listProjects();
  const replacing = searchParams.repo ? repoSlug(searchParams.repo) : null;
  return (
    <ConnectScreen
      replacing={replacing && replacing.includes("/") ? replacing : null}
      connectedRepos={projects.map((p) => p.repo.toLowerCase())}
      canClose={projects.length > 0}
    />
  );
}
