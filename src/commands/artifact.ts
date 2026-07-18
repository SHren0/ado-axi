import type { AdoContext } from "../context.js";
import { withOrgProject } from "../context.js";
import { azJson } from "../az.js";
import { AxiError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import { takeFlag } from "../args.js";
import { field, renderDetail, renderHelp, renderOutput, type FieldDef } from "../toon.js";

/**
 * The azure-devops CLI extension only exposes Universal Packages
 * (`az artifacts universal download|publish`) - there is no `az artifacts feed`
 * or `az artifacts package` command group to list feeds/packages, so this
 * command group is narrower than "feeds, packages" might suggest.
 */

const resultSchema: FieldDef[] = [field("feed"), field("name"), field("version"), field("status")];

export const ARTIFACT_HELP = `usage: ado-axi artifact <subcommand> [flags]
subcommands[2]:
  download, publish
flags{download}:
  --feed <name> (required), --name <package> (required), --version <x.y.z> (required), --path <dir> (required), --scope <organization|project> (default organization), --file-filter <glob>
flags{publish}:
  --feed <name> (required), --name <package> (required), --version <x.y.z> (required), --path <dir> (required), --description <text>, --scope <organization|project> (default organization)
examples:
  ado-axi artifact download --feed my-feed --name my-package --version 1.2.0 --path ./out
  ado-axi artifact publish --feed my-feed --name my-package --version 1.2.0 --path ./dist`;

function requireFlag(value: string | undefined, name: string): string {
  if (!value) throw new AxiError(`${name} is required`, "VALIDATION_ERROR");
  return value;
}

async function artifactDownload(args: string[], ctx?: AdoContext): Promise<string> {
  const feed = requireFlag(takeFlag(args, "--feed"), "--feed");
  const name = requireFlag(takeFlag(args, "--name"), "--name");
  const version = requireFlag(takeFlag(args, "--version"), "--version");
  const path = requireFlag(takeFlag(args, "--path"), "--path");
  const scope = takeFlag(args, "--scope");
  const fileFilter = takeFlag(args, "--file-filter");

  const azArgs = [
    "artifacts",
    "universal",
    "download",
    "--feed",
    feed,
    "--name",
    name,
    "--version",
    version,
    "--path",
    path,
  ];
  if (scope) azArgs.push("--scope", scope);
  if (fileFilter) azArgs.push("--file-filter", fileFilter);

  await azJson(withOrgProject(azArgs, ctx));

  return renderOutput([
    renderDetail("downloaded", { feed, name, version, status: "ok" }, resultSchema),
    renderHelp(getSuggestions({ domain: "artifact", action: "download", ctx })),
  ]);
}

async function artifactPublish(args: string[], ctx?: AdoContext): Promise<string> {
  const feed = requireFlag(takeFlag(args, "--feed"), "--feed");
  const name = requireFlag(takeFlag(args, "--name"), "--name");
  const version = requireFlag(takeFlag(args, "--version"), "--version");
  const path = requireFlag(takeFlag(args, "--path"), "--path");
  const description = takeFlag(args, "--description");
  const scope = takeFlag(args, "--scope");

  const azArgs = [
    "artifacts",
    "universal",
    "publish",
    "--feed",
    feed,
    "--name",
    name,
    "--version",
    version,
    "--path",
    path,
  ];
  if (description) azArgs.push("--description", description);
  if (scope) azArgs.push("--scope", scope);

  await azJson(withOrgProject(azArgs, ctx));

  return renderOutput([
    renderDetail("published", { feed, name, version, status: "ok" }, resultSchema),
    renderHelp(getSuggestions({ domain: "artifact", action: "publish", ctx })),
  ]);
}

export async function artifactCommand(args: string[], ctx?: AdoContext): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "download":
      return artifactDownload(rest, ctx);
    case "publish":
      return artifactPublish(rest, ctx);
    case "--help":
    case "-h":
    case "help":
    case undefined:
      return ARTIFACT_HELP;
    default:
      throw new AxiError(`Unknown artifact subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `ado-axi artifact --help` to see available subcommands",
      ]);
  }
}
