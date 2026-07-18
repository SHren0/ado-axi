import { execFile } from "node:child_process";
import { AxiError, azNotInstalledError, mapAzError } from "./errors.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const MAX_BUFFER_BYTES = 10 * 1024 * 1024; // 10 MB
const NON_INTERACTIVE_FLAGS = ["--only-show-errors"];

function toExecResult(
  resolve: (result: ExecResult) => void,
): (error: Error | null, stdout: string, stderr: string) => void {
  return (error, stdout, stderr) => {
    if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
      resolve({ stdout: "", stderr: "ENOENT", exitCode: 127 });
      return;
    }
    const exitCode = error
      ? ((error as Error & { code?: string | number }).code ?? 1)
      : 0;
    resolve({
      stdout: stdout ?? "",
      stderr: stderr ?? "",
      exitCode: typeof exitCode === "number" ? exitCode : 1,
    });
  };
}

function run(args: string[]): Promise<ExecResult> {
  return new Promise((resolve) => {
    execFile(
      "az",
      [...args, "--output", "json", ...NON_INTERACTIVE_FLAGS],
      { maxBuffer: MAX_BUFFER_BYTES },
      toExecResult(resolve),
    );
  });
}

/** Execute az and return parsed JSON. */
export async function azJson<T = unknown>(args: string[]): Promise<T> {
  const result = await run(args);
  if (result.stderr === "ENOENT") throw azNotInstalledError();
  if (result.exitCode !== 0) throw mapAzError(result.stderr, result.exitCode);
  if (result.stdout.trim().length === 0) {
    return null as T;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new AxiError(
      `Unexpected az output: ${result.stdout.slice(0, 200)}`,
      "UNKNOWN",
    );
  }
}

/** Execute az, returning stdout + stderr without throwing on non-zero exit. */
export async function azRaw(args: string[]): Promise<ExecResult> {
  const result = await run(args);
  if (result.stderr === "ENOENT") throw azNotInstalledError();
  return result;
}
