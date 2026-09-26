RepoBoard as a desktop app for macOS and Windows: the same app as in the browser, in its own window, with the system's translucent material behind it.

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
- **Updates:** the app checks GitHub Releases once after starting and every few hours. When there is a new version, a small *Update* pill appears at the top of the window. On Windows, it downloads the new version, installs it and starts it again. On macOS, it downloads the new .dmg and opens it. Drag RepoBoard to Applications again, as the first time; macOS allows automatic replacement only for apps signed by Apple. Your data stays where it is.
- **Getting around:** use ← → at the top of the window, **⌘[ / ⌘]** or a two-finger swipe on macOS, and **Alt+← / Alt+→** or the mouse's side buttons on Windows. **View → Reload** (⌘R / Ctrl+R) reloads the window.
- **If something goes wrong:** the app restarts its own server when it stops. If that doesn't help, it offers *Try again*, *Open the log* and *Quit*.
