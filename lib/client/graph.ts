/**
 * Lays out a commit history as lanes, the way `git log --graph` does: each
 * commit gets a row and a lane; each parent link is drawn along the lane that
 * waited for that parent. Pure, so it is tested without a browser.
 */

export interface GraphInput {
  sha: string;
  parents: string[];
}

export interface GraphEdge {
  /** Row and lane of the child. */
  fromRow: number;
  fromLane: number;
  /** Row and lane of the parent. */
  toRow: number;
  toLane: number;
  /** The lane the line travels down in between. */
  viaLane: number;
  /** The second parent of a merge: drawn as a branch joining back in. */
  merge: boolean;
}

export interface GraphLayout {
  lanes: number[];
  edges: GraphEdge[];
  width: number;
}

/**
 * `mainHead` is the tip of the default branch. Its first-parent chain owns
 * lane 0 for the whole height, so the main line is always the straight one on
 * the left and branches visibly leave it and come back.
 */
export function layoutGraph(commits: GraphInput[], mainHead?: string): GraphLayout {
  const row = new Map(commits.map((c, i) => [c.sha, i]));
  const bySha = new Map(commits.map((c) => [c.sha, c]));
  const mainline = new Set<string>();
  for (let sha = mainHead; sha && bySha.has(sha) && !mainline.has(sha); sha = bySha.get(sha)!.parents[0]) {
    mainline.add(sha);
  }
  const reserved = mainline.size > 0;
  const waiting: (string | null)[] = [];
  const laneOf: number[] = [];
  const pending: { from: number; fromLane: number; via: number; parent: string; merge: boolean }[] = [];
  let width = 1;

  if (reserved) waiting.push(null);
  const free = () => {
    const start = reserved ? 1 : 0;
    for (let i = start; i < waiting.length; i += 1) if (waiting[i] === null) return i;
    waiting.push(null);
    return waiting.length - 1;
  };

  commits.forEach((commit, r) => {
    let lane = mainline.has(commit.sha) ? 0 : waiting.indexOf(commit.sha);
    if (lane === -1 || (reserved && lane === 0 && !mainline.has(commit.sha))) lane = free();
    // Every other lane that was waiting for this commit ends here.
    for (let i = 0; i < waiting.length; i += 1) if (waiting[i] === commit.sha) waiting[i] = null;
    laneOf[r] = lane;

    const inHistory = commit.parents.filter((p) => row.has(p));
    inHistory.forEach((parent, index) => {
      let via: number;
      if (reserved && mainline.has(commit.sha) && index === 0) {
        // The main line continuing down lane 0.
        via = 0;
        waiting[0] = parent;
      } else if (reserved && mainline.has(parent)) {
        // A branch that started from the main line: it keeps its own lane
        // until the fork point, then curves into lane 0.
        via = index === 0 && lane !== 0 ? lane : free();
        waiting[via] = parent;
      } else {
        via = waiting.indexOf(parent);
        if (via === -1 || (reserved && via === 0)) {
          const own = index === 0 && waiting[lane] === null && !(reserved && lane === 0);
          via = own ? lane : free();
          waiting[via] = parent;
        }
      }
      pending.push({ from: r, fromLane: lane, via, parent, merge: index > 0 });
    });
    width = Math.max(width, waiting.length);
  });

  const edges: GraphEdge[] = pending.map((p) => {
    const toRow = row.get(p.parent)!;
    return {
      fromRow: p.from,
      fromLane: p.fromLane,
      toRow,
      toLane: laneOf[toRow],
      viaLane: p.via,
      merge: p.merge,
    };
  });

  // Trailing empty lanes do not need space.
  const used = Math.max(0, ...laneOf, ...edges.map((e) => e.viaLane)) + 1;
  return { lanes: laneOf, edges, width: Math.min(width, used) };
}
