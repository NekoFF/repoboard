import fs from "node:fs";
import path from "node:path";
import { SettingsScreen } from "@/components/SettingsScreen";
import { agentPolicy } from "@/lib/board-service";
import { agentDocsMode } from "@/lib/docs-service";
import { getAuthProvider, isEnvironmentConfigured } from "@/lib/github/auth-provider";
import { credentialsPath, databasePath } from "@/lib/paths";

export const dynamic = "force-dynamic";

/**
 * Windows: the copy of the MCP server that updates do not close
 * (desktop/mcp-home.cjs), once the app has made it; null until then or elsewhere.
 */
function mcpCopy(): { node: string; server: string } | null {
  const home = process.env.REPOBOARD_MCP_HOME;
  if (!home) return null;
  try {
    const ready = JSON.parse(fs.readFileSync(path.join(home, "ready.json"), "utf8"));
    return typeof ready.node === "string" && typeof ready.server === "string" && fs.existsSync(ready.node) && fs.existsSync(ready.server)
      ? { node: ready.node, server: ready.server }
      : null;
  } catch {
    return null;
  }
}

// Settings stays reachable without a working connection: it is where you fix one.
export default async function SettingsPage() {
  const desktop = process.env.REPOBOARD_DESKTOP === "1";
  const provider = getAuthProvider();
  const token = await provider.getToken();
  const copy = mcpCopy();
  return (
    <SettingsScreen
      agentPolicy={agentPolicy()}
      agentDocs={agentDocsMode()}
      version={{ number: process.env.REPOBOARD_APP_VERSION || process.env.REPOBOARD_VERSION || "dev", desktop }}
      authLabel={provider.label}
      tokenSource={process.env.GITHUB_PAT ? "environment" : token ? "local file" : null}
      managedByEnvironment={isEnvironmentConfigured()}
      paths={{
        database: databasePath(),
        credentials: credentialsPath(),
        mcpServer:
          copy?.server ??
          (desktop ? path.join(process.cwd(), "mcp", "mcp-server.mjs") : path.join(process.cwd(), "scripts", "mcp-server.mjs")),
      }}
      mcp={{
        // An absolute path: Claude Desktop and Cursor, started from the Dock,
        // do not have the terminal's PATH (nvm, Homebrew).
        node: copy?.node ?? (process.env.REPOBOARD_NODE || process.execPath),
        // Settings the agent needs to reach the same database and repository
        // as this app. Never the token: that stays in the credentials file.
        env: {
          ...(desktop ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
          ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
          ...(process.env.GITHUB_API_URL ? { GITHUB_API_URL: process.env.GITHUB_API_URL } : {}),
          ...(process.env.GITHUB_REPO ? { GITHUB_REPO: process.env.GITHUB_REPO } : {}),
        },
      }}
    />
  );
}
