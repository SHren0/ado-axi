# ado-axi

Azure DevOps CLI for agents - designed to the [AXI](https://axi.md) (Agent eXperience Interface) spec.

Wraps the official `az devops` extension (`az boards`, `az repos`, `az pipelines`, `az artifacts`) with token-efficient TOON output, contextual next-step suggestions, and structured error handling.
Built for AI coding agents that operate Azure DevOps via shell execution, instead of raw `az` calls or a generic MCP server.

Not yet published to npm - see `AGENTS.md` for what's built, what's left, and how to test it against a real org.

## Requirements

- Node.js 20+
- [`az`](https://aka.ms/azure-cli) with the `azure-devops` extension: `az extension add --name azure-devops`
- `az login` (AAD/MSA) or `az devops login` (PAT) for the target organization

## Usage

```sh
npm install
npm run build
node dist/bin/ado-axi.js                       # dashboard: your work items, open PRs, recent runs
node dist/bin/ado-axi.js work-item list
node dist/bin/ado-axi.js work-item view 1234
node dist/bin/ado-axi.js pr create --title "Fix login" --source-branch feature/login --target-branch main
node dist/bin/ado-axi.js pipeline run 12 --branch main
node dist/bin/ado-axi.js setup hooks            # install SessionStart ambient-context hooks
```

Every command and subcommand supports `--help`.
Pass `--org <url>`/`--project <name>` explicitly, or set them once with `az devops configure -d organization=... project=...`.

## Development

```sh
npm run dev -- work-item list   # run from source via tsx, no build step
npm run typecheck
npm run lint
npm run test
```

See `AGENTS.md` for the full command surface, the AXI principles checklist, and known gaps.
