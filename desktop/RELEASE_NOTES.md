RepoBoard as a desktop app for macOS and Windows: the same app as in the browser, in its own window, with the system's translucent material behind it.

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
