import { SettingsScreen } from "@/components/SettingsScreen";
import { getAuthProvider } from "@/lib/github/auth-provider";
import { getPageContext } from "@/lib/page-context";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const { data, header, connected } = await getPageContext();
  const provider = getAuthProvider();
  const token = await provider.getToken();

  return (
    <SettingsScreen
      data={data}
      header={header}
      connected={connected}
      authLabel={provider.label}
      tokenSource={
        process.env.GITHUB_PAT ? "environment" : token ? "local file" : null
      }
    />
  );
}
