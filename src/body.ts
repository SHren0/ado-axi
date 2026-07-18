import { readFileSync } from "node:fs";
import { AxiError } from "./errors.js";

interface TakeBodyOptions {
  required?: boolean;
  label?: string;
}

/**
 * Resolve a description/body from --description or --description-file and
 * remove the matched flag from args. Optional bodies accept at most one
 * source; required bodies enforce exactly one.
 */
export function takeBody(
  args: string[],
  options: TakeBodyOptions & { required: true },
): string;
export function takeBody(args: string[], options?: TakeBodyOptions): string | undefined;
export function takeBody(
  args: string[],
  options: TakeBodyOptions = {},
): string | undefined {
  const label = options.label ?? "description";
  const suggestions = [
    `Use --description "..." for inline text, or --description-file <path> for a markdown file`,
  ];

  const inline = takeMatch(args, "--description");
  const fromFile = takeMatch(args, "--description-file");

  if (inline !== undefined && fromFile !== undefined) {
    throw new AxiError(
      `Use only one ${label} source: --description or --description-file`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }

  if (inline === undefined && fromFile === undefined) {
    if (options.required) {
      throw new AxiError(
        `--description or --description-file is required`,
        "VALIDATION_ERROR",
        suggestions,
      );
    }
    return undefined;
  }

  if (fromFile !== undefined) {
    return readBodyFile(fromFile, suggestions);
  }

  if (inline === "") {
    throw new AxiError("--description requires text", "VALIDATION_ERROR", suggestions);
  }
  return inline;
}

function takeMatch(args: string[], flag: string): string | undefined {
  const equalsPrefix = `${flag}=`;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      const value = args[i + 1];
      if (value === undefined || value.startsWith("--")) {
        args.splice(i, 1);
        return "";
      }
      args.splice(i, 2);
      return value;
    }
    if (arg.startsWith(equalsPrefix)) {
      args.splice(i, 1);
      return arg.slice(equalsPrefix.length);
    }
  }
  return undefined;
}

function readBodyFile(path: string, suggestions: string[]): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as NodeJS.ErrnoException).code)
        : "UNKNOWN";
    if (code === "ENOENT") {
      throw new AxiError(
        `--description-file path not found: ${path}`,
        "VALIDATION_ERROR",
        suggestions,
      );
    }
    throw new AxiError(
      `Could not read --description-file path: ${path} (${code})`,
      "VALIDATION_ERROR",
      suggestions,
    );
  }
}
