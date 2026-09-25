/**
 * Starting points for the .repoboard workspace. They are ordinary markdown in
 * the RepoBoard format — see docs/FORMAT.md — so they read fine on GitHub and
 * in Obsidian, and any person or agent can extend them by editing the file.
 *
 * The legal checklists are reminders of what to look at, written carefully,
 * but they are not legal advice: each one says so at the top.
 */

export type DocKind = "checklist" | "note" | "decision" | "document";

export interface DocTemplate {
  id: string;
  kind: Exclude<DocKind, "document">;
  title: string;
  /** Shown in the picker: what the template is for, in one sentence. */
  summary: string;
  /** File name inside the kind's folder. */
  file: string;
  content: string;
}

export const WORKSPACE_DIR = ".repoboard";

export const KIND_FOLDER: Record<Exclude<DocKind, "document">, string> = {
  checklist: "checklists",
  note: "notes",
  decision: "decisions",
};

export function kindOfPath(path: string): DocKind {
  // The workspace's own guide is something you read, not a checklist.
  if (/^\.repoboard\/[^/]+\.md$/i.test(path)) return "note";
  const match = path.match(/^\.repoboard\/(checklists|notes|decisions)\//);
  if (!match) return "document";
  return ({ checklists: "checklist", notes: "note", decisions: "decision" } as const)[
    match[1] as "checklists" | "notes" | "decisions"
  ];
}

export function templatePath(template: Pick<DocTemplate, "kind" | "file">): string {
  return `${WORKSPACE_DIR}/${KIND_FOLDER[template.kind]}/${template.file}`;
}

const NOT_ADVICE =
  "> This checklist helps you not to forget things. It is not legal advice: laws change and depend on where you and your users are. When something is unclear, ask someone qualified.";

/* ----------------------------------------------------------- the guide -- */

export const WORKSPACE_README = `# Project workspace

This folder is the project's memory. It is plain markdown, so it reads fine on
GitHub, opens as an Obsidian vault, and is what [RepoBoard](https://github.com/NekoFF/repoboard)
shows as checklists, notes and progress.

| Folder | What goes there |
| ------ | --------------- |
| \`checklists/\` | Things that must be done **and checked**: a release, the privacy policy, licences. |
| \`notes/\` | Knowledge: how to run and test the project, where things live, commands. |
| \`decisions/\` | What was decided and why, with sources, so nobody re-argues it later. |
| \`board.json\` | Written by RepoBoard: every board — for people and areas — with its cards, order, checklists and links. |

## Items

\`\`\`markdown
- [ ] todo            - [/] in progress
- [?] needs checking  - [x] done            - [-] won't do
\`\`\`

On the item's line, optionally: \`!urgent\` \`!high\` \`!medium\` \`!low\`, \`@owner\`,
\`due:2026-10-01\`, \`#tag\`, \`RB-12\` (a board card), \`[[notes/commands]]\` (another file).

Details go underneath as plain bullets, review notes as a quote:

\`\`\`markdown
- [ ] Impressum reachable from every screen !high #legal
  - Why: the provider must be easy to identify.
  - Do: Settings → About → Legal notice, with name, address and e-mail.
  - Verify: from a fresh install, reach it in two taps.
  - Source: https://www.gesetze-im-internet.de/ddg/__5.html
  > codex 2026-09-25: a contact form can be the second contact channel.
\`\`\`

## Rules for AI agents

1. **Read this folder first.** It is the shared state between people and agents.
2. **Never mark an item \`[x]\`.** When you think something is finished, set it to
   \`[?]\` and write under \`Verify:\` exactly how a person can check it. Only a
   person ticks items off.
3. **Add, do not rewrite.** If something is missing, add an item. If you disagree
   or know more, add a note (\`> yourname date: …\`) under the item instead of
   editing someone else's text.
4. **Cite sources** for anything legal, licensing or security related.
5. **Keep one topic per file**, and link files with \`[[…]]\` instead of repeating them.
`;

/* ------------------------------------------------------------ templates -- */

export const TEMPLATES: DocTemplate[] = [
  {
    id: "release",
    kind: "checklist",
    title: "Release checklist",
    summary: "Everything to check before a version goes out.",
    file: "release.md",
    content: `# Release checklist

## Before the release

- [ ] All items in [[checklists/privacy-policy]] and [[checklists/licenses]] are done or cancelled !high
- [ ] Version number and changelog updated
  - Verify: the version shown in the app's About screen matches the tag.
- [ ] Clean build from a fresh clone
  - Do: clone into an empty folder, install, build, run.
  - Verify: no step needed anything that is not written in [[notes/commands]].
- [ ] Tested on the oldest and the newest supported device or OS
- [ ] No debug logging, test keys or personal data in the build

## Store listing

- [ ] Screenshots and description match the current version
- [ ] Privacy policy URL works and points to the current text
- [ ] Data safety / privacy labels match what the app actually collects
- [ ] Contact e-mail in the listing is monitored

## After the release

- [ ] Tag pushed and release notes published
- [ ] Crash reports checked after 24 hours
`,
  },
  {
    id: "privacy",
    kind: "checklist",
    title: "Privacy policy (GDPR)",
    summary: "What a privacy policy has to say when you have users in the EU.",
    file: "privacy-policy.md",
    content: `# Privacy policy

${NOT_ADVICE}

## Know your data first

- [ ] List every piece of personal data the app or website processes !high
  - Do: include IP addresses, crash reports, analytics, cookies, account data, anything sent to a server.
  - Verify: the list in [[decisions/data-inventory]] matches what the code does.
- [ ] For each: why it is needed and the legal basis (consent, contract, legal obligation, legitimate interest)
- [ ] For each: how long it is kept and when it is deleted
- [ ] Every third party that receives data (hosting, crash reporting, analytics, fonts or scripts loaded from a CDN)
  - Why: loading fonts from a third-party server sends the user's IP address there.

## What the policy must contain (GDPR Art. 13)

- [ ] Who is responsible (name and contact details of the controller)
  - Source: https://eur-lex.europa.eu/eli/reg/2016/679/oj
- [ ] Contact of the data protection officer, if you have to have one
- [ ] Purposes and legal basis of each processing
- [ ] The legitimate interests, where that is the basis
- [ ] Recipients or categories of recipients
- [ ] Transfers outside the EU/EEA and the safeguard used
- [ ] Retention periods, or how they are decided
- [ ] The user's rights: access, correction, deletion, restriction, portability, objection
- [ ] The right to withdraw consent at any time
- [ ] The right to complain to a supervisory authority
- [ ] Whether giving the data is required, and what happens if the user does not
- [ ] Automated decision-making or profiling, if any

## Make it real

- [ ] Consent is asked before any non-essential tracking starts, and can be refused as easily as given
- [ ] The policy is reachable from inside the app and from the store listing
- [ ] Written in plain language, in the languages of your users
- [ ] Dated, and updated whenever the data list changes
`,
  },
  {
    id: "impressum",
    kind: "checklist",
    title: "Impressum (Germany)",
    summary: "Provider identification for websites and apps offered in Germany.",
    file: "impressum.md",
    content: `# Impressum

${NOT_ADVICE}

Since 14 May 2024 the rule is § 5 DDG (it replaced § 5 TMG).
Source: https://www.gesetze-im-internet.de/ddg/__5.html

## Does it apply

- [ ] Decide whether the service is "geschäftsmäßig" (usually offered for more than purely private use) !high
  - Why: most public apps and websites count, even free ones.
  - Verify: the reasoning is written down in [[decisions/impressum]].

## Required content

- [ ] Full name (for a company: name, legal form, and who represents it)
- [ ] Postal address where you can be served (not a P.O. box)
- [ ] E-mail address
- [ ] A second fast way to reach you (phone or a contact form that gets answered quickly)
- [ ] Register and number, if registered (Handelsregister, Vereinsregister …)
- [ ] VAT identification number, if you have one
- [ ] Supervisory authority, if the activity needs a licence
- [ ] For regulated professions: chamber, title and rules

## Placement

- [ ] Easy to recognise, directly reachable and always available
  - Verify: in the app and on the website, reachable within two clicks or taps from every screen.
- [ ] If the service has journalistic or editorial content: a responsible person (§ 18 MStV)
`,
  },
  {
    id: "licenses",
    kind: "checklist",
    title: "Licences and assets",
    summary: "Fonts, icons, images and dependencies you are allowed to ship.",
    file: "licenses.md",
    content: `# Licences and assets

${NOT_ADVICE}

## Fonts

- [ ] Every font in the app is listed with its licence !high
  - Do: record name, source URL and licence in [[decisions/fonts]].
  - Why: many "free" fonts are free for personal use only, or only for the web.
- [ ] Each font's licence allows embedding in an app you distribute (e.g. SIL OFL 1.1, Apache 2.0)
- [ ] Licence texts are shipped with the app where the licence asks for it
- [ ] Fonts are bundled, not loaded from a third-party server at runtime
  - Why: loading from a CDN sends user IP addresses to that server (see [[checklists/privacy-policy]]).

## Code dependencies

- [ ] Generate the list of dependencies and their licences
  - Do: e.g. \`npx license-checker --summary\`, or Gradle's licence report for Android.
- [ ] No licence conflicts with how you distribute (e.g. GPL code inside a closed-source app)
- [ ] Required notices (Apache NOTICE files, MIT copyright lines) shown in an "Open-source licences" screen

## Icons, images, sounds

- [ ] Every asset has a known source and licence
- [ ] Attribution given where the licence requires it
- [ ] No brand logos used in a way that suggests endorsement
`,
  },
  {
    id: "commands",
    kind: "note",
    title: "Commands",
    summary: "How to install, run, test and ship — the things you look up twice.",
    file: "commands.md",
    content: `# Commands

## Set up

\`\`\`bash
# install dependencies
\`\`\`

## Run

\`\`\`bash
# start the app
\`\`\`

## Test

\`\`\`bash
# run the tests
\`\`\`

## Release

\`\`\`bash
# build a release
\`\`\`

## Where things are

| What | Where |
| ---- | ----- |
| Entry point | |
| Settings | |
| Tests | |
`,
  },
  {
    id: "map",
    kind: "note",
    title: "Project map",
    summary: "Where things live in the code and how the parts fit together.",
    file: "project-map.md",
    content: `# Project map

A short tour for a new person — or a new AI session — so nobody has to rediscover it.

## Parts

- **Part name** — what it does, where it lives (\`path/\`), what it talks to.

## Things that are easy to break

-

## Related

- [[notes/commands]]
`,
  },
  {
    id: "decision",
    kind: "decision",
    title: "Decision record",
    summary: "One decision, the options that were considered, and why this one.",
    file: "decision.md",
    content: `# Decision: …

- Status: proposed
- Date: ${new Date().toISOString().slice(0, 10)}

## What had to be decided

## Options considered

1. **Option A** — pros, cons.
2. **Option B** — pros, cons.

## Decision

## Why

## Sources

-
`,
  },
];

export function templateById(id: string): DocTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
