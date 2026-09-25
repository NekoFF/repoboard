import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { getVerifiedRepository } from "@/lib/github/access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "RepoBoard",
  description: "Local-first project board wired to a GitHub repository.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const verified = await getVerifiedRepository();
  const repo = verified ? `${verified.owner}/${verified.name}` : null;

  return (
    <html lang="en">
      <body>
        <AppShell repo={repo} connected={Boolean(verified)}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
