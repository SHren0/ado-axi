import type { AdoContext } from "../context.js";
import { withOrgProject } from "../context.js";
import { azJson } from "../az.js";
import { AxiError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import { takeFlag } from "../args.js";
import {
  field,
  pluck,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  type FieldDef,
} from "../toon.js";

interface IterationAttributes {
  startDate?: string;
  finishDate?: string;
  timeFrame?: string;
}

interface IterationNode {
  id?: string | number;
  name: string;
  path: string;
  attributes?: IterationAttributes;
  children?: IterationNode[];
}

const schema: FieldDef[] = [
  field("name"),
  field("path"),
  pluck("attributes", "timeFrame", "time_frame"),
  pluck("attributes", "startDate", "start"),
  pluck("attributes", "finishDate", "finish"),
];

export const ITERATION_HELP = `usage: ado-axi iteration <subcommand> [flags]
subcommands[2]:
  list, current
flags{list}:
  --team <name> (list a team's sprints instead of the whole project tree)
flags{current}:
  --team <name> (required)
examples:
  ado-axi iteration list
  ado-axi iteration list --team "My Team"
  ado-axi iteration current --team "My Team"`;

async function iterationList(args: string[], ctx?: AdoContext): Promise<string> {
  const team = takeFlag(args, "--team");

  let items: IterationNode[];
  if (team) {
    const result = await azJson<IterationNode[]>(
      withOrgProject(["boards", "iteration", "team", "list", "--team", team], ctx),
    );
    items = Array.isArray(result) ? result : [];
  } else {
    const root = await azJson<IterationNode>(
      withOrgProject(["boards", "iteration", "project", "list"], ctx),
    );
    items = root?.children ?? [];
  }

  const isEmpty = items.length === 0;

  return renderOutput([
    isEmpty ? "count: 0 iterations" : `count: ${items.length}`,
    isEmpty ? "" : renderList("iterations", items, schema),
    renderHelp(getSuggestions({ domain: "iteration", action: "list", isEmpty, ctx })),
  ]);
}

async function iterationCurrent(args: string[], ctx?: AdoContext): Promise<string> {
  const team = takeFlag(args, "--team");
  if (!team) throw new AxiError("--team is required", "VALIDATION_ERROR");

  const iteration = await azJson<IterationNode>(
    withOrgProject(["boards", "iteration", "team", "show-default-iteration", "--team", team], ctx),
  );

  return renderOutput([
    renderDetail("current_iteration", iteration, schema),
    renderHelp(getSuggestions({ domain: "iteration", action: "current", ctx })),
  ]);
}

export async function iterationCommand(args: string[], ctx?: AdoContext): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      return iterationList(rest, ctx);
    case "current":
      return iterationCurrent(rest, ctx);
    case "--help":
    case "-h":
    case "help":
    case undefined:
      return ITERATION_HELP;
    default:
      throw new AxiError(`Unknown iteration subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `ado-axi iteration --help` to see available subcommands",
      ]);
  }
}
