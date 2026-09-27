import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Tests never see the real ~/.repoboard (the keys of whoever runs them) or a
// token from the environment: each test file gets an empty home of its own.
process.env.HOME = fs.mkdtempSync(path.join(os.tmpdir(), "repoboard-test-home-"));
delete process.env.GITHUB_PAT;
