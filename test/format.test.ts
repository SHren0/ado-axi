import { describe, it, expect } from "vitest";
import { formatCountLine, truncateBody } from "../src/format.js";

describe("formatCountLine", () => {
  it("renders a simple count when no limit or total applies", () => {
    expect(formatCountLine({ count: 5 })).toBe("count: 5");
  });

  it("renders a total when known", () => {
    expect(formatCountLine({ count: 5, totalCount: 23 })).toBe("count: 5 of 23 total");
  });

  it("flags a truncated result when count equals the limit", () => {
    expect(formatCountLine({ count: 50, limit: 50 })).toBe("count: 50 (showing first 50)");
  });

  it("does not flag truncation when count is below the limit", () => {
    expect(formatCountLine({ count: 3, limit: 50 })).toBe("count: 3");
  });
});

describe("truncateBody", () => {
  it("returns short text unchanged", () => {
    expect(truncateBody("hello")).toBe("hello");
  });

  it("returns an empty string for non-string input", () => {
    expect(truncateBody(undefined)).toBe("");
    expect(truncateBody(null)).toBe("");
  });

  it("truncates at ~1000 chars with a --full hint", () => {
    const long = "x".repeat(1500);
    const out = truncateBody(long);
    expect(out.length).toBeLessThan(long.length);
    expect(out).toContain("truncated, 1500 chars total");
    expect(out).toContain("--full");
  });
});
