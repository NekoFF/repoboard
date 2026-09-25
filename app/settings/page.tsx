import path from "node:path";
import { SettingsScreen } from "@/components/SettingsScreen";
import { getAuthProvider, isEnvironmentConfigured } from "@/lib/github/auth-provider";
import { credentialsPath, databasePath } from "@/lib/paths";

export const dynamic = "force-dynamic";

// Settings stays reachable without a working connection: it is where you fix one.
export default async function SettingsPage() {
  const provider = getAuthProvider();
  const token = await provider.getToken();
  return (
    <SettingsScreen
      authLabel={provider.label}
      tokenSource={process.env.GITHUB_PAT ? "environment" : token ? "local file" : null}
      managedByEnvironment={isEnvironmentConfigured()}
      paths={{
        database: databasePath(),
        credentials: credentialsPath(),
        mcpServer: path.join(process.cwd(), "scripts", "mcp-server.mjs"),
      }}
    />
  );
}
