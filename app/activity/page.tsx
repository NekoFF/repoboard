import { TopBar } from "@/components/TopBar";
import { getActivity, getBoardData, getRepoHeader } from "@/lib/board-service";
import { getAuthProvider } from "@/lib/github/auth-provider";

export const dynamic = "force-dynamic";

export default async function ActivityPage() {
  const data = getBoardData();
  const header = getRepoHeader();
  const token = await getAuthProvider().getToken();
  const events = getActivity(200);

  return (
    <>
      <TopBar
        owner={header.owner}
        repo={header.name}
        defaultBranch={header.defaultBranch}
        lastSync={null}
        connected={Boolean(token && header.name)}
      />

      <div className="flex min-h-0 w-full flex-1 flex-col gap-[18px] overflow-y-auto p-[22px]">
        <div className="flex flex-col gap-1">
          <h1 className="text-[24px] font-semibold text-ink">Activity</h1>
          <p className="text-[12px] text-muted">
            Local event log: cards, moves, markdown writes, syncs and conflicts.
          </p>
        </div>

        <div className="w-full overflow-hidden rounded-xl border border-border">
          {events.length === 0 && (
            <div className="p-3 text-[12px] text-muted">Nothing logged yet.</div>
          )}
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-center gap-3 border-b border-border p-3 last:border-b-0"
            >
              <span className="rb-pill">{event.type}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-ink">
                {event.message}
              </span>
              <span className="text-[11px] text-muted">
                {new Date(event.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
