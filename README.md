# RepoBoard

A project board that lives on your own computer and keeps your GitHub
repository as the single source of truth. Cards, branches, commits, pull
requests, issues and a Markdown roadmap are one connected thing.

Nothing is uploaded anywhere. The app runs on your machine and talks only to
github.com, using a token you create yourself.

---

# Installation — the complete version

Never used a terminal? That is fine. Follow this top to bottom; it takes about
ten minutes and you can copy every command.

You need: a computer (Windows, macOS or Linux) and a GitHub account.

## Step 1 — Install Node.js

Node is the engine the app runs on. Install the version marked **LTS**.

**Windows**
1. Open <https://nodejs.org> and click the big **LTS** button.
2. Run the downloaded `.msi` file and click Next until it finishes. Leave every
   option at its default.
3. Restart your computer (Windows needs this so the `node` command is found).

**macOS**
1. Open <https://nodejs.org> and click the big **LTS** button.
2. Open the downloaded `.pkg` file and click through the installer.

*(If you already use Homebrew, `brew install node@22` works too.)*

**Linux (Ubuntu / Debian / Mint)**
Open a terminal and paste:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**Check it worked.** Open a terminal (see Step 3 if you do not know how) and type:
```bash
node -v
```
You should see something like `v22.11.0`. Anything **v20 or higher** is fine.
If you instead see "command not found", Node did not install — redo this step
and, on Windows, make sure you restarted.

## Step 2 — Get RepoBoard onto your computer

**The easy way (no extra tools):**
1. Open the repository page on GitHub.
2. Click the green **Code** button → **Download ZIP**.
3. Unpack the ZIP. You now have a folder called `repoboard` (or
   `repoboard-main`). Put it somewhere you will find again, for example your
   Documents folder.

**Or, if you have Git installed:**
```bash
git clone https://github.com/NekoFF/repoboard.git
```

## Step 3 — Open a terminal inside that folder

This is the part that trips people up. You need a terminal whose current
folder is the RepoBoard folder.

**Windows**
- Open the folder in File Explorer.
- Click the address bar at the top, type `powershell` and press Enter.
- A blue window opens, already in the right folder.

**macOS**
- Open the folder in Finder.
- Right-click the folder → **Services** → **New Terminal at Folder**.
- If you do not see that option: open Terminal (⌘+Space, type "Terminal"),
  type `cd ` (with the space), then drag the folder onto the window and press
  Enter.

**Linux**
- Right-click inside the folder → **Open in Terminal**.

**Check you are in the right place.** Type `ls` (macOS/Linux) or `dir`
(Windows) and press Enter. You should see `package.json` in the list. If you do
not, you are in the wrong folder.

## Step 4 — Install and start

Type these two commands, one at a time, pressing Enter after each:

```bash
npm install
```
This downloads what the app needs. It takes one to three minutes and prints a
lot of text. Warnings are normal. Only a line starting with `npm ERR!` is a
real problem — see Troubleshooting below.

```bash
npm run dev
```
When you see `Ready`, the app is running. **Leave this window open** — closing
it stops the app.

## Step 5 — Open it

Open your browser and go to:

**<http://localhost:3000>**

You will see RepoBoard with an empty state asking you to connect a repository.

## Step 6 — Create a GitHub token

The token is how the app is allowed to read your repository. It is like a key
that only works for the one repository you choose.

1. Go to <https://github.com/settings/tokens?type=beta>
2. Click **Generate new token**.
3. **Token name:** anything, for example `repoboard`.
4. **Expiration:** 90 days is a sensible choice.
5. **Repository access:** choose **Only select repositories**, then pick the
   one repository you want the board for.
6. **Permissions → Repository permissions**, set exactly these four:

   | Permission    | Set to         |
   | ------------- | -------------- |
   | Contents      | Read and write |
   | Metadata      | Read-only      |
   | Pull requests | Read-only      |
   | Issues        | Read-only      |

   *Metadata usually switches itself on — that is expected.*
7. Click **Generate token** at the bottom.
8. Copy the token now. It starts with `github_pat_` and GitHub will never show
   it again.

*If the repository belongs to an organisation rather than to you personally, an
organisation owner may have to approve the token before it works.*

## Step 7 — Connect

Back in RepoBoard at <http://localhost:3000>:

1. Click **Settings** in the bottom left.
2. **Repository:** type it as `owner/name`, for example `NekoFF/my-project`.
3. **Token:** paste what you copied.
4. Click **Connect repository**.

Done. Your branches, commits, pull requests and issues are now live in the app.

## What to do first

- Open **Board** and click **Import GitHub issues** — your existing issues
  become cards in one click.
- Or open **Markdown Sync** and pick a file like `ROADMAP.md` to drive the
  board from a checklist in your repository.
- Press **⌘K** (Mac) or **Ctrl+K** (Windows/Linux) to search everything.

## Using it again later

The app only runs while that terminal window is open. To start it again:

1. Open a terminal in the RepoBoard folder (Step 3).
2. Type `npm run dev`.
3. Open <http://localhost:3000>.

You do not repeat `npm install`, and you do not create a new token. Your board
is saved in a file called `repoboard.db` inside the folder.

To stop the app: click the terminal window and press **Ctrl+C**.

## Updating to a newer version

New versions are published on the repository page. Updating never touches your
board: your data lives in a folder called `.repoboard` in your **home**
directory, not inside the app folder, so replacing the app folder is safe.

**If you downloaded a ZIP**
1. Download the new ZIP the same way as in Step 2.
2. Unpack it and delete the old app folder — your board and token are not in
   there.
3. Open a terminal in the new folder (Step 3) and run:
   ```bash
   npm install
   npm run dev
   ```

**If you used `git clone`**
```bash
git pull
npm install
npm run dev
```

`npm install` is needed because a new version may use new libraries. Any
database changes apply themselves the first time the app starts — there is
nothing else to run.

*Installed before this data folder existed?* If you have a `repoboard.db` file
sitting inside the app folder, that installation keeps using it, and deleting
the folder would delete your board. To move to the safe location: stop the app,
then move `repoboard.db` and the `.repoboard` folder from the app folder into
your home directory (`~/.repoboard/`), creating it if needed.

## Where your data is kept

| What | Where |
| ---- | ----- |
| Your board, cards and history | `~/.repoboard/repoboard.db` |
| Your GitHub token | `~/.repoboard/credentials.json` (readable only by you) |

To back up everything, copy that one folder. To start completely fresh, delete
it — the app will rebuild an empty board on the next start.

## Troubleshooting

**`node` or `npm` is not recognised / command not found**
Node is not installed, or Windows was not restarted after installing it. Redo
Step 1.

**`npm install` fails with errors mentioning `node-gyp`, `gyp`, `MSBuild`, `Python` or `C++`**
The database library could not find a ready-made file for your Node version and
tried to build one. The simplest fix is to install the **LTS** version of Node
from <https://nodejs.org> rather than the newest one, delete the `node_modules`
folder, and run `npm install` again.
If you want to keep your Node version: on Windows install "Desktop development
with C++" in the Visual Studio Build Tools; on macOS run `xcode-select
--install`; on Linux install `build-essential` and `python3`.

**`Error: listen EADDRINUSE: address already in use :::3000`**
Something else already uses port 3000 — most likely RepoBoard is already
running in another terminal window. Close that window, or start it on a
different port:
```bash
npm run dev -- -p 3001
```
and open <http://localhost:3001> instead.

**The page loads but has no styling, just black text on white**
The app was rebuilt while running. Press Ctrl+C in the terminal and run
`npm run dev` again.

**"Bad credentials" or "Not Found" after connecting**
The token is wrong, expired, or was not given access to that specific
repository. Redo Step 6, making sure you selected the repository under
**Only select repositories**.

**I want to point it at a different repository**
Settings → **Disconnect**, then connect the other one.

## Is this safe?

- Your token is stored only on your computer, in
  `~/.repoboard/credentials.json`, readable only by your user account. It is
  never sent anywhere except to github.com.
- The app listens on `127.0.0.1` only, which means other devices on your
  network cannot reach it. It has no login of its own, so that restriction is
  what keeps the token yours. Do not run `npm run dev:lan` unless you
  understand that it removes this protection.
- RepoBoard never writes to your repository without showing you the exact diff
  first, and it refuses to overwrite a file that changed on GitHub since it
  last read it.

---

# For developers

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
npm run dev          # http://localhost:3000, bound to 127.0.0.1
npm run dev:lan      # same, reachable from the network — see the safety note
npm run build        # production build (writes to .next-build)
npm test             # 29 unit + integration tests
npm run db:generate  # regenerate migrations after a schema change
npm run db:migrate   # apply migrations by hand (normally automatic on boot)
```

## Scope

One repository per installation. The Settings screen connects a repository and
creates the board; to point RepoBoard somewhere else, disconnect and connect
the other repository. The schema already carries workspace and repository ids,
so multiple boards are a UI change rather than a migration.

## Auth

`lib/github/auth-provider.ts` defines the `AuthProvider` interface; the MVP
implements `PatAuthProvider`. Swapping in GitHub OAuth or a GitHub App means
adding a class there — no caller changes, because nothing else reads the token.

## License

Source-available, not open source. You may read it, download it and run it for
yourself; commercial use, redistribution and offering it as a service need
written permission. See [LICENSE](LICENSE).

## Design

The UI follows the RepoBoard Figma file: 230px sidebar, 68px top bar, dense
developer-tool spacing, off-white canvas (`#fbfbfa`), near-black ink
(`#121213`), thin `#e0e0de` borders and colour used only for state (green
`#2e7847` for synced, amber `#b8731a` for conflicts). Tokens live in
`tailwind.config.ts`.
