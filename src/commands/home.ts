import { encode } from "@toon-format/toon";
import type { AdoContext } from "../context.js";
import { withOrgProject } from "../context.js";
import { azJson } from "../az.js";
import { renderHelp, renderOutput } from "../toon.js";
import { getSuggestions } from "../suggestions.js";

interface WorkItemRaw {
  id: number;
  fields?: Record<string, unknown>;
}

interface PrItem {
  pullRequestId: number;
  title: string;
  status: string;
}

interface PipelineRun {
  id: number;
  result?: string;
  status?: string;
  definition?: { name?: string };
}

export const HOME_HELP = "";

function wiField(item: WorkItemRaw, key: string): unknown {
  return item.fields?.[key] ?? null;
}

export async function homeCommand(_args: string[], ctx?: AdoContext): Promise<string> {
  if (!ctx?.org) {
    return renderOutput([
      "work_items: unavailable - no organization configured",
      renderHelp([
        "Run `ado-axi setup hooks` to install ambient context hooks",
        "Pass --org https://dev.azure.com/<org>/ or run `az devops configure -d organization=...`",
      ]),
    ]);
  }

  const wiql =
    "SELECT [System.Id] FROM WorkItems WHERE [System.AssignedTo] = @Me AND [System.State] <> 'Closed' AND [System.State] <> 'Removed' ORDER BY [System.ChangedDate] DESC";

  const [workItems, prs, runs] = await Promise.all([
    azJson<WorkItemRaw[]>(withOrgProject(["boards", "query", "--wiql", wiql], ctx)).catch(
      () => [] as WorkItemRaw[],
    ),
    azJson<PrItem[]>(
      withOrgProject(["repos", "pr", "list", "--status", "active", "--top", "3"], ctx),
    ).catch(() => [] as PrItem[]),
    azJson<PipelineRun[]>(withOrgProject(["pipelines", "runs", "list", "--top", "3"], ctx)).catch(
      () => [] as PipelineRun[],
    ),
  ]);

  const items = Array.isArray(workItems) ? workItems.slice(0, 3) : [];
  const prList = Array.isArray(prs) ? prs : [];
  const runList = Array.isArray(runs) ? runs : [];

  const blocks: string[] = [];
  blocks.push(encode({ org: ctx.org.value, project: ctx.project?.value ?? "(unset)" }));

  blocks.push(
    items.length
      ? encode({
          work_items: items.map((i) => ({
            id: i.id,
            title: wiField(i, "System.Title"),
            state: wiField(i, "System.State"),
          })),
        })
      : "work_items: 0 active work items assigned to you",
  );

  blocks.push(
    prList.length
      ? encode({
          prs: prList.map((p) => ({
            id: p.pullRequestId,
            title: p.title,
            status: p.status,
          })),
        })
      : "prs: 0 open pull requests",
  );

  blocks.push(
    runList.length
      ? encode({
          pipeline_runs: runList.map((r) => ({
            id: r.id,
            pipeline: r.definition?.name ?? "unknown",
            result: r.result ?? r.status ?? "unknown",
          })),
        })
      : "pipeline_runs: 0 recent runs",
  );

  const hints: string[] = [];
  if (items.length > 0) hints.push(`Run \`ado-axi work-item view ${items[0].id}\` for details`);
  if (prList.length > 0) hints.push(`Run \`ado-axi pr view ${prList[0].pullRequestId}\` for details`);
  blocks.push(renderHelp([...hints, ...getSuggestions({ domain: "home", action: "home", ctx })]));

  return renderOutput(blocks);
}
