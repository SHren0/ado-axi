# Project agent memory

`ado-axi` is an AXI-compliant CLI wrapper around the `az devops` Azure CLI extension.
It gives an AI coding agent a token-efficient, agent-ergonomic interface to Azure DevOps (work items, pull requests, pipelines, repos, artifacts, iterations) instead of raw `az` calls or a generic MCP server.
It shells out to `az boards`, `az repos`, `az pipelines`, and `az artifacts` for every real operation and reshapes their output into TOON; it never talks to the Azure DevOps REST API directly.

This file is the canonical source of agent instructions for this repo.
`CLAUDE.md` is a real symlink to this file (`CLAUDE.md -> AGENTS.md`), not a copy.
If you need to change agent instructions, edit this file only.
Never write content directly into `CLAUDE.md`.

## Command surface

| Command | Wraps | Implementation |
|---|---|---|
| `work-item` | `az boards work-item` (+ `az boards query` for `list`, since `az boards work-item` has no native `list`) | `src/commands/work-item.ts` |
| `pr` | `az repos pr` | `src/commands/pr.ts` |
| `pipeline` | `az pipelines`, `az pipelines runs`, `az pipelines build cancel` | `src/commands/pipeline.ts` |
| `repo` | `az repos` (+ a plain `git clone` for `repo clone`, since `az repos` has no clone command) | `src/commands/repo.ts` |
| `artifact` | `az artifacts universal` | `src/commands/artifact.ts` |
| `iteration` | `az boards iteration project`/`az boards iteration team` | `src/commands/iteration.ts` |
| `setup` | `installSessionStartHooks()` from `axi-sdk-js` | `src/commands/setup.ts` |
| (no args) | dashboard: active work items, open PRs, recent pipeline runs | `src/commands/home.ts` |

Shared infrastructure:

- `src/cli.ts` - entry point, calls `runAxiCli()` from `axi-sdk-js`, registers all commands, strips the global `--org`/`--project` flags before dispatch.
- `src/context.ts` - resolves `--org`/`--project` (and, from a git remote, `repo`). Priority: explicit flag > env var (`AZURE_DEVOPS_ORG_URL`/`ADO_AXI_ORG`, `AZURE_DEVOPS_PROJECT`/`ADO_AXI_PROJECT`) > Azure Repos git remote > `az devops configure -d` default. A "default"-sourced value is intentionally never passed as a flag to `az`, so the child process applies its own configured default.
- `src/az.ts` - the single place that shells out to `az`, always with `--output json --only-show-errors`.
- `src/errors.ts` - maps `az`'s raw stderr into structured `AxiError`s with a `code` and actionable `suggestions`. The regexes for `ORG_NOT_CONFIGURED`, `PROJECT_NOT_CONFIGURED`, and `AUTH_REQUIRED` were captured from the real `az` CLI's own error text (verified without a live org, since those are client-side config errors); everything else is best-effort and should be tightened against real `az` stderr as it's observed.
- `src/toon.ts` - the TOON field-extraction and rendering helpers (`field`, `pluck`, `custom`, `renderList`, `renderDetail`, `renderHelp`, `renderError`).
- `src/fields.ts`, `src/body.ts`, `src/format.ts`, `src/args.ts`, `src/suggestions.ts` - `--fields` parsing, `--description`/`--description-file` handling, count-line/truncation formatting, flag-parsing helpers, and the contextual "what to run next" suggestion table, respectively.

`bin/ado-axi.ts` is the published binary entrypoint; it just calls `main()` from `src/cli.ts`.

## The 10 AXI principles - checklist

- [x] **Token-efficient output.** Every command's stdout is rendered through `renderOutput`/`renderList`/`renderDetail` in `src/toon.ts`, which wrap the SDK's `@toon-format/toon` encoder. No command prints raw JSON.
- [x] **Minimal default schemas.** `work-item list` defaults to id/title/state/assignee; `pr list` defaults to id/title/status/author/draft. Both accept `--fields` (work-item) to add more without hand-rolling `az`'s own `--fields`/`--json` flags.
- [x] **Content truncation.** `work-item view` and `pr view` truncate `description` at ~1000 chars via `truncateBody()` in `src/format.ts`, with a "truncated, N chars total - use --full" hint; `--full` returns the untruncated text.
- [x] **Pre-computed aggregates.** `pr list`/`work-item list`/`pipeline list` use `formatCountLine()` (`count: N (showing first N)` when the result hits `--top`/`--limit`); `pipeline runs list` computes a `succeeded`/`failed`/`other` pass-fail summary client-side instead of leaving the agent to count rows.
- [x] **Definitive empty states.** Every list command renders `count: 0 <thing>` (e.g. `count: 0 active work items assigned to you`) instead of an empty TOON block. The home dashboard does the same per section.
- [x] **Structured errors and exit codes.** `src/errors.ts#mapAzError` turns `az`'s stderr into an `AxiError{message, code, suggestions}`, rendered on stdout via `renderError`. Exit codes (`src/errors.ts#exitCodeForError`, wired through `cli.ts`'s `formatError`): 0 success/no-op, 2 for `VALIDATION_ERROR`/`ORG_NOT_CONFIGURED`/`PROJECT_NOT_CONFIGURED` (usage errors - the caller can fix the invocation without retrying), 1 for everything else. `work-item close`, `pr complete`, and `pipeline cancel` all check current state first and return `already: true` with exit 0 instead of erroring on a repeat call.
- [x] **No interactive prompts.** Every `az` invocation always includes `--only-show-errors`, and `src/az.ts` never opens `az`'s stdin, so a command either succeeds, fails, or is rejected by our own arg validation - it never hangs waiting for input.
- [x] **Ambient context.** `ado-axi setup hooks` calls `installSessionStartHooks()` from `axi-sdk-js`, which wires SessionStart hooks for Claude Code, Codex, and OpenCode so the home dashboard is injected into a fresh agent session automatically.
- [x] **Content-first home view.** `ado-axi` with no arguments runs `src/commands/home.ts`, which shows active work items assigned to you, open PRs, and recent pipeline runs (or a definitive "no organization configured" state), never a usage manual.
- [x] **Contextual disclosure.** `src/suggestions.ts#getSuggestions()` returns concrete next commands with real ids filled in (e.g. `ado-axi work-item view 1234`, not `ado-axi work-item view <id>`) after every list/view/mutation.
- [x] **Consistent help.** Every command group exports a `_HELP` constant with `usage:`, `subcommands[N]:`, per-subcommand `flags{...}:`, and 2-5 runnable `examples:`; `--help` after any command/subcommand renders it. Top-level `--help` additionally gets the SDK's inherited `update`/`update --check` built-in appended automatically.

## Testing locally against a real Azure DevOps org

This repo was built and verified without a live Azure DevOps org (see the note at the bottom of this file).
To validate a change end-to-end:

1. Install the Azure CLI and the `azure-devops` extension: `az extension add --name azure-devops`.
2. Authenticate: `az login` (AAD/MSA) or `az devops login` (PAT) for the target org.
3. Either set defaults (`az devops configure -d organization=https://dev.azure.com/<org>/ project=<project>`) or pass `--org`/`--project` on every `ado-axi` invocation.
4. Run against the real `dist` build: `npm run build && node dist/bin/ado-axi.js work-item list`.
   Use `npm run dev -- <args>` (runs `bin/ado-axi.ts` through `tsx`) to iterate without rebuilding.
5. Walk the reference workflow from the original handoff doc: `work-item list` -> `work-item view <id>` -> `work-item update <id>` -> `pr create` -> `pipeline runs view <id>`.
   Compare TOON output size and turn count against the equivalent raw `az` calls to confirm `ado-axi` is actually cheaper, not just spec-compliant on paper.
6. If `az`'s stderr for a real failure doesn't map to a clean `AxiError` in `src/errors.ts`, add a pattern - the existing ones for "not authenticated" and "org/project not configured" were captured from real `az` output, but most others are best-effort until exercised against a live org.

## Build/lint/test commands

- `npm run build` - `tsc`, emits to `dist/`.
- `npm run dev -- <args>` - run the CLI from source via `tsx`, no build step.
- `npm run typecheck` - `tsc --noEmit`.
- `npm run lint` - `eslint .`.
- `npm run test` - `vitest run`. `npm run test:watch` for watch mode.
- `node dist/bin/ado-axi.js --help` - smoke-test the built binary directly.

## Known gaps from the original handoff doc

- **`artifact`** only implements `download`/`publish` (wrapping `az artifacts universal`), not "feeds, packages" listing - the installed `azure-devops` CLI extension (1.0.6 at the time this was built) has no `az artifacts feed`/`az artifacts package` command group to wrap. If a future extension version adds one, extend `src/commands/artifact.ts` to match.
- **Error mapping** (`src/errors.ts`) is verified against real `az` stderr only for the config/auth cases reachable without a live org (see above). NOT_FOUND/FORBIDDEN/DEVOPS_EXTENSION_MISSING patterns are best-effort and should be tightened as real failures are observed.
- **Live end-to-end testing and token/turn cost measurement against a real org** (called for in the original handoff doc) was not done - there was no Azure DevOps org available in the build environment. Do this before treating the tool as validated for real use; see "Testing locally" above.
- **npm publish and the `kunchenguid/axi` catalog PR** were intentionally left undone. Publishing and submitting to a public catalog are decisions for the repo owner, not something to do automatically.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
