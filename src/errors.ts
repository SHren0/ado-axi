import { AxiError } from "axi-sdk-js";

export type ErrorCode =
  | "NOT_FOUND"
  | "AUTH_REQUIRED"
  | "ORG_NOT_CONFIGURED"
  | "PROJECT_NOT_CONFIGURED"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "AZ_NOT_INSTALLED"
  | "DEVOPS_EXTENSION_MISSING"
  | "UNKNOWN";

export { AxiError };

/** Usage errors (bad or missing input the caller can fix without retrying) exit 2, everything else exits 1. */
const USAGE_ERROR_CODES: ReadonlySet<string> = new Set([
  "VALIDATION_ERROR",
  "ORG_NOT_CONFIGURED",
  "PROJECT_NOT_CONFIGURED",
]);

export function exitCodeForError(error: unknown): number {
  if (error instanceof AxiError && USAGE_ERROR_CODES.has(error.code)) {
    return 2;
  }
  return 1;
}

interface ErrorPattern {
  pattern: RegExp;
  code: ErrorCode;
  message: (match: RegExpMatchArray, stderr: string) => string;
  suggestions?: (match: RegExpMatchArray) => string[];
}

const patterns: ErrorPattern[] = [
  {
    pattern: /--organization must be specified/i,
    code: "ORG_NOT_CONFIGURED",
    message: () => "No Azure DevOps organization configured",
    suggestions: () => [
      "Pass --org https://dev.azure.com/<org>/",
      "Or run `az devops configure -d organization=https://dev.azure.com/<org>/` to set a default",
    ],
  },
  {
    pattern: /--project must be specified/i,
    code: "PROJECT_NOT_CONFIGURED",
    message: () => "No Azure DevOps project configured",
    suggestions: () => [
      "Pass --project <name-or-id>",
      "Or run `az devops configure -d project=<name>` to set a default",
    ],
  },
  {
    pattern: /need to run the login command|Please run 'az login'/i,
    code: "AUTH_REQUIRED",
    message: () => "Azure DevOps sign-in required",
    suggestions: () => [
      "Run `az login` for AAD/MSA identity, or `az devops login` with a PAT",
    ],
  },
  {
    pattern: /TF400813/,
    code: "FORBIDDEN",
    message: () =>
      "Not authorized to access this Azure DevOps organization or resource",
    suggestions: () => [
      "Run `az devops login` with a PAT that has access to this organization",
    ],
  },
  {
    pattern: /VS30063|not authorized to access/i,
    code: "FORBIDDEN",
    message: (_m, stderr) => firstErrorLine(stderr) || "Not authorized",
    suggestions: () => ["Run `az devops login` to set a PAT for this org"],
  },
  {
    pattern: /work item (\d+) does not exist/i,
    code: "NOT_FOUND",
    message: (m) => `Work item #${m[1]} does not exist`,
    suggestions: () => [],
  },
  {
    pattern: /pull request (\d+) does not exist|no pull request found/i,
    code: "NOT_FOUND",
    message: (m) => `Pull request #${m[1] ?? ""} not found`.trim(),
    suggestions: () => [],
  },
  {
    pattern: /TF401232|VS403313/,
    code: "NOT_FOUND",
    message: () => "The requested item does not exist",
  },
  {
    pattern: /repository .* not found|TF401019/i,
    code: "NOT_FOUND",
    message: (_m, stderr) => firstErrorLine(stderr) || "Repository not found",
    suggestions: () => ["Run `ado-axi repo list` to see repositories"],
  },
  {
    pattern: /'([\w-]+)' is not in the '\w+' extension command tree|The command requires the extension/i,
    code: "DEVOPS_EXTENSION_MISSING",
    message: () => "The azure-devops CLI extension is not installed",
    suggestions: () => ["Run `az extension add --name azure-devops`"],
  },
];

function firstErrorLine(stderr: string): string {
  const cleaned = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("WARNING:"))[0];
  return (cleaned ?? "").replace(/^ERROR:\s*/, "");
}

export function mapAzError(stderr: string, exitCode: number): AxiError {
  for (const { pattern, code, message, suggestions } of patterns) {
    const match = stderr.match(pattern);
    if (match) {
      return new AxiError(message(match, stderr), code, suggestions?.(match) ?? []);
    }
  }

  if (/not found|does not exist/i.test(stderr)) {
    return new AxiError(firstErrorLine(stderr), "NOT_FOUND");
  }

  return new AxiError(
    firstErrorLine(stderr) || `az exited with code ${exitCode}`,
    "UNKNOWN",
  );
}

export function azNotInstalledError(): AxiError {
  return new AxiError(
    "az CLI is not installed - see https://aka.ms/azure-cli",
    "AZ_NOT_INSTALLED",
  );
}
