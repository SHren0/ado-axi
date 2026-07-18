import { describe, it, expect } from "vitest";
import {
  getFlag,
  takeFlag,
  takeBoolFlag,
  takeAllFlags,
  takeNumber,
  getPositional,
  takePositional,
} from "../src/args.js";

describe("getFlag", () => {
  it("returns the value following the flag", () => {
    expect(getFlag(["--org", "contoso", "--project", "x"], "--org")).toBe("contoso");
  });

  it("returns the value from --flag=value form", () => {
    expect(getFlag(["--org=contoso"], "--org")).toBe("contoso");
  });

  it("returns undefined when the flag is missing", () => {
    expect(getFlag(["--project", "x"], "--org")).toBeUndefined();
  });

  it("does not modify args", () => {
    const args = ["--org", "contoso"];
    getFlag(args, "--org");
    expect(args).toEqual(["--org", "contoso"]);
  });
});

describe("takeFlag", () => {
  it("removes flag and value from args", () => {
    const args = ["--org", "contoso", "--project", "x"];
    expect(takeFlag(args, "--org")).toBe("contoso");
    expect(args).toEqual(["--project", "x"]);
  });

  it("removes --flag=value form", () => {
    const args = ["--org=contoso", "--project", "x"];
    expect(takeFlag(args, "--org")).toBe("contoso");
    expect(args).toEqual(["--project", "x"]);
  });
});

describe("takeBoolFlag", () => {
  it("removes a present boolean flag and returns true", () => {
    const args = ["--draft", "--title", "x"];
    expect(takeBoolFlag(args, "--draft")).toBe(true);
    expect(args).toEqual(["--title", "x"]);
  });

  it("returns false and leaves args untouched when absent", () => {
    const args = ["--title", "x"];
    expect(takeBoolFlag(args, "--draft")).toBe(false);
    expect(args).toEqual(["--title", "x"]);
  });
});

describe("takeAllFlags", () => {
  it("collects repeated flag values and removes them all", () => {
    const args = ["--work-items", "1", "--title", "x", "--work-items", "2"];
    expect(takeAllFlags(args, "--work-items")).toEqual(["1", "2"]);
    expect(args).toEqual(["--title", "x"]);
  });

  it("returns an empty array when the flag is absent", () => {
    expect(takeAllFlags(["--title", "x"], "--work-items")).toEqual([]);
  });
});

describe("takeNumber", () => {
  it("finds and removes the first numeric positional arg", () => {
    const args = ["42", "--full"];
    expect(takeNumber(args, "PR")).toBe(42);
    expect(args).toEqual(["--full"]);
  });

  it("throws a VALIDATION_ERROR when no numeric arg is present", () => {
    expect(() => takeNumber(["--full"], "PR")).toThrow(/Missing PR number/);
  });
});

describe("getPositional / takePositional", () => {
  it("getPositional finds the first non-flag arg without removing it", () => {
    const args = ["--full", "my-repo"];
    expect(getPositional(args)).toBe("my-repo");
    expect(args).toEqual(["--full", "my-repo"]);
  });

  it("takePositional removes the first non-flag arg", () => {
    const args = ["--full", "my-repo"];
    expect(takePositional(args)).toBe("my-repo");
    expect(args).toEqual(["--full"]);
  });

  it("returns undefined when only flags are present", () => {
    expect(takePositional(["--full"])).toBeUndefined();
  });
});
