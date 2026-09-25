# RepoBoard Markdown

The conventions RepoBoard reads. They are ordinary markdown: a file written
this way looks right on github.com, in Obsidian and in any editor, and a
person or an AI agent can change it without RepoBoard running.

## The workspace folder

Everything that is not code lives in one folder at the root of the repository:

```
.repoboard/
  README.md        the rules below, for people and agents
  board.json       written by RepoBoard: every board with its cards, order, checklists, links
  checklists/      what must be done and checked
  notes/           how to run things, where they live
  decisions/       what was decided and why, with sources
```

RepoBoard tracks every `.md` file under `.repoboard/` automatically.
Checklists are pinned in the sidebar; notes and decisions are on the
Documents screen. Other markdown files in the repository can be tracked by
hand. The folder can be opened as an Obsidian vault.

## Items

Any list item that starts with a box is an item:

| Written | Means | Who sets it |
| ------- | ----- | ----------- |
| `- [ ]` | to do | anyone |
| `- [/]` | in progress | anyone |
| `- [?]` | done, **needs a person to check** | anyone |
| `- [x]` | done and checked | a person |
| `- [-]` | won't do (not counted in progress) | anyone |

GitHub draws `[ ]` and `[x]` as checkboxes; the other three show as text and
still read naturally. They follow the Obsidian Tasks convention.

Items are grouped by the nearest heading above them, at any depth. Items
nested under another item are its sub-items; RepoBoard folds them into their
parent until it is opened.

## On the item's line

All optional, anywhere on the line:

| Token | Meaning |
| ----- | ------- |
| `!urgent` `!high` `!medium` `!low` | priority |
| `@name` | owner (not an e-mail address: must follow a space) |
| `due:2026-10-01` | due date |
| `#tag` or `#area/sub` | tag; must start with a letter, so `#42` stays an issue number |
| `RB-12` | a card on the board |
| `[[notes/commands]]` or `[[docs/PLAN.md]]` | another document |
| `<!-- rb:task_x -->` | stable identity, added by RepoBoard where it needs one |

```markdown
- [/] Private tabs keep their own cookie jar !high @alex due:2026-10-01 #privacy RB-4
```

## Details and notes

Details are nested plain bullets. These keys have a meaning; anything else is
shown as a plain remark:

| Key | For |
| --- | --- |
| `Why:` | the reason — a law, a risk, a user |
| `Do:` | what to actually do |
| `How:` | a hint on how to do it |
| `Verify:` | exactly how a person can check it is done |
| `Source:` | a link that backs it up |
| `Done when:` | the acceptance criterion |
| `Note:` | anything else worth keeping |

Review notes are a nested quote, one paragraph per note, starting with who
wrote it and when:

```markdown
- [?] Impressum reachable from every screen !high #legal
  - Why: the provider must be easy to identify.
  - Verify: from a fresh install, reach it in two presses of the remote.
  - Source: https://www.gesetze-im-internet.de/ddg/__5.html
  > codex 2026-09-25: a contact form counts as the second contact channel.
  >
  > claude 2026-09-26: checked on Android TV 12, two presses.
```

Separate consecutive notes with an empty `>` line, or markdown joins them
into one paragraph. RepoBoard does this when it adds a note.

## Rules for AI agents

1. Read `.repoboard/` first; it is the shared state between people and agents.
2. Never set `[x]`. When something is finished, set `[?]` and make sure the
   item has a `Verify:` line a person can follow.
3. Add, do not rewrite. Missing something? Add an item. Disagree or know
   more? Add a note under the item.
4. Cite sources for anything legal, licensing or security related.
5. One topic per file; link with `[[…]]` instead of repeating.
6. Write `RB-n` in commit messages and pull requests for the card they
   belong to; RepoBoard links them to the card.

## The board file

A file whose headings are the board's columns (`## Todo`, `## In Progress`,
`## Review`, `## Done`) can drive the board: its items become cards, and
moving a card rewrites the file — always through a diff you review first.
Pick it with *Drive the board from this file* on the document's menu.
