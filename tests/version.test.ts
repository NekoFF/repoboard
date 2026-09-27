import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const { newer } = createRequire(import.meta.url)("../desktop/version.cjs") as { newer: (a: string, b: string) => boolean };

describe("update versions", () => {
  it("orders releases and their betas", () => {
    expect(newer("v0.6.2", "0.6.1")).toBe(true);
    expect(newer("0.6.1", "0.6.1")).toBe(false);
    expect(newer("0.10.0", "0.9.9")).toBe(true);
    expect(newer("v0.7.0-beta.1", "0.6.2")).toBe(true);
    expect(newer("v0.7.0", "0.7.0-beta.3")).toBe(true);
    expect(newer("0.7.0-beta.3", "0.7.0")).toBe(false);
    expect(newer("0.7.0-beta.10", "0.7.0-beta.9")).toBe(true);
    expect(newer("0.7.0-rc.1", "0.7.0-beta.2")).toBe(true);
    expect(newer("0.6.2", "0.7.0-beta.1")).toBe(false);
  });
});
