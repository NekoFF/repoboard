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

`board.json` lives on the default branch when boards are saved by hand
(Board → Save to repo). With automatic sync on, RepoBoard keeps it on a
branch of its own, `repoboard`, cut from the default branch the first time;
only that file is ever written there.

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
| `Proof:` | evidence that it is done: a link, the quoted words, or a screenshot |
| `Checked:` | who checked it and when — `name, YYYY-MM-DD` |

### Proof

When a person marks an item done with proof, RepoBoard writes one `Proof:`
line per piece of evidence and a `Checked:` line under the item, in the same
commit as the tick:

```markdown
- [x] Every third party that receives data #privacy
  - Proof: [docs/legal/privacy-policy.md, lines 40–52](https://github.com/o/r/blob/3f2a…/docs/legal/privacy-policy.md#L40-L52)
  - Proof: “We send crash reports to Sentry, hosted in the EU.”
  - Proof: ![Settings, About, Privacy](../evidence/privacy-policy-every-third-party-20260926-101500.webp)
  - Checked: neko, 2026-09-26
```

A file reference is a permalink to the commit it was checked at, so it keeps
pointing at the words that were checked. Screenshots live in
`.repoboard/evidence/`, linked relative to the checklist so they show on
GitHub too. A multi-line quote keeps its lines apart with ` / `.

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
2. Never set `[x]`, and never write `Checked:`. When something is finished,
   set `[?]`, make sure the item has a `Verify:` line a person can follow,
   and add `Proof:` lines — where it is written, the words — so the person
   checking starts from evidence.
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
