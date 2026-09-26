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
- Updates are not automatic yet. Download the new version from Releases and replace the app. Your data stays where it is.
