import { describe, it, expect } from "vitest";
import { parseFields } from "../src/fields.js";
import { field } from "../src/toon.js";

const AVAILABLE = {
  area: { def: field("area") },
  iteration: { def: field("iteration") },
};

describe("parseFields", () => {
  it("returns no extra defs when --fields is not passed", () => {
    expect(parseFields(undefined, AVAILABLE)).toEqual({ extraDefs: [] });
  });

  it("resolves requested field names to their FieldDefs", () => {
    const result = parseFields("area,iteration", AVAILABLE);
    expect(result.extraDefs).toHaveLength(2);
  });

  it("de-duplicates repeated field names", () => {
    const result = parseFields("area,area", AVAILABLE);
    expect(result.extraDefs).toHaveLength(1);
  });

  it("throws a VALIDATION_ERROR listing unknown fields", () => {
    expect(() => parseFields("area,bogus", AVAILABLE)).toThrow(/Unknown field\(s\): bogus/);
  });
});
