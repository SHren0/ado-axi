import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { takeBody } from "../src/body.js";

describe("takeBody", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ado-axi-body-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined and leaves args untouched when optional and absent", () => {
    const args = ["--title", "x"];
    expect(takeBody(args)).toBeUndefined();
    expect(args).toEqual(["--title", "x"]);
  });

  it("throws when required and absent", () => {
    expect(() => takeBody([], { required: true })).toThrow(
      /--description or --description-file is required/,
    );
  });

  it("reads inline --description and removes it from args", () => {
    const args = ["--description", "hello world", "--title", "x"];
    expect(takeBody(args)).toBe("hello world");
    expect(args).toEqual(["--title", "x"]);
  });

  it("reads --description-file contents", () => {
    const file = join(dir, "body.md");
    writeFileSync(file, "from file\n", "utf-8");
    expect(takeBody(["--description-file", file])).toBe("from file\n");
  });

  it("throws when both --description and --description-file are given", () => {
    expect(() => takeBody(["--description", "a", "--description-file", "b"])).toThrow(
      /only one description source/,
    );
  });

  it("throws a clear error for a missing --description-file path", () => {
    expect(() => takeBody(["--description-file", "/nope/does-not-exist.md"])).toThrow(
      /path not found/,
    );
  });
});
