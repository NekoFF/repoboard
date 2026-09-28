RepoBoard as a desktop app for macOS and Windows: the same app as in the browser, in its own window, with the system's translucent material behind it.

## What's new in 0.6.7

- **Agents write documents through RepoBoard.** An agent can propose a new document, add a check (what must be true, how to verify it, why), or mark a check ready with its proof. The proposal shows in the app at once. *Take into my changes* lets you review it and commit, or you discard it. Agents never write to GitHub themselves.
- **Closing a card names the checks it served.** The agent is told which document checks it can verify now.
- **A document with tables is not "empty".** Agents are told when a document has text but no checks yet.
- **Fixed:** the card number that *Make a card* adds to a document item was refused when committed.

## What's new in 0.6.6

- **Documents keep up with GitHub by themselves.** RepoBoard checks for a new commit every minute and whenever you come back to the app, and reads the documents again when there is one.
- **See where documents come from.** Documents show *Read from main at 8dc29fc, checked just now*, with *Check now*.
- **Documents from any branch.** An admin can choose the branch documents are read from and committed to, for example a working branch where the team keeps `.repoboard/`.
- **Agents know when their documents are missing.** An agent is told which branch RepoBoard reads, and which of its own `.repoboard/` files RepoBoard cannot see yet, so it no longer reports them as done.

## What's new in 0.6.5

- **Boards update by themselves.** What an agent or a teammate changes appears within a few seconds, with no reload. RepoBoard waits while you drag or type. The reload button still works.
- **Work and checks, joined.** Cards are for work. Document items are checks, things that must be true. *Make a card* on a check creates the work and adds its RB-n to the item. The item then shows the card and its state, and when the work is done it says *Work done — check it*.
- **Releases as documents.** Agents keep one document per release with everything that has to hold before it ships.
- **macOS: downloads open again.** A downloaded RepoBoard was reported as "damaged". It is now signed ad hoc, so macOS only says the developer is unknown, and you can allow that in System Settings → Privacy & Security.

## What's new in 0.6.4

- **Windows: updates no longer disconnect your AI agents.** Until now, every RepoBoard update on Windows closed the agents' connection, and it did not come back on its own. RepoBoard now keeps a copy of the agents' server that updates leave running, and that copy takes on the new version by itself. Set your agent up once more from **Settings → AI agents**, with the new command shown there. An agent on the old setup reminds you.

## What's new in 0.6.3

- **Boards keep syncing after a card changes boards.** When you or an agent moved a card to another board, the other computers could no longer sync. They now take the card on its new board.
- **Move a card to another board yourself.** On a card's page, choose ⋯ → *Move to board*. The card keeps its number, items and links.
- **Save to repo says so.** A moved card shows as one line, *moved X from the board A to B*.
- **Long agent output no longer locks a card.** Very long notes from an agent used to leave a card that could not be saved. Agents are now told the limit, and cards that are already too long get fitted to it.
- **Tighter checks.** Only an admin can change what agents may do, and only when GitHub confirms that role. You can confirm an agent's work only on the board you are viewing.
- An agent keeps working while an update is being written.

## What's new in 0.6.2

- **Copy works in the app.** Every copy button did nothing in the desktop app: the code for GitHub, the agent command in Settings, links. Now they copy, including *Copy the code and open GitHub*.
- **Set up Claude Code without a terminal.** If Claude Code runs in the Claude app, where there is no `claude` command, Settings shows the entry for its settings file. You can also paste it into a chat and have Claude add it.
- **Stable or Beta.** Settings → About lets you choose: finished versions only, or new versions first.
- **Agent tools stay compatible.** Agents written against RepoBoard's tools keep working in later versions. New tools and options are added; existing ones are not taken away.
- The copy button no longer covers long commands.

## What's new in 0.6.1

- **Agents keep up with RepoBoard.** An AI agent that is already connected follows a new version right away, with no restart. Its next answer brings the new rules.
- **Cards filled in properly.** Agents put the steps of a card in its items, with sub-items and notes on how to do and check each. If an agent writes a list of steps into the description, RepoBoard sends it back.
- **Work on the right board.** Agents move cards between boards and hear when the main board holds a pile that belongs on a board of its own.
- **Plans belong on boards.** A plan of work goes on a board. Documents are for lists you check against: a release, the privacy policy, licences. Agents are told what is already in the wrong place, and they move it.

## What's new in 0.6.0

- **AI agents close work when they can prove it.** An agent marks a card or item done when it checked the work itself, when you told it you did, or when it was done before, and it says how it knows. The proof shows on the card, and *Reopen* sends it back. Without proof, the work waits in Review for you. In Settings → AI agents you can make every close wait for you instead.
- **A calmer Inbox.** When an agent makes sixty changes in one go, the Inbox shows one line, for example *Claude made 60 changes: created 12 cards, moved 30…*. Open it to see each change.
- **Better organised boards.** Agents are told to give large areas such as Design, Security or Release a board of their own. They can now create one.
- **Who did what, at a glance.** The activity shows each agent's own mark and people's GitHub photos.
- **The version in Settings.** Settings → About says which version runs, with *Check for updates*.
- **Clearer answers for agents.** When an agent sends something wrong, RepoBoard tells it what to fix. It no longer passes on a database error.

## What's new in 0.5.0

- **GitLab too.** The connect screen has GitHub and GitLab. For GitLab, give it gitlab.com or your company's own server, get a key (the link opens GitLab's page already filled in), and pick your projects. Boards, sync, checklists, the project's life, merge requests and roles all work the same way.
- **Updates in one click on macOS too.** When RepoBoard is in Applications, *Update* → *Restart to update* puts the new version in place of the old one and opens it. There is only ever one RepoBoard, and the downloads are cleared away. (From 0.4.0 to 0.5.0 this still goes through the .dmg on a Mac, one last time.)
- **AI agents as participants.** They work under their own name, marked AI. Assign them cards; they find their work with `my_work`.
- **Safer.** A security pass closed a way for a web page to read the boards, among other smaller fixes.
- **The connect switch** now splits GitHub and GitLab evenly.

## What's new in 0.4.0

- **Sign in with GitHub.** One button and a short code to confirm on github.com. After that, every repository you allowed RepoBoard shows up, including the ones where you are only a collaborator. A key still works as the other way.
- **Boards sync on their own.** Turn it on once per project (board menu → *Sync the boards automatically*). Your other computers and your teammates then see the same boards without pressing Save or Sync. RepoBoard keeps the board file on a branch of its own, `repoboard`; your code is never touched.
- **Roles from GitHub.** Admins manage every board and make boards for people. Members work on cards and their own boards. Read-only people look. There is nothing to set up.
- **Boards kept to their owner.** A person's board can be shown to everyone, or only to its owner and the admins.
- **AI agents as participants.** Agents work under their own name, marked AI. You can assign them cards, and they find their work with `my_work`.
- **The tool rail on the right.** Pin boards, cards and checklists there. It also shows what waits for you: items to check, and board changes not yet saved to GitHub.
- **Safer.** RepoBoard answers only its own window and pages. The app's windows never show a page from outside it. Updates check the download and ask before installing.

## What's new in 0.3.0

- **A start screen and a clear way to connect.** Press *Get a key from GitHub*: GitHub opens with the key already filled in, and you tick your repository. Paste the key, and pick one or more repositories from the ones it opens. You don't type names or look up permissions.
- **No more dead ends.** When a project's key runs out, is deleted or loses access, RepoBoard says which and why. You can give it a new key, open another project, or try again. Settings shows which projects' keys still work. Errors and missing pages always have a way back.
- **Getting around the window:** ← → at the top, ⌘[ / ⌘] and a two-finger swipe on macOS, and Alt+← / Alt+→ and the mouse's side buttons on Windows. On macOS the window buttons now sit centred.
- **Updates from inside the app.** The app checks for new versions. On Windows it updates itself; on macOS it downloads and opens the new version.
- **Project covers:** sixteen small pixel scenes in twelve colours, a banner on Overview and a small version next to the project's name. There is also a new app icon.
- **Project life** now shows long branches from where they left, and branches that came back without a merge commit.
- Switching projects loads the window fresh, so one project's data never shows under another's name.

## Download

| System | File |
| ------ | ---- |
| macOS, Apple silicon (M1 and later) | `RepoBoard-…-mac-arm64.dmg` |
| macOS, Intel | `RepoBoard-…-mac-x64.dmg` |
| Windows 10 and 11 | `RepoBoard-…-win-x64.exe` |

## First start

The app is not signed with a paid Apple or Microsoft certificate yet, so the system asks once:

- **macOS:** open the .dmg and drag RepoBoard to Applications. The first time, right-click RepoBoard → **Open** → **Open**. (If macOS says the app is damaged, run `xattr -dr com.apple.quarantine /Applications/RepoBoard.app` in Terminal once.)
- **Windows:** if SmartScreen appears, click **More info** → **Run anyway**.

## Good to know

- Your boards and tokens live in `~/.repoboard`, the same place the web version uses, so both see the same projects.
- AI agents connect through the MCP server that comes with the app. **Settings → AI agents** shows the command for Claude Code, Codex, Cursor and Claude Desktop, and no Node.js is needed.
- **Updates:** the app checks GitHub Releases once after starting and every few hours. When there is a new version, a small *Update* pill appears at the top of the window. On Windows, it downloads the new version, installs it and starts it again. On macOS it does the same when RepoBoard is in Applications. Otherwise, for example when it runs straight from the disk image, it opens the new .dmg. There is only ever one RepoBoard: each version replaces the one before, and the downloaded files are cleared away. Your data stays where it is.
- **Getting around:** use ← → at the top of the window, **⌘[ / ⌘]** or a two-finger swipe on macOS, and **Alt+← / Alt+→** or the mouse's side buttons on Windows. **View → Reload** (⌘R / Ctrl+R) reloads the window.
- **If something goes wrong:** the app restarts its own server when it stops. If that doesn't help, it offers *Try again*, *Open the log* and *Quit*.
