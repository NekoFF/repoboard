#!/usr/bin/env node
/**
 * RepoBoard MCP server.
 *
 * Lets AI agents read and work the same board and checklists the person sees,
 * so several agents can share one picture of the project without a human
 * relaying it: what is done, what is open, what needs checking.
 *
 * It reads the same SQLite file the app uses (changes to cards show up in the
 * app immediately) and reads documents from GitHub with the stored token.
 *
 * Deliberately not exposed: anything that writes to the repository. Agents
 * edit files in .repoboard/ in their own working copy and push like any other
 * change; RepoBoard never commits on an agent's behalf.
 *
 * This file is only the process: the tools and their rules live in
 * mcp-core.mjs next to it. Before every request it looks whether that file
 * changed — RepoBoard was updated, or pulled — and if so loads the new one,
 * tells the client its tools changed, and puts the new rules in front of the
 * agent's next answer. An agent connected for hours follows today's rules
 * without being restarted.
 *
 *   claude mcp add repoboard -- node /path/to/repoboard/scripts/mcp-server.mjs
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import fs from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const CORE = path.join(path.dirname(fileURLToPath(import.meta.url)), "mcp-core.mjs");

let core = null;
let loadedAt = 0;
/** The rules this session was given, so a change is said once, when it happens. */
let rulesSeen = null;
let rulesChanged = false;
let server = null;

async function current() {
  let at = loadedAt;
  try {
    at = fs.statSync(CORE).mtimeMs;
  } catch {
    // Mid-update the file can be missing for a moment: keep the one loaded.
    if (core) return core;
  }
  if (core && at === loadedAt) return core;
  let next;
  try {
    next = await import(`${pathToFileURL(CORE).href}?v=${at}`);
  } catch (error) {
    // Caught mid-write, or broken: keep working with the copy already loaded
    // and look again on the next request (the file's time changes when it is done).
    if (!core) throw error;
    console.error("[repoboard-mcp] could not load the updated tools yet:", error?.message ?? error);
    return core;
  }
  next.setClient(() => server?.getClientVersion?.() ?? null);
  const previous = core;
  core = next;
  loadedAt = at;
  if (previous) {
    // A call the old copy started may still be reading; let it finish.
    setTimeout(() => previous.close(), 30_000).unref();
    if (next.RULES_VERSION !== rulesSeen) rulesChanged = true;
    server?.sendToolListChanged().catch(() => {});
    console.error("[repoboard-mcp] RepoBoard was updated: loaded the new tools and rules");
  }
  rulesSeen ??= next.RULES_VERSION;
  return core;
}

const first = await current();

server = new Server(
  { name: "repoboard", version: "0.6.15" },
  // The instructions go out once, on connect; after an update the new rules come with the next answer.
  { capabilities: { tools: { listChanged: true } }, instructions: first.INSTRUCTIONS },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: (await current()).tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const active = await current();
  const answer = await active.callTool(request.params.name, request.params.arguments);
  if (rulesChanged) {
    rulesChanged = false;
    rulesSeen = active.RULES_VERSION;
    answer.content.unshift({
      type: "text",
      text: `RepoBoard was updated while you were connected, and its rules for agents changed. Follow these from now on, for this and every later step:\n\n${active.INSTRUCTIONS}`,
    });
  }
  return answer;
});

await server.connect(new StdioServerTransport());
console.error(`[repoboard-mcp] ready · board at ${first.dbFile}`);
