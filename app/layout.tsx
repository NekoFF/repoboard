import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { THEME_SCRIPT } from "@/components/shell/ThemeProvider";
import { getAccessState, getViewer } from "@/lib/github/access";
import { isEnvironmentConfigured, listProjects } from "@/lib/github/auth-provider";
import { listBoards, projectSummaries } from "@/lib/board-service";
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
  const access = await getAccessState();
  const verified = access.state === "ok" ? access.repo : null;
  const repo = verified ? `${verified.owner}/${verified.name}` : null;

  const list = listProjects();
  const stats = projectSummaries(list.map((p) => p.repo));
  // Without a verified token only the names are sent (so a broken project can
  // be switched away from or disconnected); counts are board data.
  const projects = list.map((p) => (verified ? { ...p, ...stats.get(p.repo.toLowerCase()) } : p));

  // Only once GitHub has accepted the token: nothing about a repository is
  // shown to someone who cannot currently open it.
  const docs = verified
    ? listDocs()
        .filter((d) => d.pinned)
        .map((d) => ({
          id: d.id,
          path: d.path,
          title: d.title,
          role: d.role,
          kind: d.kind,
          done: d.done,
          total: d.total,
          review: d.review,
        }))
    : [];
  const viewer = verified ? await getViewer() : null;
  const boards = verified
    ? listBoards().map((b) => ({ id: b.id, name: b.name, color: b.color, owner: b.owner, primary: b.primary, open: b.open }))
    : [];

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AppShell
          repo={repo}
          viewer={viewer}
          connected={Boolean(verified)}
          projects={projects}
          docs={docs}
          boards={boards}
          managedByEnvironment={isEnvironmentConfigured()}
          problem={access.state === "failed" ? { slug: access.slug, reason: access.reason, message: access.message } : null}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
