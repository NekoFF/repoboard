# RepoBoard

A local-first project board for a single GitHub repository. Kanban cards,
branches, commits, pull requests, issues and a Markdown roadmap are one linked
graph — and GitHub stays the source of truth for everything git-shaped.

Runs entirely on your machine: Next.js + SQLite, no hosted database, no external
service, no account beyond your own GitHub token.

## Quick start

```bash
npm install
npm run db:migrate
npm run dev
```

Open <http://localhost:3000>, go to **Settings**, and connect a repository with
a fine-grained personal access token.

Token permissions needed (repository-scoped):

| Permission    | Access         | Used for                                  |
| ------------- | -------------- | ----------------------------------------- |
| Contents      | Read and write | reading the markdown file, committing moves |
| Metadata      | Read           | repository info, default branch            |
| Pull requests | Read           | PR list, checks, reviewers                 |
| Issues        | Read           | issue list and labels                      |

Alternatively put the token in `.env.local` (copy `.env.example`):

```
GITHUB_PAT=github_pat_…
GITHUB_REPO=owner/name
```

The token is never written into source files. When entered through Settings it
is stored in `.repoboard/credentials.json` with mode `0600`; both that directory
and `.env.local` are gitignored.

## How the Markdown sync works

Pick any `.md` file in the repository (`ROADMAP.md`, `TODO.md`, `PLAN.md`, …).
Headings become columns, checkboxes become card state:

```markdown
## Todo

- [ ] Phone input pairing <!-- rb:task_k3f9x21a -->

## In Progress

- [ ] Private mode cookie isolation <!-- rb:task_b71qc04d -->

## Done

- [x] D-pad focus memory <!-- rb:task_z04mn8re -->
```

| Markdown           | Board              |
| ------------------ | ------------------ |
| `## Todo`          | Column *Todo*      |
| `## In Progress`   | Column *In Progress* |
| `## Review`        | Column *Review*    |
| `## Done`          | Column *Done*      |
| `- [ ]`            | open card          |
| `- [x]`            | completed card     |
| `<!-- rb:task_x -->` | stable card identity |

The `rb:` markers are HTML comments, so github.com renders the file normally
while RepoBoard keeps an identity that survives renaming and reordering. If a
task has no marker, the first sync adds one and commits it back.

### Board → GitHub

Dragging a card between columns moves the task under the matching heading and
flips its checkbox. Before anything is written:

1. the file is fetched fresh from GitHub,
2. its SHA is compared with the one the edit was based on,
3. a diff preview is shown,
4. only then is the Contents API called, with the expected SHA attached.

The commit reads e.g. `RepoBoard: move "Private mode cookie isolation" to Done`.

### Conflicts

If the remote SHA moved, RepoBoard **never** overwrites. The preview turns into
a conflict panel offering *Use local*, *Use remote* or *Merge manually* (a
side-by-side view). Forcing a write still rebases onto the freshly fetched
remote content, so a concurrent edit by someone else is not lost.

## What lives where

GitHub is authoritative for branches, commits, pull requests, issues and file
contents — none of it is mirrored into SQLite. The database holds only
RepoBoard's own state:

```
workspaces · repositories · boards · columns · tasks · task_labels
task_branch_links · task_commit_links · task_pull_request_links
task_issue_links · markdown_sources · markdown_task_mappings
activity_events · sync_state
```

## Project layout

```
app/                 routes and API handlers
  api/repo           connect / disconnect / status
  api/board          card CRUD, moves, links
  api/github         read-only proxy for live GitHub data
  api/markdown       source selection, sync, preview, commit
  api/activity       local event log
components/          screens and UI (Figma-derived)
lib/
  github/            AuthProvider abstraction + Octokit client
  markdown/          remark parser, id backfill, move, diff, conflict rules
  db/                SQLite client and migration runner
  board-service.ts   the layer that ties board, markdown and GitHub together
db/schema.ts         Drizzle schema
drizzle/             generated SQL migrations
tests/               parser, conflict and full sync-pipeline tests
```

## Scripts

```bash
npm run dev          # http://localhost:3000
npm run build        # production build
npm test             # 29 unit + integration tests
npm run db:generate  # regenerate migrations after a schema change
npm run db:migrate   # apply migrations
```

## Auth

`lib/github/auth-provider.ts` defines the `AuthProvider` interface; the MVP
implements `PatAuthProvider`. Swapping in GitHub OAuth or a GitHub App means
adding a class there — no caller changes, because nothing else reads the token.

## Design

The UI follows the RepoBoard Figma file: 230px sidebar, 68px top bar, dense
developer-tool spacing, off-white canvas (`#fbfbfa`), near-black ink
(`#121213`), thin `#e0e0de` borders and colour used only for state (green
`#2e7847` for synced, amber `#b8731a` for conflicts). Tokens live in
`tailwind.config.ts`.
