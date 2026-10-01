"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, GitBranch, RotateCw } from "lucide-react";
import { api, useResource, type DocsStatusInfo } from "@/lib/client/api";
import { checkDocs } from "@/components/shell/DocsWatch";
import { useShell } from "@/components/shell/ShellContext";
import { Menu, MenuItem, MenuLabel, RelativeTime, useToast } from "@/components/ui";

/**
 * Where the documents come from and when RepoBoard last looked: "Read from
 * main at a1b2c3d, checked 20 s ago", with Check now. RepoBoard also looks by
 * itself every minute (DocsWatch).
 */
export function DocsSource({ className = "" }: { className?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [status, setStatus] = useState<DocsStatusInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const { role } = useShell();
  const [picking, setPicking] = useState(false);
  const branches = useResource(api.branches, [], { enabled: picking });

  useEffect(() => {
    void api.docsStatus().then((r) => setStatus(r.status)).catch(() => null);
    const onStatus = (event: Event) => setStatus((event as CustomEvent<DocsStatusInfo>).detail);
    window.addEventListener("rb-docs-status", onStatus);
    return () => window.removeEventListener("rb-docs-status", onStatus);
  }, []);

  const now = async () => {
    setBusy(true);
    try {
      const result = await checkDocs(true);
      const found = [
        result.added.length ? `${result.added.length} new` : null,
        result.removed.length ? `${result.removed.length} gone` : null,
        result.refreshed ? `${result.refreshed} changed` : null,
      ].filter(Boolean);
      toast.push({ kind: "success", message: found.length ? `Documents: ${found.join(", ")}` : "Documents are up to date", detail: `${result.branch}${result.commit ? ` at ${result.commit.slice(0, 7)}` : ""}` });
      router.refresh();
      window.dispatchEvent(new Event("rb-live"));
    } catch (error) {
      toast.push({ kind: "error", message: "Could not read GitHub", detail: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const choose = async (name: string) => {
    if (!status || name === status.branch) return;
    try {
      await api.setDocsBranch(name === status.defaultBranch ? null : name);
      await now();
    } catch (error) {
      toast.push({ kind: "error", message: "Could not switch the branch", detail: (error as Error).message });
    }
  };

  if (!status) return null;
  const elsewhere = status.plan && status.plan.mode !== "main";
  const branchName = <span className="font-mono text-muted">{status.branch}</span>;
  if (elsewhere) {
    // The plan is kept apart from the code (Settings → Where the plan is kept): no branch to pick here.
    return (
      <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-faint ${className}`}>
        <span>
          Read from{" "}
          <Link href="/settings" className="font-mono text-muted hover:text-ink">
            {status.plan.mode === "repo" ? status.plan.repo : "the repoboard branch"}
          </Link>
          {status.checkedAt ? (
            <>
              , checked <RelativeTime value={status.checkedAt} />
            </>
          ) : (
            ", not checked yet"
          )}
        </span>
        <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-ink disabled:opacity-60" disabled={busy} onClick={() => void now()}>
          <RotateCw className={`size-3 ${busy ? "animate-spin" : ""}`} /> Check now
        </button>
      </p>
    );
  }
  return (
    <p className={`flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-faint ${className}`}>
      <span>
        Read from{" "}
        {role === "manager" ? (
          // Admins choose the branch the documents live on; commits go there too.
          <Menu
            width={260}
            trigger={
              <button type="button" className="inline-flex items-center gap-0.5 hover:text-ink" onPointerDown={() => setPicking(true)}>
                {branchName}
                <ChevronDown className="size-3" />
              </button>
            }
          >
            <MenuLabel>Read and commit documents on</MenuLabel>
            {(branches.data?.branches ?? [{ name: status.branch }]).map((b) => (
              <MenuItem key={b.name} icon={<GitBranch className="size-3.5" />} checked={b.name === status.branch} onSelect={() => void choose(b.name)}>
                {b.name}
                {b.name === status.defaultBranch ? " (default)" : ""}
              </MenuItem>
            ))}
          </Menu>
        ) : (
          branchName
        )}
        {status.commit && (
          <>
            {" "}at <span className="font-mono text-muted">{status.commit.slice(0, 7)}</span>
          </>
        )}
        {status.checkedAt ? (
          <>
            , checked <RelativeTime value={status.checkedAt} />
          </>
        ) : (
          ", not checked yet"
        )}
      </span>
      <button type="button" className="inline-flex items-center gap-1 text-muted hover:text-ink disabled:opacity-60" disabled={busy} onClick={() => void now()}>
        <RotateCw className={`size-3 ${busy ? "animate-spin" : ""}`} /> Check now
      </button>
    </p>
  );
}
