import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { prepareMcpHome } = createRequire(import.meta.url)("../desktop/mcp-home.cjs") as {
  prepareMcpHome: (a: { installDir: string; exeName: string; serverDir: string; home: string }) => Promise<{ node: string; server: string; changed: number }>;
};

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

describe("the MCP copy outside the install folder (Windows)", () => {
  it("copies the runtime, the tools and the database module, then only what changed", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "repoboard-mcp-home-"));
    const install = path.join(root, "Program Files", "RepoBoard");
    const server = path.join(install, "resources", "server");
    const home = path.join(root, "LocalAppData", "RepoBoard", "mcp");
    write(path.join(install, "RepoBoard.exe"), "exe");
    write(path.join(install, "ffmpeg.dll"), "dll");
    write(path.join(install, "icudtl.dat"), "icu");
    write(path.join(install, "Uninstall RepoBoard.exe"), "bye");
    write(path.join(server, "mcp", "mcp-server.mjs"), "process");
    write(path.join(server, "mcp", "mcp-core.mjs"), "core v1");
    write(path.join(server, "node_modules", "better-sqlite3", "package.json"), "{}");
    write(path.join(server, "node_modules", "better-sqlite3", "lib", "index.js"), "lib");
    write(path.join(server, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"), "native");
    write(path.join(server, "node_modules", "better-sqlite3", "build", "Release", "obj", "big.o"), "not needed");
    write(path.join(server, "node_modules", "bindings", "bindings.js"), "b");
    write(path.join(server, "node_modules", "bindings", "package.json"), "{}");
    write(path.join(server, "node_modules", "file-uri-to-path", "index.js"), "f");
    write(path.join(server, "node_modules", "file-uri-to-path", "package.json"), "{}");
    write(path.join(server, "node_modules", "next", "index.js"), "not needed");

    const args = { installDir: install, exeName: "RepoBoard.exe", serverDir: server, home };
    const first = await prepareMcpHome(args);
    expect(first.node).toBe(path.join(home, "RepoBoard.exe"));
    expect(first.server).toBe(path.join(home, "server", "mcp", "mcp-server.mjs"));
    expect(fs.readFileSync(first.server, "utf8")).toBe("process");
    expect(fs.existsSync(path.join(home, "ffmpeg.dll"))).toBe(true);
    expect(fs.existsSync(path.join(home, "Uninstall RepoBoard.exe"))).toBe(false);
    expect(fs.existsSync(path.join(home, "server", "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"))).toBe(true);
    expect(fs.existsSync(path.join(home, "server", "node_modules", "better-sqlite3", "build", "Release", "obj"))).toBe(false);
    expect(fs.existsSync(path.join(home, "server", "node_modules", "next"))).toBe(false);
    expect(JSON.parse(fs.readFileSync(path.join(home, "ready.json"), "utf8"))).toMatchObject({ node: first.node, server: first.server });

    // Nothing new: nothing written.
    expect((await prepareMcpHome(args)).changed).toBe(0);

    // A new version: only the tools changed, and the copy follows.
    write(path.join(server, "mcp", "mcp-core.mjs"), "core v2");
    fs.utimesSync(path.join(server, "mcp", "mcp-core.mjs"), new Date(), new Date(Date.now() + 5000));
    expect((await prepareMcpHome(args)).changed).toBe(1);
    expect(fs.readFileSync(path.join(home, "server", "mcp", "mcp-core.mjs"), "utf8")).toBe("core v2");

    // Left aside by an earlier refresh: cleared away.
    write(path.join(home, "RepoBoard.exe.old-123"), "old exe");
    await prepareMcpHome(args);
    expect(fs.existsSync(path.join(home, "RepoBoard.exe.old-123"))).toBe(false);
    fs.rmSync(root, { recursive: true, force: true });
  });
});
