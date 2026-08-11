import { execFile } from "node:child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { clearRepositoryCache } from "../src/api/repository.js";
import { createAzMock, createStdout, flagValue, type AzMock } from "./helpers/az-mock.js";
import { inspectRoutes, pullRequest, statuses, threads } from "./helpers/fixtures.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => {
    throw new Error("no git repo");
  }),
}));

const mockedExecFile = vi.mocked(execFile);

function install(routes: Record<string, unknown>): AzMock {
  const mock = createAzMock(routes as Parameters<typeof createAzMock>[0]);
  mockedExecFile.mockImplementation(
    mock.implementation as unknown as typeof mockedExecFile.getMockImplementation,
  );
  return mock;
}

async function run(argv: string[]): Promise<string> {
  const output = createStdout();
  await main({ argv, stdout: output.stdout });
  return output.read();
}

describe("pr gate", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
    clearRepositoryCache();
    process.exitCode = undefined;
  });

  it("passes pre-merge conditions but stays pending until an active PR is completed", async () => {
    const mock = install(
      inspectRoutes({
        "repos pr show": {
          json: {
            ...pullRequest,
            mergeStatus: "succeeded",
            reviewers: [{ ...pullRequest.reviewers[0], vote: 10 }],
          },
        },
        "rest GET git/pullRequestStatuses": {
          json: { value: [statuses.value[0]] },
        },
        "rest GET policy/evaluations": {
          json: {
            value: [
              {
                evaluationId: "passed",
                status: "approved",
                configuration: { isBlocking: true, type: { displayName: "Build policy" } },
              },
            ],
          },
        },
        "rest GET git/pullRequestThreads": {
          json: { value: [threads.value[1], threads.value[2]] },
        },
      }),
    );

    const parsed = JSON.parse(await run(["pr", "gate", "2613", "--json"])) as {
      state: string;
      pull_request: { status: string; merge_status: string; completed: boolean };
      checks: { state: string };
      policies: { state: string; available: boolean };
      threads: { state: string; unresolved: number };
      ready_for_auto_complete: boolean;
    };

    expect(parsed.state).toBe("pending");
    expect(parsed.pull_request).toEqual({
      id: 2613,
      status: "active",
      merge_status: "succeeded",
      completed: false,
    });
    expect(parsed.checks.state).toBe("passed");
    expect(parsed.policies).toMatchObject({ state: "passed", available: true });
    expect(parsed.threads).toEqual({ state: "passed", available: true, total: 1, unresolved: 0, threads: [threads.value[1]] });
    expect(parsed.ready_for_auto_complete).toBe(true);
    const policyCall = mock.callsFor("rest GET policy/evaluations")[0];
    expect(flagValue(policyCall.args, "--api-version")).toBe("7.1-preview");
  });

  it("reports a completed PR as passed and exposes auto-complete state", async () => {
    install(
      inspectRoutes({
        "repos pr show": {
          json: {
            ...pullRequest,
            status: "completed",
            mergeStatus: "succeeded",
            autoCompleteSetBy: { displayName: "Ada Lovelace" },
            reviewers: [{ ...pullRequest.reviewers[0], vote: 10 }],
          },
        },
        "rest GET git/pullRequestStatuses": { json: { value: [statuses.value[0]] } },
        "rest GET policy/evaluations": {
          json: {
            value: [
              { status: "approved", configuration: { isBlocking: true } },
            ],
          },
        },
        "rest GET git/pullRequestThreads": { json: { value: [threads.value[1]] } },
      }),
    );

    const parsed = JSON.parse(await run(["pr", "gate", "2613", "--json"])) as {
      state: string;
      pull_request: { completed: boolean };
      auto_complete: { enabled: boolean; state: string; set_by: string };
    };

    expect(parsed.state).toBe("passed");
    expect(parsed.pull_request.completed).toBe(true);
    expect(parsed.auto_complete).toEqual({
      enabled: true,
      state: "enabled",
      set_by: "Ada Lovelace",
    });
  });

  it("fails closed with unknown when policy data is forbidden", async () => {
    install(
      inspectRoutes({
        "rest GET git/pullRequestStatuses": { json: { value: [statuses.value[0]] } },
        "rest GET git/pullRequestThreads": { json: { value: [threads.value[1]] } },
        "rest GET policy/evaluations": {
          stderr: "ERROR: TF400813: The user is not authorized to access this resource.",
          exitCode: 1,
        },
      }),
    );

    const parsed = JSON.parse(await run(["pr", "gate", "2613", "--json"])) as {
      state: string;
      policies: { state: string; available: boolean; error?: string };
      ready_for_auto_complete: boolean;
    };

    expect(parsed.state).toBe("unknown");
    expect(parsed.policies.state).toBe("unknown");
    expect(parsed.policies.available).toBe(false);
    expect(parsed.policies.error).toContain("pr gate");
    expect(parsed.ready_for_auto_complete).toBe(false);
  });
});

describe("pr auto-complete", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
    clearRepositoryCache();
    process.exitCode = undefined;
  });

  it("requests auto-complete and verifies it on a fresh PR read", async () => {
    const updated = { ...pullRequest, autoCompleteSetBy: { displayName: "Ada Lovelace" } };
    const mock = install({
      "repos pr show": (_args, call) => ({ json: call === 0 ? pullRequest : updated }),
      "repos pr update": { json: updated },
    });

    const rendered = await run(["pr", "auto-complete", "2613"]);
    const update = mock.callsFor("repos pr update")[0];

    expect(update.args).toContain("--auto-complete");
    expect(update.args).toContain("true");
    expect(mock.countFor("repos pr show")).toBe(2);
    expect(rendered).toContain("verified: true");
  });

  it("rejects --auto-complete on immediate merge", async () => {
    const rendered = await run(["pr", "complete", "2613", "--auto-complete"]);

    expect(process.exitCode).toBe(2);
    expect(rendered).toContain("pr auto-complete");
    expect(rendered).toContain("immediate merge");
  });

  it("reports a conflict when Azure does not enable auto-complete", async () => {
    install({
      "repos pr show": { json: pullRequest },
      "repos pr update": { json: pullRequest },
    });

    const rendered = await run(["pr", "auto-complete", "2613"]);

    expect(process.exitCode).toBe(1);
    expect(rendered).toContain("did not enable auto-complete");
    expect(rendered).toContain("CONFLICT");
  });
});
