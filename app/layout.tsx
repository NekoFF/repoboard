import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { THEME_SCRIPT } from "@/components/shell/ThemeProvider";
import { getVerifiedRepository } from "@/lib/github/access";
import { isEnvironmentConfigured, listProjects } from "@/lib/github/auth-provider";
import { projectSummaries } from "@/lib/board-service";
import { listDocs } from "@/lib/docs-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "RepoBoard", template: "%s · RepoBoard" },
  description: "A project board and checklist tracker that lives in your GitHub repository.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f6f4" },
    { media: "(prefers-color-scheme: dark)", color: "#111214" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const verified = await getVerifiedRepository();
  const repo = verified ? `${verified.owner}/${verified.name}` : null;

  const list = listProjects();
  const stats = projectSummaries(list.map((p) => p.repo));
  const projects = list.map((p) => ({ ...p, ...stats.get(p.repo.toLowerCase()) }));

  // Only once GitHub has accepted the token: nothing about a repository is
  // shown to someone who cannot currently open it.
  const docs = verified
    ? listDocs()
        .filter((d) => d.pinned)
        .map((d) => ({ id: d.id, path: d.path, title: d.title, role: d.role, done: d.done, total: d.total }))
    : [];

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AppShell
          repo={repo}
          connected={Boolean(verified)}
          projects={projects}
          docs={docs}
          managedByEnvironment={isEnvironmentConfigured()}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
