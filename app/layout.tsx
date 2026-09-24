import type { Metadata } from "next";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { getRepoIdentity } from "@/lib/board-service";
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
  const identity = getRepoIdentity();
  const token = await getAuthProvider().getToken();
  const repo = identity.configured
    ? `${identity.configured.owner}/${identity.configured.name}`
    : null;

  return (
    <html lang="en">
      <body>
        <div className="flex h-screen w-full overflow-hidden bg-canvas">
          <Sidebar repo={repo} connected={Boolean(token && repo)} />
          <main className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
