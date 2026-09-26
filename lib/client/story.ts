/**
 * The life of a project, from its commits: the main line from the first
 * commit to now, every branch that left it — when it started, when it came
 * back, or that it is still open — and the stretches of work in between,
 * grouped so that years of history still read at a glance.
 *
 * Pure: it takes commits with parents and returns nodes, edges and lanes; the
 * picture (ProjectStory) decides where they go on screen.
 */

export interface StoryCommit {
  sha: string;
  message: string;
  author: string | null;
  /** Milliseconds. */
  date: number;
  parents: string[];
  heads: string[];
}

export type StoryKind =
  /** The first commit we know of. */
  | "start"
  /** History goes further back than was fetched. */
  | "earlier"
  /** Ordinary work, one commit or a group of them. */
  | "work"
  /** Where a branch left. */
  | "fork"
  /** Where a branch came back. */
  | "merge"
  /** The newest commit of a branch that is still open. */
  | "tip"
  /** The newest commit of the default branch. */
  | "now";

export interface StoryNode {
  id: string;
  kind: StoryKind;
  /** 0 is the main line; branches take lanes above (negative) and below. */
  lane: number;
  branch: string;
  /** When it happened: the newest commit in the node. */
  time: number;
  /** Oldest first. */
  commits: StoryCommit[];
  pr: number | null;
  /** RB-n cards the commits mention. */
  cards: number[];
}

export interface StoryEdge {
  from: string;
  to: string;
  /** main and branch run along a lane; fork and merge join lanes. */
  kind: "main" | "branch" | "fork" | "merge";
  branch: string;
  /** The branch is not merged yet. */
  open: boolean;
}

export interface StoryBranch {
  name: string;
  lane: number;
  pr: number | null;
  open: boolean;
  from: number;
  to: number;
  commits: number;
}

export interface Story {
  nodes: StoryNode[];
  edges: StoryEdge[];
  branches: StoryBranch[];
  mainBranch: string;
  first: number;
  last: number;
  total: number;
}

const MERGE_PR = /^Merge pull request #(\d+) from [^/\s]+\/(\S+)/;
const MERGE_BRANCH = /^Merge (?:remote-tracking )?branch '([^']+)'/;

export function mergeInfo(message: string): { pr: number | null; branch: string | null } {
  const pr = message.match(MERGE_PR);
  if (pr) return { pr: Number(pr[1]), branch: pr[2] };
  const branch = message.match(MERGE_BRANCH);
  if (branch) return { pr: null, branch: branch[1] };
  return { pr: null, branch: null };
}

export function cardsIn(commits: StoryCommit[]): number[] {
  const found = new Set<number>();
  for (const c of commits) for (const m of c.message.matchAll(/\bRB-(\d{1,6})\b/g)) found.add(Number(m[1]));
  return [...found].sort((a, b) => a - b);
}

/** Up to `max` commits per group, and never across a calendar month. */
function chunk(commits: StoryCommit[], max = 30): StoryCommit[][] {
  const groups: StoryCommit[][] = [];
  const month = (t: number) => {
    const d = new Date(t);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  };
  for (const c of commits) {
    const last = groups[groups.length - 1];
    if (last && last.length < max && month(last[last.length - 1].date) === month(c.date)) last.push(c);
    else groups.push([c]);
  }
  return groups;
}

export function buildStory(input: StoryCommit[], mainBranch: string): Story {
  const bySha = new Map(input.map((c) => [c.sha, c]));
  const newest = [...input].sort((a, b) => b.date - a.date);
  const head = input.find((c) => c.heads.includes(mainBranch)) ?? newest[0];
  const empty: Story = { nodes: [], edges: [], branches: [], mainBranch, first: 0, last: 0, total: 0 };
  if (!head) return empty;

  // The main line: the first-parent chain back from the default branch's tip.
  const mainline: StoryCommit[] = [];
  const onMain = new Set<string>();
  for (let c: StoryCommit | undefined = head; c && !onMain.has(c.sha); c = bySha.get(c.parents[0])) {
    mainline.push(c);
    onMain.add(c.sha);
  }
  mainline.reverse();
  const truncated = mainline[0].parents.length > 0;

  // Branches: first those that were merged back (from their merge commits),
  // then the ones still open (from their tips).
  interface Segment {
    name: string;
    pr: number | null;
    open: boolean;
    commits: StoryCommit[];
    base: string | null;
    merge: string | null;
  }
  const segments: Segment[] = [];
  const owner = new Map<string, Segment>();
  const walk = (start: string, segment: Segment) => {
    const list: StoryCommit[] = [];
    let c = bySha.get(start);
    while (c && !onMain.has(c.sha) && !owner.has(c.sha)) {
      list.push(c);
      owner.set(c.sha, segment);
      c = bySha.get(c.parents[0]);
    }
    segment.commits = list.reverse();
    segment.base = c ? c.sha : null;
  };
  for (const m of mainline) {
    if (m.parents.length < 2) continue;
    for (const second of m.parents.slice(1)) {
      if (!bySha.has(second) || onMain.has(second) || owner.has(second)) continue;
      const info = mergeInfo(m.message);
      const segment: Segment = { name: info.branch ?? "branch", pr: info.pr, open: false, commits: [], base: null, merge: m.sha };
      walk(second, segment);
      if (segment.commits.length) segments.push(segment);
    }
  }
  for (const c of newest) {
    for (const name of c.heads) {
      if (name === mainBranch || onMain.has(c.sha) || owner.has(c.sha)) continue;
      const segment: Segment = { name, pr: null, open: true, commits: [], base: null, merge: null };
      walk(c.sha, segment);
      if (segment.commits.length) segments.push(segment);
    }
  }

  // Lanes: branches that overlap in time go on different lanes, alternating
  // above and below the main line, nearest first.
  const busy = new Map<number, [number, number][]>();
  const laneFor = (from: number, to: number) => {
    const pad = (to - from) * 0.05 + 1;
    for (let k = 1; k < 50; k += 1) {
      for (const lane of [-k, k]) {
        const taken = busy.get(lane) ?? [];
        if (taken.every(([a, b]) => to + pad < a || from - pad > b)) {
          busy.set(lane, [...taken, [from, to]]);
          return lane;
        }
      }
    }
    return 50;
  };

  const nodes: StoryNode[] = [];
  const edges: StoryEdge[] = [];
  const nodeOf = new Map<string, string>();
  const make = (kind: StoryKind, lane: number, branch: string, commits: StoryCommit[], pr: number | null = null) => {
    const node: StoryNode = {
      id: `${kind}:${commits[commits.length - 1].sha}`,
      kind,
      lane,
      branch,
      time: commits[commits.length - 1].date,
      commits,
      pr,
      cards: cardsIn(commits),
    };
    for (const c of commits) nodeOf.set(c.sha, node.id);
    nodes.push(node);
    return node;
  };

  // Main line nodes: the start, every fork and merge, now — and the work in between, grouped.
  const bases = new Set(segments.map((s) => s.base).filter(Boolean) as string[]);
  const merges = new Map(segments.filter((s) => s.merge).map((s) => [s.merge!, s]));
  const mainNodes: StoryNode[] = [];
  let run: StoryCommit[] = [];
  const flush = () => {
    for (const group of chunk(run)) mainNodes.push(make("work", 0, mainBranch, group));
    run = [];
  };
  mainline.forEach((c, i) => {
    const first = i === 0;
    const last = i === mainline.length - 1;
    const key = first || last || bases.has(c.sha) || merges.has(c.sha);
    if (!key) {
      run.push(c);
      return;
    }
    flush();
    const kind: StoryKind = last ? "now" : merges.has(c.sha) ? "merge" : first ? (truncated ? "earlier" : "start") : "fork";
    const merged = merges.get(c.sha);
    mainNodes.push(make(kind, 0, mainBranch, [c], merged?.pr ?? mergeInfo(c.message).pr));
  });
  flush();
  for (let i = 1; i < mainNodes.length; i += 1) {
    edges.push({ from: mainNodes[i - 1].id, to: mainNodes[i].id, kind: "main", branch: mainBranch, open: false });
  }

  const branches: StoryBranch[] = [];
  // Oldest branch first, so lanes fill from the start of the project.
  segments.sort((a, b) => a.commits[0].date - b.commits[0].date);
  for (const s of segments) {
    const from = s.base ? (bySha.get(s.base)?.date ?? s.commits[0].date) : s.commits[0].date;
    const to = s.merge ? bySha.get(s.merge)!.date : Math.max(s.commits[s.commits.length - 1].date, head.date);
    const lane = laneFor(from, to);
    // Few commits show one by one; more show as first, the rest, last.
    const list = s.commits;
    const groups = list.length <= 3 ? list.map((c) => [c]) : [[list[0]], list.slice(1, -1), [list[list.length - 1]]];
    const own = groups.map((g, i) => make(s.open && i === groups.length - 1 ? "tip" : "work", lane, s.name, g, s.pr));
    for (let i = 1; i < own.length; i += 1) {
      edges.push({ from: own[i - 1].id, to: own[i].id, kind: "branch", branch: s.name, open: s.open });
    }
    const baseNode = s.base ? nodeOf.get(s.base) : undefined;
    if (baseNode) edges.push({ from: baseNode, to: own[0].id, kind: "fork", branch: s.name, open: s.open });
    if (s.merge) edges.push({ from: own[own.length - 1].id, to: nodeOf.get(s.merge)!, kind: "merge", branch: s.name, open: false });
    branches.push({ name: s.name, lane, pr: s.pr, open: s.open, from, to, commits: list.length });
  }

  const times = input.map((c) => c.date);
  return {
    nodes,
    edges,
    branches,
    mainBranch,
    first: Math.min(...times),
    last: Math.max(...times),
    total: input.length,
  };
}

/**
 * Where each node sits along the time axis. Time is compressed: a quiet month
 * takes a little more room than a busy hour, not a thousand times more, so a
 * project of years and a project of days both fill the width.
 */
export function storyPositions(nodes: StoryNode[], laneGap = 74): Map<string, { x: number; y: number }> {
  const sorted = [...nodes].sort((a, b) => a.time - b.time || a.lane - b.lane);
  const out = new Map<string, { x: number; y: number }>();
  let x = 0;
  let prev = sorted[0]?.time ?? 0;
  for (const n of sorted) {
    const hours = Math.max(0, (n.time - prev) / 3_600_000);
    x += out.size === 0 ? 0 : Math.min(46 + 22 * Math.log1p(hours / 6), 150);
    out.set(n.id, { x, y: n.lane * laneGap });
    prev = n.time;
  }
  return out;
}
