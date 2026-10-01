// The same story on GitLab (scripts/demo-gitlab.mjs on :4012): a public project,
// its plan moved to a private project RepoBoard creates, a second computer
// following, a teammate without access, RepoBoard's branch, and back to main.
const GL = "http://127.0.0.1:4012";
const A = "http://127.0.0.1:3107";
const B = "http://127.0.0.1:3108";
const C = "http://127.0.0.1:3109";
const ALEX = "glpat-alextest00000000000000";
const SAM = "glpat-member-sam_0000000000000";
const host = { kind: "gitlab", url: GL };

let failures = 0;
const ok = (c, w, x) => (c ? console.log(`  ✓ ${w}`) : (failures++, console.log(`  ✗ ${w}${x !== undefined ? ` — ${JSON.stringify(x).slice(0, 400)}` : ""}`)));
const step = (t) => console.log(`\n${t}`);
const call = async (base, path, body) => {
  const res = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json", "x-repoboard": "1" }, body: JSON.stringify(body) } : {});
  const text = await res.text();
  try {
    return { http: res.status, ...JSON.parse(text) };
  } catch {
    return { http: res.status, raw: text.slice(0, 300) };
  }
};
const gl = async (path) => {
  const res = await fetch(`${GL}/api/v4${path}`, { headers: { authorization: `Bearer ${ALEX}` } });
  return { status: res.status, json: await res.json().catch(() => null) };
};
const file = async (project, p, ref = "main") => {
  const r = await gl(`/projects/${encodeURIComponent(project)}/repository/files/${encodeURIComponent(p)}?ref=${ref}`);
  return r.status === 200 ? Buffer.from(r.json.content, "base64").toString("utf8") : null;
};
const tree = async (project, ref = "main") => ((await gl(`/projects/${encodeURIComponent(project)}/repository/tree?recursive=true&ref=${ref}`)).json ?? []).map?.((t) => t.path) ?? [];
const board = (base) => call(base, "/api/board");
const newCard = async (base, title) => {
  const d = await board(base);
  return call(base, "/api/board", { action: "create", columnId: d.columns?.[0]?.id, title, boardId: d.board?.id ?? d.boardId });
};
const titles = async (base) => ((await board(base)).tasks ?? []).map((t) => t.title);

step("1. A connects the GitLab project; documents are read, a card is saved in main");
let r = await call(A, "/api/repo", { token: ALEX, repo: "lumen/browser", host });
ok(r.connected, "A connected to GitLab", r);
await call(A, "/api/docs?watch=1&force=1");
const docsA = await call(A, "/api/docs");
ok((docsA.docs ?? []).length >= 9, `A tracks ${docsA.docs?.length} documents`, docsA);
await newCard(A, "Карточка в GitLab");
r = await call(A, "/api/docs", { action: "save-all", yours: [], seen: {} });
ok(r.commits?.length === 1, "saved in one commit", r);
ok((await file("lumen/browser", ".repoboard/board.json"))?.includes("Карточка в GitLab"), "main's board.json has the card");

step("2. RepoBoard creates the private plan project on GitLab and moves the plan there");
r = await call(A, "/api/plan", { action: "create", name: "browser-plan" });
ok(r.repo === "lumen/browser-plan", "created lumen/browser-plan", r);
ok((await gl(`/projects/${encodeURIComponent("lumen/browser-plan")}`)).json?.visibility === "private", "it is private");
r = await call(A, "/api/plan", { action: "preview", to: { mode: "repo", repo: "lumen/browser-plan" } });
ok(!r.preview?.problem && r.preview?.files?.length >= 9, `preview: ${r.preview?.files?.length} files`, r.preview?.problem ?? r);
const seen = Object.fromEntries((r.preview?.files ?? []).map((f) => [f.path, { source: f.sourceSha, target: f.targetSha }]));
r = await call(A, "/api/plan", { action: "move", to: { mode: "repo", repo: "lumen/browser-plan" }, leaveNote: true, removeOld: true, seen });
ok(typeof r.copied === "number" && r.copied >= 9, `moved ${r.copied} files`, r.error ?? r);
const planTree = await tree("lumen/browser-plan");
ok(planTree.includes(".repoboard/checklists/privacy-policy.md") && planTree.includes(".repoboard/board.json"), "the plan project has the files and the boards", planTree);
ok((await tree("lumen/browser")).filter((p) => p.startsWith(".repoboard/")).join() === ".repoboard/location.json", "main keeps only the note");
await newCard(A, "After the move");
await call(A, "/api/board", { action: "sync-now" });
ok((await file("lumen/browser-plan", ".repoboard/board.json"))?.includes("After the move"), "a new card syncs to the plan project");

step("3. B follows; sam is told until he is added");
r = await call(B, "/api/repo", { token: ALEX, repo: "lumen/browser", host });
r = await call(B, "/api/board", { action: "board-adopt" });
ok(r.plan?.location?.repo === "lumen/browser-plan", "B followed the note", r);
ok((await titles(B)).includes("After the move"), "B shows the cards");
r = await call(C, "/api/repo", { token: SAM, repo: "lumen/browser", host });
ok(r.connected, "sam connected", r);
r = await call(C, "/api/board", { action: "board-adopt" });
ok(r.plan?.blocked === "lumen/browser-plan", "sam is told the plan is in a project he cannot open", r);
await fetch(`${GL}/__test/projects/lumen/browser-plan/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "sam", level: 30 }) });
r = await call(C, "/api/board", { action: "board-adopt" });
ok(r.plan?.location?.repo === "lumen/browser-plan", "added as Developer, sam opens it", r);

step("4. To RepoBoard's branch (on GitLab cut from main, the plan replacing what main had)");
r = await call(A, "/api/plan", { action: "move", to: { mode: "branch" }, leaveNote: true, removeOld: false });
ok(typeof r.copied === "number", "moved to the branch", r.error);
ok((await file("lumen/browser", ".repoboard/location.json", "repoboard"))?.includes('"branch"'), "the branch says it holds the plan");
ok((await file("lumen/browser", ".repoboard/board.json", "repoboard"))?.includes("After the move"), "the boards are on the branch");
await call(B, "/api/board", { action: "sync-now" });
ok((await call(B, "/api/plan")).status?.location?.mode === "branch", "B's next sync followed");

step("5. Back to main");
r = await call(A, "/api/plan", { action: "move", to: { mode: "main" }, leaveNote: true, removeOld: false });
ok(typeof r.copied === "number", "back in main", r.error);
ok((await file("lumen/browser", ".repoboard/board.json"))?.includes("After the move"), "main's board.json has every card");
await call(B, "/api/board", { action: "sync-now" });
ok((await call(B, "/api/plan")).status?.location?.mode === "main", "B followed back");

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
process.exit(failures ? 1 : 0);
