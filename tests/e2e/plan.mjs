// End to end: where the plan is kept, across three computers and two people,
// against the fake GitHub. A = alex (owner), B = alex on a second computer,
// C = sam (Write on the code, not in the plan's repository at first).
const GH = "http://127.0.0.1:4011";
const A = "http://127.0.0.1:3107";
const B = "http://127.0.0.1:3108";
const C = "http://127.0.0.1:3109";
const ALEX = "github_pat_11ALEXTEST000000000000_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab";
const SAM = "member-sam_11SAMTEST0000000000000_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab";

let failures = 0;
const ok = (cond, what, extra) => {
  if (cond) console.log(`  ✓ ${what}`);
  else {
    failures += 1;
    console.log(`  ✗ ${what}${extra !== undefined ? ` — ${typeof extra === "string" ? extra : JSON.stringify(extra).slice(0, 400)}` : ""}`);
  }
};
const step = (t) => console.log(`\n${t}`);

async function call(base, path, body) {
  const res = await fetch(base + path, body ? { method: "POST", headers: { "content-type": "application/json", "x-repoboard": "1" }, body: JSON.stringify(body) } : { headers: { "x-repoboard": "1" } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 300) };
  }
  return { status: res.status, ...json };
}
async function gh(path, { key = ALEX, method = "GET", body } = {}) {
  const res = await fetch(GH + path, { method, headers: { authorization: `token ${key}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function file(repo, path, ref) {
  const r = await gh(`/repos/${repo}/contents/${path}${ref ? `?ref=${ref}` : ""}`);
  return r.status === 200 ? Buffer.from(r.json.content, "base64").toString("utf8") : null;
}
async function tree(repo, ref = "main") {
  const r = await gh(`/repos/${repo}/git/trees/${ref}?recursive=1`);
  return r.status === 200 ? r.json.tree.map((t) => t.path) : [];
}
const commitsOn = async (repo, sha = "main") => (await gh(`/repos/${repo}/commits?sha=${sha}&per_page=100`)).json ?? [];

async function connect(base, key) {
  return call(base, "/api/repo", { token: key, repo: "lumen/browser" });
}
async function board(base) {
  return call(base, "/api/board");
}
async function newCard(base, title) {
  const data = await board(base);
  const todo = data.columns?.[0]?.id;
  return call(base, "/api/board", { action: "create", columnId: todo, title, boardId: data.board?.id ?? data.boardId });
}
const titles = async (base) => ((await board(base)).tasks ?? []).map((t) => t.title);

/* ------------------------------------------------------------------------- */

step("1. A connects the public demo project; the plan is in main, as always");
let r = await connect(A, ALEX);
ok(r.connected, "A connected", r);
r = await call(A, "/api/docs?watch=1&force=1");
const docsA = await call(A, "/api/docs");
ok((docsA.docs ?? []).length >= 9, `A tracks the repository's documents (${(docsA.docs ?? []).length})`, docsA);
r = await call(A, "/api/plan");
ok(r.status?.location?.mode === "main", "plan is kept in main", r);
ok(r.status?.codeVisibility === "public", "the code is public", r.status);
ok(r.status?.offer === true, "the one-time offer is shown", r.status);
r = await newCard(A, "Проверить запуск на новом компьютере");
ok(r.status === 200 || r.task || r.id, "A made a card (Cyrillic title)", r);
r = await call(A, "/api/docs", { action: "save-all", yours: [], seen: {} });
ok(r.commits?.length === 1, "save-all made one commit in main", r);
const boardInMain = await file("lumen/browser", ".repoboard/board.json");
ok(boardInMain?.includes("Проверить запуск"), "main's board.json has the card");
ok((await commitsOn("lumen/browser"))[0]?.commit.message.includes("[skip ci]"), "the commit says [skip ci]");

step("1b. B — a second computer, plan still in main — takes the boards when it opens (no button)");
r = await connect(B, ALEX);
r = await call(B, "/api/board", { action: "board-adopt" });
ok(r.status !== 400 && r.pulled >= 1, "B pulled the boards from main", r);
ok((await titles(B)).includes("Проверить запуск на новом компьютере"), "B shows A's card");

step("1c. A proves a check with a screenshot (a real PNG), so it travels with the move");
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
{
  const doc = await file("lumen/browser", ".repoboard/checklists/licenses.md");
  const i = doc.split("\n").findIndex((l) => /^- \[ \]/.test(l));
  const title = doc.split("\n")[i].replace(/^- \[ \] /, "").replace(/\s+[!@#].*$/, "");
  const sha = (await gh("/repos/lumen/browser/contents/.repoboard/checklists/licenses.md")).json.sha;
  const r2 = await call(A, "/api/docs", {
    action: "commit",
    path: ".repoboard/checklists/licenses.md",
    expectedSha: sha,
    edits: [{ type: "proof", line: i + 1, title, state: "review", by: "alex", checked: false, proofs: [{ kind: "image", path: ".repoboard/evidence/licences-shot.png", alt: "Скриншот" }] }],
    attachments: [{ path: ".repoboard/evidence/licences-shot.png", base64: png.toString("base64") }],
  });
  ok((await tree("lumen/browser")).includes(".repoboard/evidence/licences-shot.png"), "the screenshot is in main", r2.error ?? r2);
}

step("2. A wants it private: creates lumen/browser-plan (as on github.com/new) and checks it");
r = await gh("/orgs/lumen/repos", { method: "POST", body: { name: "browser-plan", private: true } });
ok(r.status === 201, "lumen/browser-plan created, empty and private", r.json);
r = await call(A, "/api/plan", { action: "preview", to: { mode: "repo", repo: "lumen/browser-plan" } });
ok(!r.preview?.problem, "preview has no problem", r.preview?.problem ?? r);
ok(r.preview?.toVisibility === "private", "the new place is private");
ok((r.preview?.files ?? []).length >= 9 && r.preview.files.every((f) => f.status === "new"), `${r.preview?.files?.length} files would be copied`, r.preview?.files);
const preview = r.preview;

step("3. A moves the plan, leaving a note and removing the old copy");
r = await call(A, "/api/plan", { action: "move", to: { mode: "repo", repo: "lumen/browser-plan" }, leaveNote: true, removeOld: true });
ok(r.copied === preview.files.length, `moved ${r.copied} files`, r.error ?? r.copied);
const planTree = await tree("lumen/browser-plan");
ok(preview.files.every((f) => planTree.includes(f.path)), "every file is in the plan's repository", planTree);
{
  const shot = await gh("/repos/lumen/browser-plan/contents/.repoboard/evidence/licences-shot.png");
  ok(shot.status === 200 && Buffer.from(shot.json.content, "base64").equals(png), "the screenshot arrived byte for byte");
}
ok(planTree.includes(".repoboard/board.json") && planTree.includes(".repoboard/location.json"), "board.json and location.json are there");
ok((await file("lumen/browser-plan", ".repoboard/board.json"))?.includes("Проверить запуск"), "the boards are there, Cyrillic intact");
const mainTree = await tree("lumen/browser");
ok(mainTree.filter((p) => p.startsWith(".repoboard/")).join() === ".repoboard/location.json", "main keeps only the note", mainTree.filter((p) => p.startsWith(".repoboard/")));
ok(JSON.parse((await file("lumen/browser", ".repoboard/location.json")) ?? "{}").movedTo?.repo === "lumen/browser-plan", "the note says where it went");
r = await call(A, "/api/plan");
ok(r.status?.location?.mode === "repo" && r.status.location.repo === "lumen/browser-plan", "A keeps the plan in lumen/browser-plan", r.status);
const docsAfter = await call(A, "/api/docs");
ok((docsAfter.docs ?? []).length === (docsA.docs ?? []).length, `A still tracks ${docsAfter.docs?.length} documents`, docsAfter.docs?.map((d) => d.path));
r = await call(A, `/api/docs?path=${encodeURIComponent(".repoboard/checklists/privacy-policy.md")}`);
ok((r.doc?.content ?? r.content ?? JSON.stringify(r)).includes("Privacy") || r.status === 200, "a checklist still opens", r.error);

step("4. A works: a new card syncs to the plan's repository, a document edit commits there — main is untouched");
const mainBefore = (await commitsOn("lumen/browser")).length;
await newCard(A, "Card after the move");
r = await call(A, "/api/board", { action: "sync-now" });
ok(r.pushed >= 1 || r.status === 200, "sync pushed", r);
ok((await file("lumen/browser-plan", ".repoboard/board.json"))?.includes("Card after the move"), "the new card is in the plan's board.json");
const docPath = ".repoboard/checklists/privacy-policy.md";
const docText = await file("lumen/browser-plan", docPath);
const firstItem = docText.split("\n").findIndex((l) => /^- \[ \]/.test(l));
r = await call(A, "/api/docs", {
  action: "save-all",
  yours: [{ path: docPath, edits: [{ type: "note", line: firstItem + 1, title: docText.split("\n")[firstItem].replace(/^- \[ \] /, ""), author: "alex", text: "Заметка после переезда" }] }],
  seen: {},
});
ok(r.documents === 1, "save-all saved the document", r);
ok((await file("lumen/browser-plan", docPath))?.includes("Заметка после переезда"), "the note is in the plan's repository");
ok((await commitsOn("lumen/browser")).length === mainBefore, "no new commit on the code's main");

step("5. B — alex's second computer — follows the plan by itself");
r = await call(B, "/api/board", { action: "board-adopt" });
ok(r.plan?.moved === true && r.plan.location.repo === "lumen/browser-plan", "B followed the note in main", r);
await call(B, "/api/docs?watch=1&force=1");
const tB = await titles(B);
ok(tB.includes("Проверить запуск на новом компьютере") && tB.includes("Card after the move"), "B shows both cards", tB);
const docsB = await call(B, "/api/docs");
ok((docsB.docs ?? []).length === (docsAfter.docs ?? []).length, `B tracks the same ${docsB.docs?.length} documents`, docsB.docs?.map((d) => d.path));

step("6. Both edit at once: B and A each make a card, both sync, both see both");
await newCard(B, "From B");
await newCard(A, "From A");
await call(B, "/api/board", { action: "sync-now" });
await call(A, "/api/board", { action: "sync-now" });
await call(B, "/api/board", { action: "sync-now" });
const tA2 = await titles(A);
const tB2 = await titles(B);
ok(tA2.includes("From B") && tA2.includes("From A"), "A has both", tA2);
ok(tB2.includes("From B") && tB2.includes("From A"), "B has both", tB2);
const nums = ((await board(A)).tasks ?? []).map((t) => t.cardNumber ?? t.number).filter(Boolean);
ok(new Set(nums).size === nums.length, "no two cards share a number", nums);

step("7. C — sam, Write on the code but not in the plan — is told, not shown an empty plan");
r = await connect(C, SAM);
ok(r.connected, "sam connected", r);
r = await call(C, "/api/board", { action: "board-adopt" });
ok(r.plan?.blocked === "lumen/browser-plan", "sam's RepoBoard knows the plan is in a repository it cannot open", r);
r = await call(C, "/api/plan");
ok(r.status?.blocked === "lumen/browser-plan", "the plan status says blocked (the notice shows)", r.status);
r = await call(A, "/api/plan?people=1");
ok((r.missing ?? []).includes("sam"), "A's People shows sam missing from the plan", r);
await fetch(`${GH}/__test/repos/lumen/browser-plan/people`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "sam", role: "write" }) });
r = await call(C, "/api/board", { action: "board-adopt" });
ok(r.plan?.location?.repo === "lumen/browser-plan" && !r.plan.blocked, "after alex adds sam, sam's RepoBoard opens the plan", r);
const tC = await titles(C);
ok(tC.includes("From A") && tC.includes("From B"), "sam sees the cards", tC);
r = await call(A, "/api/plan?people=1");
ok(!(r.missing ?? []).includes("sam"), "People no longer lists sam as missing", r);

step("8. A moves the plan to RepoBoard's own branch (a branch with nothing of the code)");
r = await call(A, "/api/plan", { action: "preview", to: { mode: "branch" } });
ok(!r.preview?.problem && r.preview.toVisibility === "public", "preview: the branch is as public as the repository", r.preview);
r = await call(A, "/api/plan", { action: "move", to: { mode: "branch" }, leaveNote: true, removeOld: false });
ok(typeof r.copied === "number", "moved to the branch", r.error);
const branchTree = await tree("lumen/browser", "repoboard");
ok(branchTree.length > 0 && branchTree.every((p) => p.startsWith(".repoboard/")), "the repoboard branch holds only the plan", branchTree);
const branchCommits = await commitsOn("lumen/browser", "repoboard");
ok(branchCommits.at(-1)?.parents.length === 0, "the branch has no history of the code's");
ok(JSON.parse((await file("lumen/browser-plan", ".repoboard/location.json")) ?? "{}").movedTo?.mode === "branch", "the plan's repository says where it went");
r = await call(A, "/api/github?resource=branches");
ok(!(r.branches ?? []).some((b) => b.name === "repoboard"), "Code → Branches does not show RepoBoard's branch", (r.branches ?? []).map((b) => b.name));
// B and sam already sync on their own: their next sync must notice the move, not their next adopt.
r = await call(B, "/api/board", { action: "sync-now" });
ok((await call(B, "/api/plan")).status?.location?.mode === "branch", "B's next sync followed to the branch", r);
r = await call(C, "/api/board", { action: "sync-now" });
ok((await call(C, "/api/plan")).status?.location?.mode === "branch", "sam's next sync followed to the branch", r);
ok(!(await file("lumen/browser-plan", ".repoboard/board.json"))?.includes("Sam on the branch"), "nothing new is written to the place the plan left");
await newCard(C, "Sam on the branch");
await call(C, "/api/board", { action: "sync-now" });
await call(A, "/api/board", { action: "sync-now" });
ok((await titles(A)).includes("Sam on the branch"), "sam's card reaches A through the branch");

step("9. Back to main, as it was");
r = await call(A, "/api/plan", { action: "move", to: { mode: "main" }, leaveNote: true, removeOld: true });
ok(typeof r.copied === "number", "moved back to main", r.error);
const mainAgain = await tree("lumen/browser");
ok(mainAgain.includes(".repoboard/checklists/privacy-policy.md") && mainAgain.includes(".repoboard/board.json"), "main has the plan and the boards again");
ok((await file("lumen/browser", ".repoboard/checklists/privacy-policy.md"))?.includes("Заметка после переезда"), "the note made while away came back");
ok((await file("lumen/browser", ".repoboard/board.json"))?.includes("Sam on the branch"), "the cards made while away came back");
r = await call(A, "/api/board", { action: "board-status" });
ok(r.autoSync === false && r.planMode === "main", "A saves by hand again, as before", r);
r = await call(B, "/api/board", { action: "sync-now" });
ok((await call(B, "/api/plan")).status?.location?.mode === "main", "B's next sync followed back to main", r);
r = await call(B, "/api/board", { action: "board-push" });
ok(!r.error || !/moved/.test(r.error), "B can save in main again", r);

step("10. A key that does not include the plan's repository is caught before anything moves");
r = await gh("/orgs/lumen/repos", { method: "POST", body: { name: "second-plan", private: true } });
await connect(C, "noplan_11NOPLAN000000000000_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ab");
r = await call(C, "/api/plan", { action: "preview", to: { mode: "repo", repo: "lumen/second-plan" } });
ok(r.preview?.problem?.code === "missing", "preview says the key cannot open it", r.preview?.problem ?? r);

step("11. Two moves in a row while sam's computer is away: it follows both hops");
await connect(C, SAM);
r = await call(C, "/api/board", { action: "board-adopt" });
ok((await call(C, "/api/plan")).status?.location?.mode === "main", "sam starts in main");
r = await call(A, "/api/plan", { action: "move", to: { mode: "branch" }, leaveNote: true, removeOld: false });
ok(typeof r.copied === "number", "A: main → branch", r.error);
r = await call(A, "/api/plan", { action: "move", to: { mode: "repo", repo: "lumen/browser-plan" }, leaveNote: true, removeOld: false });
ok(typeof r.copied === "number", "A: branch → lumen/browser-plan", r.error);
r = await call(C, "/api/board", { action: "board-adopt" });
ok(r.plan?.location?.repo === "lumen/browser-plan", "sam's RepoBoard followed main → branch → repository in one go", r);

step("12. Back to main sticks: nobody is sent off to an old place again");
r = await call(A, "/api/plan", { action: "move", to: { mode: "main" }, leaveNote: false, removeOld: false });
ok(typeof r.copied === "number", "A: back to main (the note is left even unticked)", r.error);
ok(JSON.parse((await file("lumen/browser", ".repoboard/location.json")) ?? "{}").mode === "main", "main's note says the plan is here");
ok(JSON.parse((await file("lumen/browser-plan", ".repoboard/location.json")) ?? "{}").movedTo?.mode === "main", "the repository's note says it went back to main");
r = await call(C, "/api/board", { action: "sync-now" });
r = await call(C, "/api/plan");
ok(r.status?.location?.mode === "main", "sam's next sync followed back to main", r.status?.location);
r = await call(C, "/api/board", { action: "board-adopt" });
r = await call(C, "/api/board", { action: "board-status" });
ok(r.planMode === "main" && r.autoSync === false, "and stays there: not pulled back to the branch, sync stays off", r);
r = await call(B, "/api/board", { action: "board-adopt" });
ok((await call(B, "/api/plan")).status?.location?.mode === "main", "B stays in main too");

step("13. A file changed between looking and moving: the move is refused, nothing switches");
r = await call(A, "/api/plan", { action: "preview", to: { mode: "branch" } });
const seen = Object.fromEntries(r.preview.files.map((f) => [f.path, { source: f.sourceSha, target: f.targetSha }]));
{
  const cur = await gh("/repos/lumen/browser/contents/.repoboard/notes/commands.md");
  await gh("/repos/lumen/browser/contents/.repoboard/notes/commands.md", { method: "PUT", body: { message: "teammate edit", sha: cur.json.sha, content: Buffer.from("# Commands\n\nChanged meanwhile\n").toString("base64") } });
}
r = await call(A, "/api/plan", { action: "move", to: { mode: "branch" }, leaveNote: true, removeOld: true, seen });
ok(r.code === "CONFLICT", "refused: it changed since the preview", r);
ok((await call(A, "/api/plan")).status?.location?.mode === "main", "A is still in main");
ok((await tree("lumen/browser")).includes(".repoboard/notes/commands.md"), "nothing was removed from main");

step("14. A plan moved to a repository of another owner: other computers ask, they do not follow on their own");
await gh("/user/repos", { method: "POST", body: { name: "personal-plan", private: true } });
r = await call(A, "/api/plan", { action: "move", to: { mode: "repo", repo: "alex/personal-plan" }, leaveNote: true, removeOld: false });
ok(typeof r.copied === "number", "A keeps the plan in alex/personal-plan", r.error);
r = await call(B, "/api/board", { action: "board-adopt" });
r = await call(B, "/api/plan");
ok(r.status?.location?.mode === "main" && r.status?.asked?.repo === "alex/personal-plan", "B asks instead of following", r.status);
r = await call(B, "/api/plan", { action: "use", to: { mode: "repo", repo: "alex/personal-plan" } });
ok(r.place === "alex/personal-plan", "after B says yes, B opens it there", r);

console.log(`\n${failures ? `${failures} FAILED` : "all passed"}`);
process.exit(failures ? 1 : 0);
