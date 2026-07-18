import { describe, it, expect } from "vitest";
import {
  field,
  pluck,
  lower,
  boolYesNo,
  mapEnum,
  custom,
  extract,
  renderList,
  renderHelp,
  renderError,
  renderOutput,
} from "../src/toon.js";

describe("extract", () => {
  it("extracts a plain field, defaulting to null when missing", () => {
    expect(extract({ id: 1 }, [field("id"), field("missing")])).toEqual({
      id: 1,
      missing: null,
    });
  });

  it("supports renaming via the `as` param", () => {
    expect(extract({ pullRequestId: 42 }, [field("pullRequestId", "id")])).toEqual({ id: 42 });
  });

  it("plucks a nested subkey", () => {
    expect(extract({ createdBy: { displayName: "Ada" } }, [pluck("createdBy", "displayName", "author")])).toEqual({
      author: "Ada",
    });
  });

  it("lowercases a string field", () => {
    expect(extract({ state: "Active" }, [lower("state")])).toEqual({ state: "active" });
  });

  it("maps yes/no for a boolean field", () => {
    expect(extract({ isDraft: true }, [boolYesNo("isDraft", "draft")])).toEqual({ draft: "yes" });
    expect(extract({ isDraft: false }, [boolYesNo("isDraft", "draft")])).toEqual({ draft: "no" });
  });

  it("maps an enum with a fallback", () => {
    const schema = [mapEnum("status", { active: "open" }, "unknown", "state")];
    expect(extract({ status: "active" }, schema)).toEqual({ state: "open" });
    expect(extract({ status: "weird" }, schema)).toEqual({ state: "unknown" });
  });

  it("runs a custom extractor", () => {
    const schema = [custom("total", (item: { a: number; b: number }) => item.a + item.b)];
    expect(extract({ a: 1, b: 2 }, schema)).toEqual({ total: 3 });
  });
});

describe("renderList / renderOutput", () => {
  it("renders a labeled TOON list", () => {
    const out = renderList("items", [{ id: 1 }, { id: 2 }], [field("id")]);
    expect(out).toContain("items");
    expect(out).toContain("1");
    expect(out).toContain("2");
  });

  it("drops empty blocks when combining output", () => {
    expect(renderOutput(["a", "", "b"])).toBe("a\nb");
  });
});

describe("renderHelp", () => {
  it("returns an empty string for no suggestions", () => {
    expect(renderHelp([])).toBe("");
  });

  it("renders a numbered, indented help block", () => {
    expect(renderHelp(["do this", "then that"])).toBe("help[2]:\n  do this\n  then that");
  });
});

describe("renderError", () => {
  it("includes the error, code, and suggestions", () => {
    const out = renderError("bad input", "VALIDATION_ERROR", ["fix it"]);
    expect(out).toContain("bad input");
    expect(out).toContain("VALIDATION_ERROR");
    expect(out).toContain("fix it");
  });
});
