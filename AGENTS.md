# Working notes for AI agents

Read this before changing anything. It exists because more than one agent works
on this repository, sometimes at the same time.

## What this is

A local-first project board for **one** GitHub repository. Next.js + SQLite,
runs on the user's machine, talks only to github.com. GitHub is the source of
truth for branches, commits, pull requests, issues and file contents; SQLite
holds only the board's own state.

Single user, single repository. There are no accounts, no workspaces, no
sharing. Do not add them.

## Hard rules — breaking these breaks the product

1. **Never write to the user's repository without a preview.** Every
   board→GitHub markdown write goes through `MarkdownWriteDialog`, which
   re-fetches the file, compares its SHA against the one the edit was based on,
   and shows a diff. If the remote SHA moved, the write is refused until the
   user resolves it. Do not add a code path that calls the Contents API
   directly.
2. **Card moves have one path.** Dragging, the tick on a card, and the column
   selector in the detail panel all call `commitMove` in `KanbanBoard.tsx`, so
   a markdown-backed card always reaches the preview. Do not bypass it.
3. **The UI talks to the server only through `lib/client/api.ts`.** No `fetch`
   to `/api/...` inside a component.
4. **Dates and times go through `RelativeTime` / `formatDate`**
   (`components/ui`). Calling `toLocaleDateString()` directly renders
   differently on the server and in the browser and makes React throw away the
   hydrated page.
5. **Drag is enabled only after mount** (the `interactive` flag in
   `KanbanBoard`). dnd-kit numbers its accessibility ids per render, which
   otherwise causes the same hydration failure.
6. **Colours come from the tokens in `tailwind.config.ts`**, never as hex in a
   component. The palette is deliberately small: ink, muted, border, pill,
   canvas, plus success/warn/danger for state only.
7. **The server never sends the GitHub token to the browser.** It lives in
   `~/.repoboard/credentials.json` or the environment, and only route handlers
   read it.
8. **One nav entry per destination.** The repository screen owns its own tabs
   for branches / commits / pull requests / issues — do not also list those in
   the sidebar. That duplication was removed once already.

## Where things live

```
app/                routes; pages are server components that read the database
  api/              route handlers: repo, board, github, markdown, activity
components/         all screens and UI; every screen is a client component that
                    receives data/header/connected as props
components/ui/      toasts, skeletons, modal, RelativeTime, Segmented
lib/client/api.ts   the only client→server surface, plus the useResource hook
lib/board-service.ts   board + markdown + GitHub orchestration
lib/markdown/       remark parser, stable task ids, move, diff, conflict rules
lib/github/         AuthProvider abstraction and the Octokit client
db/schema.ts        Drizzle schema; migrations in drizzle/ run on boot
scripts/            doctor and the native-binary fetcher
tests/              parser, conflict and full sync-pipeline tests
```

## Screens

Overview · Board · Repository (tabs: branches, commits, pull requests, issues) ·
Markdown sync · Activity · Settings.

If you remove or rename a screen, update the sidebar in `components/Sidebar.tsx`
and this list in the same change.

## Working in parallel

Two agents share this repository through separate git worktrees, so neither
sees the other's unsaved work and git never has to merge two people editing the
same file at the same moment:

| Folder | Branch | For |
| ------ | ------ | --- |
| `RepoBoard/` | `main` | backend, API, database, MCP |
| `RepoBoard-design/` | `design` | visual work |

Each folder has its own `node_modules` and runs on its own port
(`npm run dev` on 3000, `npx next dev -p 3001` for the second one). Both share
one board database in `~/.repoboard/`, so the same cards appear in both.

Work only in your own folder. When a piece is finished, commit on your branch;
the owner merges. To pick up the other side's finished work:

```bash
git fetch && git merge origin/main      # from the design branch
```

## Who is doing what right now

Update this section when you start and when you finish. Date + what you own.

| Since | Agent | Owns | Notes |
| ----- | ----- | ---- | ----- |
| 2026-09-25 | Claude (Opus), `main` in `RepoBoard/` | `lib/`, `app/api/`, `db/`, `drizzle/`, `scripts/`, `packages/` | Building an MCP server so agents can drive the board directly |
| 2026-09-25 | design agent, `design` in `RepoBoard-design/` | `components/`, `app/globals.css`, `tailwind.config.ts` | Visual work |

Rules while this table has two entries:

- Stay inside the files you own. If you need a change outside them, write it
  under "Requests" below instead of making it.
- `app/*/page.tsx` files are shared and tiny — touch them only if you must, and
  say so here.
- Run `npx tsc --noEmit` and `npm test` before you finish. Both must pass.
- Do not reformat files you did not otherwise change.

## Requests between agents

Leave a line here instead of editing someone else's area. Delete it once done.

- Backend: enforce a live, valid GitHub token for every non-Settings page and for `/api/board` (GET/POST), `/api/activity`, and `/api/markdown` (GET/POST); missing/revoked/expired tokens must return 401/403 without serializing cached board/repo data or allowing local mutations. The Settings page must pass only connection-form data while invalid, not `getBoardData()`. Hide cached repo/markdown metadata from `/api/repo` GET while invalid. `app/layout.tsx` must use that validated status instead of `Boolean(token && repo)`, with a short safe cache or fail-closed verification. Keep Settings connect/disconnect reachable. Expose connect/disconnect through `lib/client/api.ts` so `SettingsScreen` can stop calling `/api/repo` directly.
- Backend: scope every SQLite board/header/identity/activity/sync read and write to the currently configured `owner/name`, never `db.select().from(repositories).get()` without a repository filter. The design database currently contains both `NekoFF/meridian-tv-browser` and `NekoFF/ESP32LN`, while credentials select ESP32LN; port 3001 incorrectly shows and edits the first repo's board. Preserve both repositories and their cards, and fail closed if the configured repo has no local row yet.

## Ideas worth taking later (for whoever does the visual work)

Borrowed in spirit from Linear and Kan, ranked by what this app would actually
gain. Ideas only — write your own implementation.

1. **Command palette does actions, not just navigation.** ⌘K already searches;
   the win is running things from it: move a card, assign, add a label, open a
   branch. Linear's whole speed story is that you never reach for the mouse.
2. **Keyboard on the board.** Arrows move the selection between cards,
   `Enter` opens, `E` edits the title inline, `X` marks done, `1–4` sends the
   selected card to that column. Nothing here needs new backend work.
3. **Optimistic everything with an undo toast.** Every destructive or
   surprising action shows "Deleted · Undo" for a few seconds instead of a
   confirmation dialog. Needs soft delete in the schema — ask before relying
   on it.
4. **Card peek.** Hovering or pressing space shows the card's detail in a
   popover without leaving the board.
5. **Filter as a first-class bar**, not two dropdowns: a single input that
   accepts `label:bug assignee:me is:done`, with chips for what is active.
6. **Empty states that do the next thing**, not that describe the problem —
   the board's empty state already imports issues; apply the same idea to the
   other screens.
7. **One motion language.** Cards lift on grab, drop with a short spring,
   panels slide from the edge they belong to. Durations stay under 200ms;
   nothing loops.

Do not add: avatars for people who do not exist, charts nobody reads,
onboarding tours, or a second navigation layer.

## MCP server

`scripts/mcp-server.mjs` exposes the board to AI clients over stdio. It talks
to SQLite directly — no HTTP, no running web app required. It deliberately has
no tool that writes to GitHub: markdown commits go through the app's preview.

If you add a tool, keep that boundary.

## Checks

```bash
npm run doctor    # environment problems, in plain words
npx tsc --noEmit  # types
npm test          # 29 unit + integration tests
npm run build     # production build, writes to .next-build
```

## Design notes

The board is meant to read as a board: columns are visible containers on a
textured surface, cards carry a title, colour-coded labels and small
indicators, and nothing else. Resist putting more on the card — every link
already has a home in the detail panel.

Density is deliberate: 12–13px type, tight spacing, thin borders, colour only
where it carries meaning (green = in sync, amber = conflict or behind).
