# RepoBoard

**Plan your project inside its repository.**

RepoBoard is a board, a set of checklists and a project memory that live next
to your code — as plain markdown in your GitHub repository. It runs on your
own computer, talks only to github.com, and shows at a glance what is done,
what is left, and what still needs your own eyes before it counts.

- **Boards** — one per person (Dima, Max, the intern) or per area (Design,
  Core), all in one project. On a board, each card is a topic; inside a card,
  numbered items (1, 1.1, 1.2…) are the steps, each with notes, an assignee
  and comments. Each board gets a picture of its own — 24 slowly moving
  motifs or a plain colour. Columns, a list and a calendar, filters like
  `label:bug @me !high due:week`, keyboard for everything, milestones.
- **My work** — everything assigned to you, from every board, card and
  checklist, by when it is due. Open a teammate's list the same way.
- **Checklists that do not get lost** — a release, the privacy policy, the
  Impressum, font and dependency licences. Each item can say *why*, *what to
  do* and *how to verify* it, and carries notes from people and AI agents.
- **Needs your check** — agents mark finished work as `[?]`; only you tick it
  off. One queue shows everything waiting for you.
- **Done with proof** — tick an item and say why: the file and lines where it
  is written (saved as a permalink to that exact version), the words
  themselves, a screenshot. It all goes under the item, with your name and the
  date, in one commit.
- **Texts for people** — write the privacy policy or the Impressum itself
  from a template, keep it wherever your project keeps it, edit it here, and
  export it as a PDF.
- **Overview** — one square per item across the board and every checklist,
  so nothing hides behind a percentage.
- **Code** — the repository's history drawn as lines that branch and merge;
  commits, pull requests and issues that mention `RB-12` show up on card 12.
- **Shared through the repository** — every board travels in
  `.repoboard/board.json`, so whoever connects the same repository sees the
  same boards, cards and checklists; GitHub's permissions decide who may
  change them.
- **Several projects** — switch between repositories like in Linear; each has
  its own boards, checklists and token.
- **For AI agents** — an MCP server lets Claude, Codex or any other agent read
  and work the same board and checklists. They can propose; they cannot commit.

Everything RepoBoard writes to your repository goes through a diff you review
first, and it refuses to overwrite a file that changed on GitHub meanwhile.

---

## Try it in one minute

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run demo
```

Open <http://localhost:3100>. The demo is a made-up project ("Lumen", a
browser for TVs) served by a small fake GitHub, so no token and no real
repository are involved. `npm run demo -- --reset` starts it over.

## Use it on your own repository

```bash
npm run dev
```

Open <http://localhost:3000>, go to **Settings → Connect a repository**, and
paste a fine-grained token:

1. <https://github.com/settings/personal-access-tokens/new>
2. **Repository access:** *Only select repositories* → the repository.
3. **Permissions:** Contents *read and write*; Metadata, Pull requests and
   Issues *read-only*.
4. Generate, copy (it starts with `github_pat_`), paste into RepoBoard.

Then open **Documents** and create the `.repoboard/` folder from the
templates you want. Connect more repositories from the project switcher in the
top-left corner.

On macOS you can also double-click **`RepoBoard — Start.command`**.

## The `.repoboard/` folder

```
.repoboard/
  README.md        the rules, for people and agents
  checklists/      what must be done and checked
  notes/           how to run things, where they live
  decisions/       what was decided and why, with sources
  evidence/        screenshots that prove checklist items
  board.json       every board, its cards, order and checklists (written by RepoBoard)
```

A checklist item looks like this:

```markdown
- [?] Impressum reachable from every screen !high @alex due:2026-10-01 #legal
  - Why: the provider must be easy to identify.
  - Verify: from a fresh install, reach it in two presses of the remote.
  > codex 2026-09-25: a contact form counts as the second contact channel.
```

`[ ]` to do · `[/]` in progress · `[?]` needs checking · `[x]` done · `[-]` won't do.
The full format is in [docs/FORMAT.md](docs/FORMAT.md). It reads fine on
GitHub and the folder opens as an Obsidian vault.

## AI agents

Connect the MCP server to Claude Code:

```bash
claude mcp add repoboard -- node /path/to/repoboard/scripts/mcp-server.mjs
```

(Settings shows the exact command for your installation.) Agents get the
overview, every board, the documents and the needs-check queue, and can
create, move and comment on cards on any board. To change a checklist they edit the file in their
own checkout and push — and they follow the rules in `.repoboard/README.md`:
never tick an item themselves, set `[?]` and say how to verify.

## Keyboard

| Keys | Does |
| ---- | ---- |
| `⌘K` / `Ctrl K` | search everything, run any command |
| `G` then `O` `M` `B` `D` `C` `A` | overview, my work, boards, documents, code, activity |
| `C` | new card |
| `/` | filter the board |
| arrows, `J` `K`, `Enter` | move the selection, open |
| `X`, `1`–`9` | done, send to a column |
| `E`, `⌘Enter` | edit a document, review changes |
| `?` | all shortcuts |

## Where your data is kept

| What | Where |
| ---- | ----- |
| Boards, cards, history | `~/.repoboard/repoboard.db`, and `.repoboard/board.json` in your repository once you press *Save to repo* |
| Tokens | `~/.repoboard/credentials.json` (readable only by you) |
| Checklists, notes, decisions | your repository, `.repoboard/` |

Back up the `~/.repoboard` folder to keep everything local. Updating the app
never touches it.

## Is this safe?

- Tokens stay on your computer and are only ever sent to github.com. They
  never reach the browser.
- The app listens on `127.0.0.1` only; other devices on your network cannot
  reach it. It has no login of its own, so that is what keeps the token yours.
  Do not run `npm run dev:lan` unless you understand that it removes this.
- Nothing is written to your repository without a diff you approved, and a
  file that changed on GitHub since you opened it is never overwritten.
- The legal checklists are reminders, not legal advice.

---

# Installation, step by step

Never used a terminal? Follow this top to bottom; it takes about ten minutes.

**1. Install Node.js.** Open <https://nodejs.org>, download the **LTS**
version and install it with the default options. On Windows, restart the
computer afterwards. Check it worked: open a terminal and type `node -v` — you
should see `v20` or higher.

**2. Get RepoBoard.** On the repository page click **Code → Download ZIP** and
unpack it somewhere simple (on Windows, e.g. `C:\repoboard` — no spaces or
brackets in the path). Or `git clone https://github.com/NekoFF/repoboard.git`.

**3. Open a terminal in that folder.**
Windows: open the folder in Explorer, click the address bar, type `cmd`, press
Enter (use `cmd`, not PowerShell). macOS: right-click the folder → Services →
New Terminal at Folder. Linux: right-click → Open in Terminal. Type `ls`
(or `dir` on Windows): you should see `package.json`.

**4. Install and start.**
```bash
npm install
npm run dev
```
Leave the window open; closing it stops the app. Open <http://localhost:3000>.

**Stopping and starting again:** `Ctrl+C` stops it; `npm run dev` starts it
again. `npm run stop` stops one that is still running in the background. You
never repeat `npm install` unless you update.

**Updating:** download the new version, replace the app folder (your data is
not in it), then `npm install` and `npm run dev`. Database changes apply
themselves on start.

## Troubleshooting

**Run the built-in check first:** `npm run doctor` — it explains problems in
plain words. If it reports the database engine, `npm run fix` usually solves it.

**Windows: `running scripts is disabled on this system`** — you are in
PowerShell. Use `cmd` instead, or run `npm.cmd install` / `npm.cmd run dev`,
or once: `Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned`.

**Windows: `A positional parameter cannot be found`** — the folder path has
spaces or brackets (e.g. `repoboard-main (1)`). Rename the folder, or quote the
path: `cd "C:\Users\you\Downloads\repoboard-main (1)"`.

**`node` or `npm` is not recognised** — Node is not installed, or Windows was
not restarted afterwards.

**`Could not locate the bindings file` / `node-gyp` / `MSBuild` errors** — the
database engine has no ready-made binary for your Node version. Update to the
current RepoBoard, delete `node_modules`, `npm install` again. Still failing:
install the LTS version of Node.

**`EADDRINUSE :::3000`** — RepoBoard is already running somewhere. Close that
window, or use another port: `npm run dev -- -p 3001`.

**"Bad credentials" or "Not Found" when connecting** — the token is wrong,
expired, or was not given access to that repository.

---

# For developers

```bash
npm run dev          # http://localhost:3000, bound to 127.0.0.1
npm run demo         # against the fake GitHub in scripts/demo-github.mjs
npm test             # unit and integration tests
npx tsc --noEmit     # types
npm run build        # production build (writes to .next-build)
npm run db:generate  # a migration after changing db/schema.ts
npm run mcp          # the MCP server on stdio
```

Next.js 14 (app router) · React 18 · Tailwind with CSS-variable tokens ·
SQLite through Drizzle · Octokit · dnd-kit · Radix primitives · cmdk ·
remark. See [CLAUDE.md](CLAUDE.md) for the architecture, the rules the code
keeps, and where everything lives.

## License

Source-available, not open source. You may read it, download it and run it for
yourself; commercial use, redistribution and offering it as a service need
written permission. See [LICENSE](LICENSE).

## Licence

RepoBoard is source-available, not open source: you may read it, run it and
change your own copy for personal use or to try it out. Using it in a
business, offering it as a service, or publishing copies needs written
permission. The full terms are in [LICENSE](LICENSE).
