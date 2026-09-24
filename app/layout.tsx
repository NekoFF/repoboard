import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getRepoHeader } from "@/lib/board-service";
import { getAuthProvider } from "@/lib/github/auth-provider";

export const metadata: Metadata = {
  title: "RepoBoard",
  description: "Local-first project board wired to a GitHub repository.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const header = getRepoHeader();
  const token = await getAuthProvider().getToken();
  const repo = header.name ? `${header.owner}/${header.name}` : null;

  return (
    <html lang="en">
      <body>
        <AppShell repo={repo} connected={Boolean(token && repo)}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
