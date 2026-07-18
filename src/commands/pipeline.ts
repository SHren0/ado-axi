import type { AdoContext } from "../context.js";
import { withOrgProject } from "../context.js";
import { azJson } from "../az.js";
import { AxiError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import { takeFlag, takeAllFlags, takeNumber } from "../args.js";
import { formatCountLine } from "../format.js";
import {
  field,
  pluck,
  lower,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  type FieldDef,
} from "../toon.js";

interface PipelineDef {
  id: number;
  name: string;
  folder?: string;
}

interface PipelineRun {
  id: number;
  buildNumber?: string;
  status?: string;
  result?: string;
  sourceBranch?: string;
  definition?: { id?: number; name?: string };
  requestedFor?: { displayName?: string };
  startTime?: string;
  finishTime?: string;
}

const defSchema: FieldDef[] = [field("id"), field("name"), field("folder")];

const runSchema: FieldDef[] = [
  field("id"),
  pluck("definition", "name", "pipeline"),
  custom("status", (r: PipelineRun) => r.result ?? r.status ?? "unknown"),
  custom("branch", (r: PipelineRun) => (r.sourceBranch ?? "").replace(/^refs\/heads\//, "")),
  pluck("requestedFor", "displayName", "requested_by"),
];

const runViewSchema: FieldDef[] = [
  field("id"),
  field("buildNumber", "build_number"),
  pluck("definition", "name", "pipeline"),
  lower("status"),
  custom("result", (r: PipelineRun) => r.result ?? "pending"),
  custom("branch", (r: PipelineRun) => (r.sourceBranch ?? "").replace(/^refs\/heads\//, "")),
  pluck("requestedFor", "displayName", "requested_by"),
  field("startTime", "started"),
  field("finishTime", "finished"),
];

export const PIPELINE_HELP = `usage: ado-axi pipeline <subcommand> [flags]
subcommands[5]:
  list, view <id>, run <id>, runs <list|view>, cancel <run-id>
flags{list}:
  --name <name>, --folder-path <path>, --top <n> (default 50)
flags{run}:
  --branch <name>, --variables <name=value> (repeatable), --parameters <name=value> (repeatable)
flags{runs list}:
  --top <n> (default 20), --status <inProgress|completed|...>, --result <succeeded|failed|...>, --branch <name>
examples:
  ado-axi pipeline list
  ado-axi pipeline view 12
  ado-axi pipeline run 12 --branch main
  ado-axi pipeline runs list --top 10
  ado-axi pipeline runs view 4821
  ado-axi pipeline cancel 4821`;

async function pipelineList(args: string[], ctx?: AdoContext): Promise<string> {
  const name = takeFlag(args, "--name");
  const folderPath = takeFlag(args, "--folder-path");
  const top = Number(takeFlag(args, "--top") ?? "50");

  const azArgs = ["pipelines", "list", "--top", String(top)];
  if (name) azArgs.push("--name", name);
  if (folderPath) azArgs.push("--folder-path", folderPath);

  const items = await azJson<PipelineDef[]>(withOrgProject(azArgs, ctx));
  const results = Array.isArray(items) ? items : [];
  const isEmpty = results.length === 0;

  return renderOutput([
    isEmpty ? "count: 0 pipelines" : formatCountLine({ count: results.length, limit: top }),
    isEmpty ? "" : renderList("pipelines", results, defSchema),
    renderHelp(getSuggestions({ domain: "pipeline", action: "list", isEmpty, id: results[0]?.id, ctx })),
  ]);
}

async function pipelineView(args: string[], ctx?: AdoContext): Promise<string> {
  const id = takeNumber(args, "pipeline");
  const pipeline = await azJson<PipelineDef>(
    withOrgProject(["pipelines", "show", "--id", String(id)], ctx),
  );
  return renderOutput([
    renderDetail("pipeline", pipeline, defSchema),
    renderHelp(getSuggestions({ domain: "pipeline", action: "view", id, ctx })),
  ]);
}

async function pipelineRun(args: string[], ctx?: AdoContext): Promise<string> {
  const branch = takeFlag(args, "--branch");
  const variables = takeAllFlags(args, "--variables");
  const parameters = takeAllFlags(args, "--parameters");
  const id = takeNumber(args, "pipeline");

  const azArgs = ["pipelines", "run", "--id", String(id)];
  if (branch) azArgs.push("--branch", branch);
  if (variables.length > 0) azArgs.push("--variables", ...variables);
  if (parameters.length > 0) azArgs.push("--parameters", ...parameters);

  const run = await azJson<PipelineRun>(withOrgProject(azArgs, ctx));

  return renderOutput([
    renderDetail("queued", run, [
      field("id"),
      lower("status"),
      pluck("definition", "name", "pipeline"),
    ]),
    renderHelp(getSuggestions({ domain: "pipeline", action: "run", id: run.id, ctx })),
  ]);
}

async function pipelineRunsList(args: string[], ctx?: AdoContext): Promise<string> {
  const top = Number(takeFlag(args, "--top") ?? "20");
  const status = takeFlag(args, "--status");
  const result = takeFlag(args, "--result");
  const branch = takeFlag(args, "--branch");

  const azArgs = ["pipelines", "runs", "list", "--top", String(top)];
  if (status) azArgs.push("--status", status);
  if (result) azArgs.push("--result", result);
  if (branch) azArgs.push("--branch", branch);

  const items = await azJson<PipelineRun[]>(withOrgProject(azArgs, ctx));
  const results = Array.isArray(items) ? items : [];
  const isEmpty = results.length === 0;

  // Pre-computed pass/fail aggregate so agents don't have to count rows themselves.
  const succeeded = results.filter((r) => r.result === "succeeded").length;
  const failed = results.filter((r) => r.result === "failed").length;
  const other = results.length - succeeded - failed;
  const summaryParts = [`${succeeded} succeeded`, `${failed} failed`];
  if (other > 0) summaryParts.push(`${other} other`);

  return renderOutput([
    isEmpty ? "count: 0 pipeline runs" : `summary: ${summaryParts.join(", ")}, ${results.length} total`,
    isEmpty ? "" : renderList("runs", results, runSchema),
    renderHelp(
      getSuggestions({ domain: "pipeline", action: "runs-list", isEmpty, id: results[0]?.id, ctx }),
    ),
  ]);
}

async function pipelineRunsView(args: string[], ctx?: AdoContext): Promise<string> {
  const id = takeNumber(args, "run");
  const run = await azJson<PipelineRun>(
    withOrgProject(["pipelines", "runs", "show", "--id", String(id)], ctx),
  );
  return renderOutput([
    renderDetail("run", run, runViewSchema),
    renderHelp(getSuggestions({ domain: "pipeline", action: "runs-view", id, ctx })),
  ]);
}

async function pipelineRuns(args: string[], ctx?: AdoContext): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);
  switch (sub) {
    case "list":
      return pipelineRunsList(rest, ctx);
    case "view":
      return pipelineRunsView(rest, ctx);
    default:
      throw new AxiError(`Unknown pipeline runs subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `ado-axi pipeline --help` to see available subcommands",
      ]);
  }
}

async function pipelineCancel(args: string[], ctx?: AdoContext): Promise<string> {
  const id = takeNumber(args, "run");

  const current = await azJson<PipelineRun>(
    withOrgProject(["pipelines", "runs", "show", "--id", String(id)], ctx),
  );
  if (current.status === "completed") {
    return renderOutput([
      renderDetail(
        "run",
        { id, status: "completed", result: current.result ?? "unknown", already: true },
        [
          custom("id", (i: { id: number }) => i.id),
          custom("status", (i: { status: string }) => i.status),
          custom("result", (i: { result: string }) => i.result),
          custom("already", (i: { already: boolean }) => i.already),
        ],
      ),
      renderHelp(getSuggestions({ domain: "pipeline", action: "cancel", id, ctx })),
    ]);
  }

  await azJson(withOrgProject(["pipelines", "build", "cancel", "--build-id", String(id)], ctx));

  return renderOutput([
    renderDetail("cancelled", { id, status: "ok" }, [
      custom("id", (i: { id: number }) => i.id),
      custom("status", (i: { status: string }) => i.status),
    ]),
    renderHelp(getSuggestions({ domain: "pipeline", action: "cancel", id, ctx })),
  ]);
}

export async function pipelineCommand(args: string[], ctx?: AdoContext): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      return pipelineList(rest, ctx);
    case "view":
      return pipelineView(rest, ctx);
    case "run":
      return pipelineRun(rest, ctx);
    case "runs":
      return pipelineRuns(rest, ctx);
    case "cancel":
      return pipelineCancel(rest, ctx);
    case "--help":
    case "-h":
    case "help":
    case undefined:
      return PIPELINE_HELP;
    default:
      throw new AxiError(`Unknown pipeline subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `ado-axi pipeline --help` to see available subcommands",
      ]);
  }
}
