import { spawn } from "node:child_process";
import type { AdoContext } from "../context.js";
import { withOrgProject } from "../context.js";
import { azJson } from "../az.js";
import { AxiError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import { takeFlag, takePositional } from "../args.js";
import { field, renderList, renderDetail, renderHelp, renderOutput, type FieldDef } from "../toon.js";

interface RepoItem {
  id: string;
  name: string;
  defaultBranch?: string;
  remoteUrl?: string;
  sshUrl?: string;
  size?: number;
}

const listSchema: FieldDef[] = [field("id"), field("name"), field("defaultBranch", "default_branch")];

const viewSchema: FieldDef[] = [
  field("id"),
  field("name"),
  field("defaultBranch", "default_branch"),
  field("remoteUrl", "remote_url"),
  field("sshUrl", "ssh_url"),
];

export const REPO_HELP = `usage: ado-axi repo <subcommand> [flags]
subcommands[3]:
  list, view <name>, clone <name>
flags{clone}:
  --dir <path> (local directory name, defaults to the repository name)
examples:
  ado-axi repo list
  ado-axi repo view my-service
  ado-axi repo clone my-service`;

async function repoList(_args: string[], ctx?: AdoContext): Promise<string> {
  const items = await azJson<RepoItem[]>(withOrgProject(["repos", "list"], ctx));
  const results = Array.isArray(items) ? items : [];
  const isEmpty = results.length === 0;

  return renderOutput([
    isEmpty ? "count: 0 repositories" : `count: ${results.length}`,
    isEmpty ? "" : renderList("repositories", results, listSchema),
    renderHelp(getSuggestions({ domain: "repo", action: "list", isEmpty, ctx })),
  ]);
}

async function repoView(args: string[], ctx?: AdoContext): Promise<string> {
  const name = takePositional(args);
  if (!name) throw new AxiError("Missing repository name", "VALIDATION_ERROR");

  const repo = await azJson<RepoItem>(
    withOrgProject(["repos", "show", "--repository", name], ctx),
  );

  return renderOutput([
    renderDetail("repository", repo, viewSchema),
    renderHelp(getSuggestions({ domain: "repo", action: "view", id: name, ctx })),
  ]);
}

async function repoClone(args: string[], ctx?: AdoContext): Promise<string> {
  const dir = takeFlag(args, "--dir");
  const name = takePositional(args);
  if (!name) throw new AxiError("Missing repository name", "VALIDATION_ERROR");

  const repo = await azJson<RepoItem>(
    withOrgProject(["repos", "show", "--repository", name], ctx),
  );
  if (!repo.remoteUrl) {
    throw new AxiError(`Repository "${name}" has no remote URL`, "UNKNOWN");
  }

  const cloneArgs = dir ? [repo.remoteUrl, dir] : [repo.remoteUrl];
  const targetDir = await runGitClone(cloneArgs);

  return renderOutput([
    renderDetail("cloned", { name, dir: targetDir, status: "ok" }, [
      field("name"),
      field("dir"),
      field("status"),
    ]),
    renderHelp(getSuggestions({ domain: "repo", action: "clone", id: name, ctx })),
  ]);
}

function runGitClone(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["clone", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(new AxiError(`git clone failed: ${error.message}`, "UNKNOWN"));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(args[1] ?? deriveDirFromUrl(args[0]));
        return;
      }
      reject(
        new AxiError(
          stderr.trim().split("\n")[0] || `git clone exited with code ${code}`,
          "UNKNOWN",
        ),
      );
    });
  });
}

function deriveDirFromUrl(url: string): string {
  const last = url.split("/").pop() ?? url;
  return last.replace(/\.git$/, "");
}

export async function repoCommand(args: string[], ctx?: AdoContext): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      return repoList(rest, ctx);
    case "view":
      return repoView(rest, ctx);
    case "clone":
      return repoClone(rest, ctx);
    case "--help":
    case "-h":
    case "help":
    case undefined:
      return REPO_HELP;
    default:
      throw new AxiError(`Unknown repo subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `ado-axi repo --help` to see available subcommands",
      ]);
  }
}
