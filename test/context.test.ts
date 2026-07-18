import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveContext, withOrgProject } from "../src/context.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExecFileSync = vi.mocked(execFileSync);

describe("resolveContext", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    mockedExecFileSync.mockReset();
    delete process.env["AZURE_DEVOPS_ORG_URL"];
    delete process.env["ADO_AXI_ORG"];
    delete process.env["AZURE_DEVOPS_PROJECT"];
    delete process.env["ADO_AXI_PROJECT"];
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("prefers an explicit --org flag and normalizes a bare org name to a URL", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("no git repo");
    });
    const ctx = resolveContext("contoso", "MyProject");
    expect(ctx.org).toEqual({ value: "https://dev.azure.com/contoso/", source: "flag" });
    expect(ctx.project).toEqual({ value: "MyProject", source: "flag" });
  });

  it("passes a full org URL through unchanged", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("no git repo");
    });
    const ctx = resolveContext("https://dev.azure.com/contoso/");
    expect(ctx.org?.value).toBe("https://dev.azure.com/contoso/");
  });

  it("falls back to env vars when no flag is given", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("no git repo");
    });
    process.env["AZURE_DEVOPS_ORG_URL"] = "contoso";
    process.env["AZURE_DEVOPS_PROJECT"] = "MyProject";
    const ctx = resolveContext();
    expect(ctx.org?.source).toBe("env");
    expect(ctx.project?.source).toBe("env");
  });

  it("parses org/project/repo from an Azure Repos https git remote", () => {
    mockedExecFileSync.mockReturnValue(
      "https://dev.azure.com/contoso/MyProject/_git/my-repo\n" as unknown as Buffer,
    );
    const ctx = resolveContext();
    expect(ctx.org).toEqual({ value: "contoso", source: "git" });
    expect(ctx.project).toEqual({ value: "MyProject", source: "git" });
    expect(ctx.repo).toEqual({ value: "my-repo", source: "git" });
  });

  it("parses org/project/repo from a visualstudio.com https git remote", () => {
    mockedExecFileSync.mockReturnValue(
      "https://contoso.visualstudio.com/MyProject/_git/my-repo\n" as unknown as Buffer,
    );
    const ctx = resolveContext();
    expect(ctx.org).toEqual({ value: "contoso", source: "git" });
    expect(ctx.project?.value).toBe("MyProject");
    expect(ctx.repo?.value).toBe("my-repo");
  });

  it("parses org/project/repo from an ssh git remote", () => {
    mockedExecFileSync.mockReturnValue(
      "git@ssh.dev.azure.com:v3/contoso/MyProject/my-repo\n" as unknown as Buffer,
    );
    const ctx = resolveContext();
    expect(ctx.org?.value).toBe("contoso");
    expect(ctx.project?.value).toBe("MyProject");
    expect(ctx.repo?.value).toBe("my-repo");
  });

  it("leaves org/project undefined when there is no flag, env, or git remote", () => {
    mockedExecFileSync.mockImplementation(() => {
      throw new Error("no git repo");
    });
    const ctx = resolveContext();
    expect(ctx.org).toBeUndefined();
    expect(ctx.project).toBeUndefined();
    expect(ctx.repo).toBeUndefined();
  });

  it("does not leak a git-detected project when --org is explicit", () => {
    mockedExecFileSync.mockReturnValue(
      "https://dev.azure.com/other-org/OtherProject/_git/other-repo\n" as unknown as Buffer,
    );
    const ctx = resolveContext("contoso");
    expect(ctx.org?.source).toBe("flag");
    expect(ctx.project).toBeUndefined();
    expect(ctx.repo).toBeUndefined();
  });
});

describe("withOrgProject", () => {
  it("appends --organization and --project when resolved from a non-default source", () => {
    const args = withOrgProject(["repos", "list"], {
      org: { value: "https://dev.azure.com/contoso/", source: "flag" },
      project: { value: "MyProject", source: "flag" },
    });
    expect(args).toEqual([
      "repos",
      "list",
      "--organization",
      "https://dev.azure.com/contoso/",
      "--project",
      "MyProject",
    ]);
  });

  it("omits --project when options.project is false", () => {
    const args = withOrgProject(
      ["boards", "work-item", "show", "--id", "1"],
      {
        org: { value: "https://dev.azure.com/contoso/", source: "flag" },
        project: { value: "MyProject", source: "flag" },
      },
      { project: false },
    );
    expect(args).not.toContain("--project");
  });

  it("omits both flags when context is undefined", () => {
    expect(withOrgProject(["repos", "list"], undefined)).toEqual(["repos", "list"]);
  });
});
