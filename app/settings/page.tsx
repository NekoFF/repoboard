import { SettingsScreen } from "@/components/SettingsScreen";
import { getBoardData, getRepoHeader } from "@/lib/board-service";
import { getAuthProvider, getConfiguredRepo } from "@/lib/github/auth-provider";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const data = getBoardData();
  const header = getRepoHeader();
  const provider = getAuthProvider();
  const token = await provider.getToken();
  const configured = getConfiguredRepo();

  return (
    <SettingsScreen
      data={data}
      header={header}
      connected={Boolean(token && header.name)}
      authLabel={provider.label}
      tokenSource={
        process.env.GITHUB_PAT ? "environment" : token ? "local file" : null
      }
      repoSlug={configured ? `${configured.owner}/${configured.name}` : ""}
    />
  );
}
