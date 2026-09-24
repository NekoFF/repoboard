import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { getActivity, getBoardData, getRepoHeader } from "@/lib/board-service";
import { getAuthProvider } from "@/lib/github/auth-provider";

export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const data = getBoardData();
  const header = getRepoHeader();
  const token = await getAuthProvider().getToken();
  const connected = Boolean(token && header.name);
  const events = getActivity(12);

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSync={
          header.lastSyncAt
            ? new Date(header.lastSyncAt).toLocaleTimeString()
            : null
        }
        connected={connected}
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-[18px] overflow-y-auto p-[22px]">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-semibold text-ink">Overview</h1>
          <p className="text-[12px] text-muted">
            GitHub is the source of truth. RepoBoard stores only board state,
            links and sync bookkeeping.
          </p>
        </div>

        {!connected && (
          <div className="rb-card flex flex-col gap-2 p-4">
            <p className="text-[13px] font-semibold text-ink">
              No repository connected
            </p>
            <p className="text-[12px] text-muted">
              Add a fine-grained personal access token and a repository to start.
            </p>
            <Link href="/settings" className="rb-btn-primary w-fit">
              Connect GitHub
            </Link>
          </div>
        )}

        {connected && data.repository && (
          <div className="flex w-full gap-[10px]">
            {[
              { label: "Repository", value: data.repository.name },
              { label: "Default branch", value: data.repository.defaultBranch },
              { label: "Visibility", value: data.repository.visibility },
              { label: "Cards", value: String(data.tasks.length) },
              {
                label: "Markdown source",
                value: data.markdownSource?.path ?? "not set",
              },
            ].map((stat) => (
              <div
                key={stat.label}
                className="flex min-w-0 flex-1 flex-col gap-[3px] rounded-lg border border-border bg-surface p-3"
              >
                <span className="truncate text-[14px] font-semibold text-ink">
                  {stat.value}
                </span>
                <span className="text-[11px] text-muted">{stat.label}</span>
              </div>
            ))}
          </div>
        )}

        <div className="rb-card flex flex-col gap-[9px] p-[14px]">
          <span className="text-[14px] font-semibold text-ink">
            Recent activity
          </span>
          {events.length === 0 && (
            <span className="text-[12px] text-muted">Nothing logged yet.</span>
          )}
          {events.map((event) => (
            <div key={event.id} className="border-t border-border p-2">
              <p className="text-[12px] font-medium text-ink">{event.message}</p>
              <p className="text-[11px] text-muted">
                {event.type} · {new Date(event.createdAt).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
