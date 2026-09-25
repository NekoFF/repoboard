#!/usr/bin/env node
/** Stops a RepoBoard dev server left running in the background. */
import { execSync } from "node:child_process";

const port = process.argv[2] ?? "3000";
try {
  // -sTCP:LISTEN matters: without it lsof also returns clients connected to
  // the port, and this would kill the browser instead of the server.
  const pids = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  if (pids.length === 0) {
    console.log(`Nothing is running on port ${port}.`);
  } else {
    for (const pid of pids) process.kill(Number(pid));
    console.log(`Stopped RepoBoard on port ${port}.`);
  }
} catch {
  console.log(`Nothing is running on port ${port}.`);
}
