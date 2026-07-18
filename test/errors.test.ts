import { describe, it, expect } from "vitest";
import { mapAzError, exitCodeForError, AxiError } from "../src/errors.js";

describe("mapAzError", () => {
  it("maps the real az 'organization must be specified' message", () => {
    const stderr =
      "ERROR: --organization must be specified. The value should be the URI of your Azure DevOps organization, for example: https://dev.azure.com/MyOrganization/. You can set a default value by running: az devops configure --defaults organization=https://dev.azure.com/MyOrganization/.";
    const error = mapAzError(stderr, 2);
    expect(error.code).toBe("ORG_NOT_CONFIGURED");
    expect(error.suggestions.length).toBeGreaterThan(0);
  });

  it("maps the real az 'project must be specified' message", () => {
    const stderr =
      "ERROR: --project must be specified. The value should be the ID or name of a team project.";
    const error = mapAzError(stderr, 2);
    expect(error.code).toBe("PROJECT_NOT_CONFIGURED");
  });

  it("maps the real az unauthenticated message", () => {
    const stderr =
      "ERROR: Before you can run Azure DevOps commands, you need to run the login command(az login if using AAD/MSA identity else az devops login if using PAT token) to setup credentials.";
    const error = mapAzError(stderr, 1);
    expect(error.code).toBe("AUTH_REQUIRED");
  });

  it("maps a work item not-found message", () => {
    const error = mapAzError("ERROR: work item 999999 does not exist", 1);
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toContain("999999");
  });

  it("falls back to a generic not-found for other 'not found' text", () => {
    const error = mapAzError("ERROR: Something obscure was not found here", 1);
    expect(error.code).toBe("NOT_FOUND");
  });

  it("falls back to UNKNOWN with the first stderr line, skipping WARNING lines", () => {
    const error = mapAzError(
      "WARNING: some noisy warning\nERROR: totally unrecognized failure",
      1,
    );
    expect(error.code).toBe("UNKNOWN");
    expect(error.message).toBe("totally unrecognized failure");
  });
});

describe("exitCodeForError", () => {
  it("returns 2 for VALIDATION_ERROR", () => {
    expect(exitCodeForError(new AxiError("bad", "VALIDATION_ERROR"))).toBe(2);
  });

  it("returns 2 for ORG_NOT_CONFIGURED and PROJECT_NOT_CONFIGURED", () => {
    expect(exitCodeForError(new AxiError("bad", "ORG_NOT_CONFIGURED"))).toBe(2);
    expect(exitCodeForError(new AxiError("bad", "PROJECT_NOT_CONFIGURED"))).toBe(2);
  });

  it("returns 1 for other AxiError codes", () => {
    expect(exitCodeForError(new AxiError("bad", "NOT_FOUND"))).toBe(1);
    expect(exitCodeForError(new AxiError("bad", "UNKNOWN"))).toBe(1);
  });

  it("returns 1 for non-AxiError values", () => {
    expect(exitCodeForError(new Error("boom"))).toBe(1);
  });
});
