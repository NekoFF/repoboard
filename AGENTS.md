# Working notes for AI agents

Read this before changing anything. It exists because more than one agent works
on this repository, sometimes at the same time.

## What this is

A local-first planning tool for GitHub repositories: a board, checklists that
must not get lost (release, privacy policy, licences…), notes and decisions —
all kept as markdown in the repository itself, under `.repoboard/`. Next.js +
SQLite, runs on the user's machine, talks only to github.com.

GitHub is the source of truth for branches, commits, pull requests, issues and
file contents; SQLite holds only RepoBoard's own state (cards, links, the last
parsed copy of each document). Several repositories can be connected, one
active at a time, each with its own token. There are no accounts, no server,
no sharing beyond what the repository itself shares. Do not add them.

The file format is specified in [docs/FORMAT.md](docs/FORMAT.md). Keep that
file, `lib/markdown/format.ts` and `WORKSPACE_README` in `lib/templates.ts` in
step.

## Hard rules — breaking these breaks the product

1. **Never write to the user's repository without a reviewed diff.** Every
   write goes through a dialog that re-fetches the file, shows the diff and
   commits with the SHA it was computed on: `MarkdownWriteDialog` (board ↔
   markdown), `DocWriteDialog` (documents), the workspace setup preview, and
   the "Save to repo" confirmation for `board.json`. If the remote SHA moved,
   the write is refused until the user decides. Do not add a code path that
   calls the Contents or Git Data API from anywhere else.
2. **Card moves have one path.** Dragging, the tick, the keyboard (`X`, `1–9`),
   the list view and the detail panel all call `commitMove` in
   `KanbanBoard.tsx`, so a markdown-backed card always joins the queue of
   reviewed changes. Do not bypass it.
3. **The UI talks to the server only through `lib/client/api.ts`.** No `fetch`
   to `/api/...` inside a component.
4. **Dates and times go through `RelativeTime` / `DueLabel` / `formatDate`**
   (`components/ui`). Calling `toLocaleDateString()` directly renders
   differently on the server and in the browser and breaks hydration.
5. **Drag is enabled only after mount** (the `interactive` flag in
   `KanbanBoard`). dnd-kit numbers its accessibility ids per render.
6. **Colours are tokens**: CSS variables in `app/globals.css` (light and
   `.dark`), exposed through `tailwind.config.ts`. Never a hex in a component.
   Colour means state: the five item states (todo, doing, review, done,
   cancelled) plus danger — and `accent`, reserved for the primary action,
   focus and selection. `StatusIcon` and `ProgressBar` are the only
   vocabulary for progress — use them.
7. **Tokens never reach the browser.** They live in
   `~/.repoboard/credentials.json` (0600) or the environment; only route
   handlers and server components read them. Until GitHub accepts the active
   token, pages and APIs expose no cached board data (`lib/page-context.ts`,
   `lib/github/access.ts`).
8. **One nav entry per destination.** The Code screen owns its tabs (graph,
   branches, commits, pull requests, issues); the sidebar does not repeat them.
9. **Agents propose, people verify.** Nothing an agent does may set a
   document item to `[x]`; the MCP server has no GitHub write tool.

## Where things live

```
app/                   routes; pages are server components reading the database
  api/                 repo (projects), board, docs, github (read-only proxy), markdown, activity
components/
  shell/               sidebar, project switcher, command menu, theme, shortcuts
  docs/                documents index, document screen, checklist view
  ui/                  primitives: toasts, menus, modal, sheet, glyphs (StatusIcon, ProgressBar)
  *.tsx                screens: Overview, Board (+ list, calendar, card panel), Repository (Code), Activity, Settings
lib/
  client/              api.ts, filters (board query language), hotkeys, graph layout
  markdown/            parser (board), document (checklists), format (the conventions), sync (diff, SHA rules)
  github/              auth (projects + tokens), access (verification cache), Octokit client
  board-service.ts     board, cards, milestones, board ↔ markdown, board.json
  docs-service.ts      tracked documents, edits, workspace setup
  templates.ts         .repoboard templates and README
db/schema.ts           Drizzle schema; migrations in drizzle/ run on boot
scripts/               mcp-server, demo + fake GitHub, doctor, native-binary fetcher, stop
demo/                  the made-up "Lumen" project used by npm run demo
tests/                 parser, documents, filters, graph, conflicts, sync pipeline, scoping
```

## Screens

Overview · Board (board, list, calendar) · Documents · Code (graph, branches,
commits, pull requests, issues) · Activity · Settings.

If you remove or rename a screen, update `components/shell/Sidebar.tsx`, the
command menu in `components/shell/CommandPalette.tsx`, the `G` shortcuts in
`AppShell.tsx` and this list in the same change.

## Working in parallel

Two git worktrees exist so two agents never edit the same checkout:

| Folder | Branch | For |
| ------ | ------ | --- |
| `RepoBoard/` | `main` / feature branches | everything by default |
| `RepoBoard-design/` | `design` | a second agent doing visual work, when there is one |

Each folder has its own `node_modules`. Two dev servers in one folder must use
different build directories: `NEXT_DIST_DIR=.next-x npx next dev -p 3005`.

## Who is doing what right now

Update this section when you start and when you finish. Date + what you own.

| Since | Agent | Owns | Notes |
| ----- | ----- | ---- | ----- |
| 2026-09-25 | Claude (Opus), branch `product` in `RepoBoard/` | everything | Turning the MVP into the product: projects, documents, overview, graph |

Rules while more than one entry is in this table:

- Stay inside the files you own; ask under "Requests" for changes elsewhere.
- Run `npx tsc --noEmit` and `npm test` before you finish. Both must pass.
- Do not reformat files you did not otherwise change.

## Requests between agents

- _(none)_

## MCP server

`scripts/mcp-server.mjs` exposes the board and documents to AI clients over
stdio: overview, cards (create, move, update, checklist, comment), documents
(list, read from GitHub), the needs-check queue and activity. It resolves its
paths from its own location, not the caller's directory. It has no tool that
writes to GitHub — agents edit `.repoboard/` files in their own checkout.
If you add a tool, keep that boundary.

## Checks

```bash
npm run doctor    # environment problems, in plain words
npx tsc --noEmit  # types
npm test          # unit + integration tests
npm run build     # production build, writes to .next-build
npm run demo      # the app against a fake GitHub, no token needed
```

## Design notes

Calm, dense but not cramped. Cool neutrals with a blue cast, near-white panels
on a light grey desk, graphite text, one soft blue (`accent`) for primary
actions, focus and selection. IBM Plex Sans for the interface, Plex Mono only
for things that are code (SHAs, branches, paths, RB-n). Neutral surfaces; the
state colours are the only colour. Cards carry a title, labels and small
indicators — details belong in the panel. Screens with reading content
(Overview, Documents, Settings) are a centred column with generous spacing;
work surfaces (Board, Code) use the full width.

Motion answers actions only, under 200 ms; respect reduced motion.
