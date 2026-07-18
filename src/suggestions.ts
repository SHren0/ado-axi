import type { AdoContext } from "./context.js";

interface SuggestionContext {
  domain: string;
  action: string;
  state?: string;
  isEmpty?: boolean;
  id?: string | number;
  ctx?: AdoContext;
}

type SuggestionEntry = {
  match: (c: SuggestionContext) => boolean;
  lines: (c: SuggestionContext) => string[];
};

const table: SuggestionEntry[] = [
  {
    match: (c) => c.domain === "home",
    lines: () => [
      "Run `ado-axi <command> <subcommand>` - commands: work-item, pr, pipeline, repo, artifact, iteration",
    ],
  },

  // work-item
  {
    match: (c) => c.domain === "work-item" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`ado-axi work-item view ${c.id ?? "<id>"}\` to see full details`,
      `Run \`ado-axi work-item create --title "..." --type Bug\` to create a work item`,
    ],
  },
  {
    match: (c) => c.domain === "work-item" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      `Run \`ado-axi work-item create --title "..." --type Bug\` to create a work item`,
      `Run \`ado-axi work-item list --state all\` to include closed work items`,
    ],
  },
  {
    match: (c) => c.domain === "work-item" && c.action === "view",
    lines: (c) => [
      `Run \`ado-axi work-item update ${c.id} --state Active\` to change state`,
      `Run \`ado-axi work-item close ${c.id}\` to close`,
    ],
  },
  {
    match: (c) => c.domain === "work-item" && c.action === "create",
    lines: (c) => [`Run \`ado-axi work-item view ${c.id}\` to see the new work item`],
  },
  {
    match: (c) => c.domain === "work-item" && c.action === "update",
    lines: (c) => [`Run \`ado-axi work-item view ${c.id}\` to see the updated work item`],
  },
  {
    match: (c) => c.domain === "work-item" && c.action === "close",
    lines: (c) => [`Run \`ado-axi work-item view ${c.id}\` to confirm the closed state`],
  },

  // pr
  {
    match: (c) => c.domain === "pr" && c.action === "list" && !c.isEmpty,
    lines: (c) => [
      `Run \`ado-axi pr view ${c.id ?? "<id>"}\` to see full details`,
      `Run \`ado-axi pr create --title "..." --source-branch <branch> --target-branch main\` to open a PR`,
    ],
  },
  {
    match: (c) => c.domain === "pr" && c.action === "list" && c.isEmpty === true,
    lines: () => [
      `Run \`ado-axi pr create --title "..." --source-branch <branch> --target-branch main\` to open a PR`,
      `Run \`ado-axi pr list --status all\` to include completed/abandoned PRs`,
    ],
  },
  {
    match: (c) => c.domain === "pr" && c.action === "view" && c.state === "active",
    lines: (c) => [
      `Run \`ado-axi pr review ${c.id} --approve\` to approve`,
      `Run \`ado-axi pr complete ${c.id}\` to complete`,
    ],
  },
  {
    match: (c) => c.domain === "pr" && c.action === "view",
    lines: () => ["Run `ado-axi pr list` to see other pull requests"],
  },
  {
    match: (c) => c.domain === "pr" && c.action === "create",
    lines: (c) => [`Run \`ado-axi pr view ${c.id}\` to see the new pull request`],
  },
  {
    match: (c) => c.domain === "pr" && c.action === "complete",
    lines: (c) => [`Run \`ado-axi pr view ${c.id}\` to confirm the completed state`],
  },
  {
    match: (c) => c.domain === "pr" && c.action === "review",
    lines: (c) => [`Run \`ado-axi pr view ${c.id}\` to see the pull request`],
  },

  // pipeline
  {
    match: (c) => c.domain === "pipeline" && c.action === "list",
    lines: (c) => [`Run \`ado-axi pipeline view ${c.id ?? "<id>"}\` to see details`],
  },
  {
    match: (c) => c.domain === "pipeline" && c.action === "view",
    lines: (c) => [`Run \`ado-axi pipeline run ${c.id}\` to queue a run`],
  },
  {
    match: (c) => c.domain === "pipeline" && c.action === "run",
    lines: (c) => [`Run \`ado-axi pipeline runs view ${c.id}\` to monitor progress`],
  },
  {
    match: (c) => c.domain === "pipeline" && c.action === "runs-list" && !c.isEmpty,
    lines: (c) => [`Run \`ado-axi pipeline runs view ${c.id ?? "<id>"}\` to see a run's details`],
  },
  {
    match: (c) => c.domain === "pipeline" && c.action === "runs-view",
    lines: (c) => [`Run \`ado-axi pipeline cancel ${c.id}\` to cancel if still in progress`],
  },
  {
    match: (c) => c.domain === "pipeline" && c.action === "cancel",
    lines: (c) => [`Run \`ado-axi pipeline runs view ${c.id}\` to see the final state`],
  },

  // repo
  {
    match: (c) => c.domain === "repo" && c.action === "list",
    lines: () => [`Run \`ado-axi repo view <name>\` to see a repository's details`],
  },
  {
    match: (c) => c.domain === "repo" && c.action === "view",
    lines: (c) => [`Run \`ado-axi repo clone ${c.id}\` to clone it locally`],
  },
  {
    match: (c) => c.domain === "repo" && c.action === "clone",
    lines: () => [],
  },

  // artifact
  {
    match: (c) => c.domain === "artifact",
    lines: () => [],
  },

  // iteration
  {
    match: (c) => c.domain === "iteration" && c.action === "list",
    lines: () => [`Run \`ado-axi iteration current --team <team>\` to see the active sprint`],
  },
  {
    match: (c) => c.domain === "iteration" && c.action === "current",
    lines: () => [`Run \`ado-axi iteration list\` to see all iterations`],
  },
];

export function getSuggestions(ctx: SuggestionContext): string[] {
  for (const entry of table) {
    if (entry.match(ctx)) {
      return entry.lines(ctx);
    }
  }
  return [];
}
