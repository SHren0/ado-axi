import { AxiError } from "./errors.js";

function flagEqualsPrefix(flag: string): string {
  return `${flag}=`;
}

/** Get a flag's value from --flag value or --flag=value without modifying args. */
export function getFlag(args: string[], name: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(name);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === name) {
      if (i + 1 >= args.length) return undefined;
      return args[i + 1];
    }
    if (arg.startsWith(equalsPrefix)) {
      return arg.slice(equalsPrefix.length);
    }
  }
  return undefined;
}

/** Get a flag's value from --flag value or --flag=value and remove it from args. */
export function takeFlag(args: string[], flag: string): string | undefined {
  const equalsPrefix = flagEqualsPrefix(flag);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === flag) {
      const val = args[i + 1];
      args.splice(i, 2);
      return val;
    }
    if (arg.startsWith(equalsPrefix)) {
      const val = arg.slice(equalsPrefix.length);
      args.splice(i, 1);
      return val;
    }
  }
  return undefined;
}

/** Check if a boolean flag is present and remove it from args. */
export function takeBoolFlag(args: string[], flag: string): boolean {
  const idx = args.indexOf(flag);
  if (idx === -1) return false;
  args.splice(idx, 1);
  return true;
}

/** Collect all values for a repeatable flag in --flag value or --flag=value form, removing them. */
export function takeAllFlags(args: string[], flag: string): string[] {
  const result: string[] = [];
  const equalsPrefix = flagEqualsPrefix(flag);

  for (let i = 0; i < args.length; ) {
    const arg = args[i];
    if (arg === flag && i + 1 < args.length) {
      result.push(args[i + 1]);
      args.splice(i, 2);
      continue;
    }
    if (arg.startsWith(equalsPrefix)) {
      result.push(arg.slice(equalsPrefix.length));
      args.splice(i, 1);
      continue;
    }
    i++;
  }
  return result;
}

/** Find the first numeric positional arg, remove it from args, and return it as a number. */
export function takeNumber(args: string[], label: string): number {
  const raw = args.find((a) => /^\d+$/.test(a));
  if (!raw) {
    throw new AxiError(`Missing ${label} number`, "VALIDATION_ERROR", [
      `Provide a numeric ${label} id as a positional argument`,
    ]);
  }
  args.splice(args.indexOf(raw), 1);
  return Number(raw);
}

/** Get the first positional (non-flag) arg, without removing it. */
export function getPositional(
  args: string[],
  startIndex = 0,
): string | undefined {
  for (let i = startIndex; i < args.length; i++) {
    if (!args[i].startsWith("--")) return args[i];
  }
  return undefined;
}

/** Take the first positional (non-flag) arg, removing it from args. */
export function takePositional(args: string[]): string | undefined {
  const idx = args.findIndex((a) => !a.startsWith("--"));
  if (idx === -1) return undefined;
  const [value] = args.splice(idx, 1);
  return value;
}
