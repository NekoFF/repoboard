# Working notes for AI agents

Read this before changing anything. It exists because more than one agent works
on this repository, sometimes at the same time.

## What this is

A local-first planning tool for GitHub repositories: a board, checklists that
must not get lost (release, privacy policy, licences…), notes and decisions —
all kept as markdown in the repository itself, under `.repoboard/`. Next.js +
SQLite, runs on the user's machine, talks only to github.com.

GitHub is the source of truth for branches, commits, pull requests, issues and
file contents; SQLite holds only RepoBoard's own state (boards, cards, links,
the last parsed copy of each document). Several repositories can be connected, one
active at a time, each with its own token. There are no accounts, no server,
no sharing beyond what the repository itself shares. Do not add them.

The file format is specified in [docs/FORMAT.md](docs/FORMAT.md). Keep that
file, `lib/markdown/format.ts` and `WORKSPACE_README` in `lib/templates.ts` in
step.

## How work is organised

```
Project (a GitHub repository)
└── Boards            one per person (owner set) or per area (Design, Core)
    └── Cards         a topic: RB-n, unique across the whole project
        └── Items     numbered steps 1, 1.1, 1.2 — notes, assignee, due, comments, sub-items
```

- The **main board** has the id `board_<repositoryId>`, lives at `/board` and
  is the only one that follows the markdown board file (sync, pending
  changes). Other boards live at `/board/<boardId>`. `boards.owner` makes a
  person's board; without it the board is an area. Archiving keeps the cards.
- **`board.json` holds every board** (`lib/board-state.ts`): the main board at
  the top level, as files always had it, the others under `boards` — name,
  colour, picture, owner, columns, milestones, cards, archive. Boards merge by
  `boards.updated_at` (a never-edited board is 0, so the repository's name
  wins), cards one by one by their own `updatedAt`, milestones by name. Any
  change to a board's own fields must set `updatedAt`. Sync and "Save to
  repo" are on every board. With automatic sync on
  (`repositories.auto_sync`), `components/shell/SyncAgent.tsx` syncs on
  open, on focus, every minute and a few seconds after a local change
  (`rb-boards-changed`, fired by `lib/client/api.ts`); the header shows
  `SyncChip` instead of "Save to repo". Cards compare by content
  (`sameCard`), never by `JSON.stringify` of objects built in different
  places — field order differs between the database and the parser.
- A card lives at `/board/card/<RB-n or id>` whatever its board;
  `findCardBoard` finds it. Card numbers come from `nextCardNumber`, which
  counts every board of the repository — never number per board.
- Every board action carries `boardId`; the route rejects an unknown one.
  `getBoardData(boardId?)` without an id is the main board.
- Items are a tree (`lib/checklist.ts`), stored as JSON on the card. Ticking an
  item ticks its children and reopens its ancestors (`setDone`).

## Hard rules — breaking these breaks the product

1. **Never write to the user's repository without a reviewed diff.** Every
   write goes through a dialog that re-fetches the file, shows the diff and
   commits with the SHA it was computed on: `MarkdownWriteDialog` (board ↔
   markdown), `DocWriteDialog` (documents), the workspace setup preview, and
   the "Save to repo" confirmation for `board.json`; a tick with screenshots
   goes through `DocWriteDialog` too and lands as one commit
   (`GitHubClient.commitChanges`, which checks every edited file's SHA). If the remote SHA moved,
   the write is refused until the user decides. Do not add a code path that
   calls the Contents or Git Data API from anywhere else. The one exception
   the owner chose: with **automatic sync** turned on for a project (a
   dialog that says what it writes), `syncBoards` in `lib/board-service.ts`
   writes `.repoboard/board.json` — and only that — on the `repoboard`
   branch (`SYNC_BRANCH`, cut from the default branch by `ensureBranch`),
   merging first and with the SHA it read. Never the default branch, never
   another file.
2. **Card moves have one path.** Dragging, the tick, the keyboard (`X`, `1–9`),
   the list view and the card page all go through `useCommitMove` in
   `lib/client/moves.ts`, so a markdown-backed card always joins the queue of
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
   document item to `[x]`, tick a card item, move a card to a done column or
   write `Checked:`; the MCP server has no GitHub write tool.
10. **The API answers only RepoBoard.** `middleware.ts` refuses other hosts
   (DNS rebinding) and writes that are not same-origin JSON with
   `x-repoboard: 1`, which `lib/client/api.ts` sends. Anything that posts to
   the API (scripts/demo.mjs) must send it too.
11. **Roles come from GitHub** (`lib/roles.ts`): Admin/Maintain → manager,
   Write → member, Triage/Read → viewer, from the repository's
   `permissions` for the token (`RepoSummary.role`, `currentWho()`). The
   routes enforce them — viewers change nothing (board and docs POSTs answer
   403), members make boards only for themselves and change only their own,
   only managers turn automatic sync on — and screens hide what the role
   cannot do (`useShell().role`). A board with `visibility: "owner"` is
   listed only for its owner and managers (`listBoards(who)`,
   `getProjectData(who)`, `getPageContext`); say plainly that its file on
   GitHub is still readable by anyone with access to the repository.

## Where things live

```
app/                   routes; pages are server components reading the database
  api/                 repo (projects), board (+ board-create/update/archive), docs, github (read-only proxy), markdown, activity
  me/                  My work: everything assigned to one person, by due date
  boards/              every board of the project, as picture tiles
  board/               the main board; board/[boardId] the others; board/card/[id] a card on any board
components/
  shell/               sidebar, project switcher, command menu, theme, shortcuts
  docs/                documents index, document screen, checklist view
  ui/                  primitives: toasts, menus, modal, sheet, glyphs (StatusIcon, ProgressBar)
  card/                the card page (/board/card/<id>), its item tree and the item dialog
  *.tsx                screens: Overview, Board (+ list, calendar), Repository (Code), Activity, Settings
lib/
  client/              api.ts, filters (board query language), hotkeys, graph layout
  markdown/            parser (board), document (checklists), format (the conventions), sync (diff, SHA rules)
  github/              auth (projects + tokens), access (verification cache), Octokit client
  board-service.ts     board, cards, milestones, board ↔ markdown, board.json
  docs-service.ts      tracked documents, edits, workspace setup
  templates.ts         .repoboard templates and README
db/schema.ts           Drizzle schema; migrations in drizzle/ run on boot
scripts/               mcp-server, demo + fake GitHub, doctor, native-binary fetcher, stop
desktop/               the Electron app: main.cjs (starts the bundled server), preload, prepare.mjs
                       (standalone build + better-sqlite3 for Electron + bundled MCP), after-pack
demo/                  the made-up "Lumen" project used by npm run demo
tests/                 parser, documents, filters, graph, conflicts, sync pipeline, scoping
```

## Screens

Inbox · Overview · My work · Boards → a board (board, list, calendar) → a
card · Documents · Code (graph, branches, commits, pull requests, issues) ·
Activity · Settings.

Before the app opens (`components/connect/`, full screen over the blurred
app): **Connect** (`/connect`, also first start and `?repo=` for a new key —
get a key from GitHub through a prefilled link, `lib/github/token-link.ts`,
paste it, pick repositories from the ones it opens) and **Project
unavailable** (the open project's key ran out, lost access, or GitHub is out
of reach — `getAccessState` in `lib/github/access.ts` says which; it always
offers a new key, another project and trying again). Settings shows each
project's health (`/api/repo?health=1`). `app/error.tsx`,
`app/global-error.tsx` and `app/not-found.tsx` always offer a way on. The Inbox (`components/InboxScreen.tsx`) shows what
others did since the person last looked (a timestamp in localStorage) and
suggestions from GitHub, applied through `useCommitMove`.
The sidebar lists the boards under "Boards"; the command menu has a Boards
group. Overview opens with **Project life** (`components/ProjectStory.tsx`,
model in `lib/client/story.ts`): the repository's history as a timeline of
the main line, branches leaving and merging, and open branches, read from
`/api/github?resource=story` (`storyGraph`: 300 commits of the default branch,
each other branch read back to where it left it). A branch that came back by
fast-forward has no merge commit, so it shows as a "landed" mark on the main
line. Nodes sit on springs; long stretches of work are grouped per month.

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

`scripts/mcp-server.mjs` exposes the boards and documents to any MCP client
over stdio (Claude Code, Codex, Cursor, Claude Desktop…): overview, boards
(`list_boards`; `get_board` and `create_card` take an optional `board` — name,
owner or id — and default to the main board), cards (create, move, update,
delete/restore, checklist, comment — found by RB-n on any board), documents
(list, read from GitHub), the needs-check queue and activity. Every event it writes
is attributed to the agent (`REPOBOARD_AGENT`, else the client's reported
name) with `actor_kind = agent`; Settings shows per-client setup.

People: events written through the app are attributed to the GitHub login of
the active token (route handlers wrap their work in `runAs` from
`lib/actor.ts`; `logActivity` reads it). Write activity messages as actions
that follow a name ("moved X from Todo to Done"). It resolves its
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

Calm, dense but not cramped. Light: cool neutrals with a blue cast,
near-white panels on a light grey desk, graphite text. Dark: near-neutral
blacks in layers (desk, panel, card, each a step lighter) told apart by
hairline edges rather than contrast, the desk's colour a whisper, one soft blue (`accent`) for primary
actions, focus and selection. IBM Plex Sans for the interface, Plex Mono only
for things that are code (SHAs, branches, paths, RB-n). Neutral surfaces; the
state colours are the only colour. Cards carry a title, labels and small
indicators — details belong in the panel. Screens with reading content
(Overview, Documents, Settings) are a centred column with generous spacing;
work surfaces (Board, Code) use the full width.

Layout: panels on a desk. Navigation is glass (`rb-glass`)
over a dotted desk with two soft colour washes; the main panel is opaque and
fully rounded, level with the navigation, and the navigation reaches 60px
under it so its own rounded corner is hidden and the top edges read as one.
The main panel throws a quiet shadow to the left, onto the navigation. The tool
rail is a glass pill at the page's right edge (absolute, inside `main`); every
page keeps clear of it through `--rb-rail` (added by `rb-under-header` /
`rb-clear-rail`) — nothing may ever sit under the rail. Page
headers are glass bars floating over the page (`PageHeader` is absolute; the
scroll area after it adds `rb-under-header`), with no rules under them.
Dialogs, sheets, the command menu, menus and toasts use `rb-glass-strong` /
`rb-menu` over a blurred scrim.

Motion answers actions only, under 200 ms; respect reduced motion. The one
exception is the board tiles on the Boards screen: each shows a picture the
person picks (`components/BoardArt.tsx`, stored in `boards.art`; null picks
one from the board's id) that moves slowly. Pictures take their colours from
`--h` / `--s` on `.rb-tile`, so they work in both themes; previews in the
picker hold still until pointed at.
