import { readFileSync } from "node:fs";
import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main, TOP_HELP } from "../src/cli.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => {
    throw new Error("no git repo");
  }),
}));

const mockedExecFile = vi.mocked(execFile);

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

const packageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

function createStdout() {
  let output = "";
  return {
    stdout: {
      write(chunk: string) {
        output += chunk;
      },
    },
    read() {
      return output;
    },
  };
}

function mockAz(exitCode: number, stdout: string, stderr = "") {
  mockedExecFile.mockImplementation((_cmd, _args, _opts, callback) => {
    const cb = callback as ExecFileCallback;
    if (exitCode === 0) {
      cb(null, stdout, stderr);
    } else {
      const error = Object.assign(new Error("failed"), { code: exitCode });
      cb(error, stdout, stderr);
    }
    return {} as ReturnType<typeof execFile>;
  });
}

describe("CLI entrypoint", () => {
  beforeEach(() => {
    mockedExecFile.mockReset();
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it("prints top-level help, including the SDK's inherited built-ins", async () => {
    const output = createStdout();
    await main({ argv: ["--help"], stdout: output.stdout });
    const rendered = output.read();
    expect(rendered.startsWith(TOP_HELP)).toBe(true);
    expect(rendered).toContain('"built-in":');
    expect(rendered).toContain("update --check");
  });

  it.each(["-v", "-V", "--version"])("prints the version for %s", async (flag) => {
    const output = createStdout();
    await main({ argv: [flag], stdout: output.stdout });
    expect(output.read()).toBe(`${packageVersion.version}\n`);
  });

  it("prints work-item help without shelling out to az", async () => {
    const output = createStdout();
    await main({ argv: ["work-item", "--help"], stdout: output.stdout });
    expect(output.read()).toContain("usage: ado-axi work-item");
    expect(mockedExecFile).not.toHaveBeenCalled();
  });

  it("exits 2 for an unknown top-level command", async () => {
    const output = createStdout();
    await main({ argv: ["frobnicate"], stdout: output.stdout });
    expect(process.exitCode).toBe(2);
    expect(output.read()).toContain("Unknown command: frobnicate");
  });

  it("exits 2 for an unknown work-item subcommand", async () => {
    const output = createStdout();
    await main({ argv: ["work-item", "frobnicate"], stdout: output.stdout });
    expect(process.exitCode).toBe(2);
    expect(output.read()).toContain("Unknown work-item subcommand: frobnicate");
  });

  it("exits 2 when a required numeric id is missing", async () => {
    const output = createStdout();
    await main({ argv: ["work-item", "view"], stdout: output.stdout });
    expect(process.exitCode).toBe(2);
    expect(output.read()).toContain("Missing work item number");
  });

  it("exits 2 when --title is missing for work-item create", async () => {
    const output = createStdout();
    await main({ argv: ["work-item", "create", "--type", "Bug"], stdout: output.stdout });
    expect(process.exitCode).toBe(2);
    expect(output.read()).toContain("--title is required");
  });

  it("maps the real az 'organization not configured' failure to exit 2", async () => {
    mockAz(
      2,
      "",
      "ERROR: --organization must be specified. The value should be the URI of your Azure DevOps organization.",
    );
    const output = createStdout();
    await main({ argv: ["work-item", "list"], stdout: output.stdout });
    expect(process.exitCode).toBe(2);
    expect(output.read()).toContain("ORG_NOT_CONFIGURED");
  });

  it("passes --org/--project through to the az invocation and strips them from argv", async () => {
    mockAz(0, "[]");
    const output = createStdout();
    await main({
      argv: ["repo", "list", "--org", "contoso", "--project", "MyProject"],
      stdout: output.stdout,
    });
    expect(mockedExecFile).toHaveBeenCalledWith(
      "az",
      [
        "repos",
        "list",
        "--organization",
        "https://dev.azure.com/contoso/",
        "--project",
        "MyProject",
        "--output",
        "json",
        "--only-show-errors",
      ],
      expect.any(Object),
      expect.any(Function),
    );
    expect(output.read()).toContain("count: 0 repositories");
  });

  it("exits 0 and reports 'already' on an idempotent close of a closed work item", async () => {
    mockedExecFile.mockImplementationOnce((_cmd, _args, _opts, callback) => {
      (callback as ExecFileCallback)(null, JSON.stringify({ id: 1, fields: { "System.State": "Closed" } }), "");
      return {} as ReturnType<typeof execFile>;
    });
    const output = createStdout();
    await main({ argv: ["work-item", "close", "1"], stdout: output.stdout });
    expect(process.exitCode).toBeUndefined();
    const rendered = output.read();
    expect(rendered).toContain("already");
    expect(mockedExecFile).toHaveBeenCalledTimes(1);
  });

  it("shows a definitive empty state instead of a blank list", async () => {
    mockAz(0, "[]");
    const output = createStdout();
    await main({ argv: ["pipeline", "list"], stdout: output.stdout });
    expect(output.read()).toContain("count: 0 pipelines");
  });

  it("reports a definitive no-org state on the home view when nothing is configured", async () => {
    const output = createStdout();
    await main({ argv: [], stdout: output.stdout });
    expect(mockedExecFile).not.toHaveBeenCalled();
    expect(output.read()).toContain("no organization configured");
  });
});
