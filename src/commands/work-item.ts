import type { AdoContext } from "../context.js";
import { withOrgProject } from "../context.js";
import { azJson } from "../az.js";
import { AxiError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import { takeFlag, takeBoolFlag, takeNumber } from "../args.js";
import { takeBody } from "../body.js";
import { parseFields, type ExtraFieldSpec } from "../fields.js";
import { formatCountLine, truncateBody } from "../format.js";
import {
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  type FieldDef,
} from "../toon.js";

interface WorkItemRaw {
  id: number;
  fields?: Record<string, unknown>;
  url?: string;
}

function wiField(item: WorkItemRaw, key: string): unknown {
  return item.fields?.[key] ?? (item as unknown as Record<string, unknown>)[key] ?? null;
}

function wiPerson(value: unknown): string {
  if (value && typeof value === "object") {
    const person = value as { displayName?: string; uniqueName?: string };
    return person.displayName ?? person.uniqueName ?? "unassigned";
  }
  return typeof value === "string" && value.length > 0 ? value : "unassigned";
}

const idField = custom("id", (item: WorkItemRaw) => item.id);
const titleField = custom("title", (item: WorkItemRaw) => wiField(item, "System.Title"));
const stateField = custom("state", (item: WorkItemRaw) => wiField(item, "System.State"));
const typeField = custom("type", (item: WorkItemRaw) => wiField(item, "System.WorkItemType"));
const assigneeField = custom("assignee", (item: WorkItemRaw) =>
  wiPerson(wiField(item, "System.AssignedTo")),
);

const listSchema: FieldDef[] = [idField, titleField, stateField, assigneeField];

const LIST_EXTRA_FIELDS: Record<string, ExtraFieldSpec> = {
  type: { def: typeField },
  area: { def: custom("area", (item: WorkItemRaw) => wiField(item, "System.AreaPath")) },
  iteration: {
    def: custom("iteration", (item: WorkItemRaw) => wiField(item, "System.IterationPath")),
  },
  changed: {
    def: custom("changed", (item: WorkItemRaw) => wiField(item, "System.ChangedDate")),
  },
};

const viewSchema: FieldDef[] = [
  idField,
  titleField,
  typeField,
  stateField,
  assigneeField,
  custom("area", (item: WorkItemRaw) => wiField(item, "System.AreaPath")),
  custom("iteration", (item: WorkItemRaw) => wiField(item, "System.IterationPath")),
  custom("created", (item: WorkItemRaw) => wiField(item, "System.CreatedDate")),
  custom("changed", (item: WorkItemRaw) => wiField(item, "System.ChangedDate")),
  custom("tags", (item: WorkItemRaw) => {
    const tags = wiField(item, "System.Tags");
    return typeof tags === "string" && tags.length > 0 ? tags : "none";
  }),
  custom("description", (item: WorkItemRaw) =>
    truncateBody(wiField(item, "System.Description")),
  ),
];

const viewSchemaFull: FieldDef[] = viewSchema.map((f) =>
  "as" in f && f.as === "description"
    ? custom("description", (item: WorkItemRaw) => {
        const value = wiField(item, "System.Description");
        return typeof value === "string" ? value : "";
      })
    : f,
);

export const WORK_ITEM_HELP = `usage: ado-axi work-item <subcommand> [flags]
subcommands[5]:
  list, view <id>, create, update <id>, close <id>
flags{list}:
  --assigned-to <email|@me> (default @Me), --state <state|all> (default: not Closed/Removed), --type <name>, --limit <n> (default 50), --fields <a,b,c>
flags{view}:
  --full (show complete description without truncation), --fields <a,b,c>
flags{create}:
  --title <text> (required), --type <name> (required), --description <text> or --description-file <path>, --assigned-to <email>, --area <path>, --iteration <path>
flags{update}:
  --title, --state, --assigned-to, --description <text> or --description-file <path>, --area, --iteration, --reason
flags{close}:
  --reason <text>
examples:
  ado-axi work-item list --state Active
  ado-axi work-item view 1234
  ado-axi work-item create --title "Fix login bug" --type Bug --description "Steps to reproduce..."
  ado-axi work-item update 1234 --state "In Progress"
  ado-axi work-item close 1234`;

function buildWiql(assignedTo: string, state: string, type: string | undefined): string {
  const clauses = ["[System.TeamProject] = @project"];
  if (assignedTo === "any") {
    // no assignee filter
  } else {
    clauses.push(`[System.AssignedTo] = '${assignedTo.replace(/'/g, "''")}'`);
  }
  if (state === "all") {
    // no state filter
  } else {
    clauses.push(`[System.State] <> 'Closed'`, `[System.State] <> 'Removed'`);
  }
  if (type) {
    clauses.push(`[System.WorkItemType] = '${type.replace(/'/g, "''")}'`);
  }
  return `SELECT [System.Id] FROM WorkItems WHERE ${clauses.join(" AND ")} ORDER BY [System.ChangedDate] DESC`;
}

async function workItemList(args: string[], ctx?: AdoContext): Promise<string> {
  const fieldsArg = takeFlag(args, "--fields");
  const { extraDefs } = parseFields(fieldsArg, LIST_EXTRA_FIELDS);
  const assignedTo = takeFlag(args, "--assigned-to") ?? "@Me";
  const state = takeFlag(args, "--state") ?? "open";
  const type = takeFlag(args, "--type");
  const limit = Number(takeFlag(args, "--limit") ?? "50");

  const wiql = buildWiql(assignedTo, state === "open" ? "open" : state, type);
  const azArgs = withOrgProject(["boards", "query", "--wiql", wiql], ctx);
  const items = await azJson<WorkItemRaw[]>(azArgs);
  const results = Array.isArray(items) ? items : [];
  const isEmpty = results.length === 0;
  const shown = results.slice(0, limit);

  const countLine = isEmpty
    ? `count: 0 work items assigned to ${assignedTo === "@Me" ? "you" : assignedTo}`
    : formatCountLine({ count: shown.length, limit });

  const extendedSchema = extraDefs.length > 0 ? [...listSchema, ...extraDefs] : listSchema;

  return renderOutput([
    countLine,
    isEmpty ? "" : renderList("work_items", shown, extendedSchema),
    renderHelp(
      getSuggestions({
        domain: "work-item",
        action: "list",
        isEmpty,
        id: shown[0]?.id,
        ctx,
      }),
    ),
  ]);
}

async function workItemView(args: string[], ctx?: AdoContext): Promise<string> {
  const full = takeBoolFlag(args, "--full");
  const id = takeNumber(args, "work item");

  const azArgs = withOrgProject(["boards", "work-item", "show", "--id", String(id)], ctx, {
    project: false,
  });
  const item = await azJson<WorkItemRaw>(azArgs);

  return renderOutput([
    renderDetail("work_item", item, full ? viewSchemaFull : viewSchema),
    renderHelp(getSuggestions({ domain: "work-item", action: "view", id, ctx })),
  ]);
}

async function workItemCreate(args: string[], ctx?: AdoContext): Promise<string> {
  const title = takeFlag(args, "--title");
  if (!title) throw new AxiError("--title is required", "VALIDATION_ERROR");
  const type = takeFlag(args, "--type");
  if (!type) throw new AxiError("--type is required", "VALIDATION_ERROR");
  const description = takeBody(args);
  const assignedTo = takeFlag(args, "--assigned-to");
  const area = takeFlag(args, "--area");
  const iteration = takeFlag(args, "--iteration");

  const azArgs = ["boards", "work-item", "create", "--title", title, "--type", type];
  if (description !== undefined) azArgs.push("--description", description);
  if (assignedTo) azArgs.push("--assigned-to", assignedTo);
  if (area) azArgs.push("--area", area);
  if (iteration) azArgs.push("--iteration", iteration);

  const created = await azJson<WorkItemRaw>(withOrgProject(azArgs, ctx));

  return renderOutput([
    renderDetail("created", created, [idField, titleField, typeField, stateField]),
    renderHelp(
      getSuggestions({ domain: "work-item", action: "create", id: created.id, ctx }),
    ),
  ]);
}

async function workItemUpdate(args: string[], ctx?: AdoContext): Promise<string> {
  const id = takeNumber(args, "work item");
  const title = takeFlag(args, "--title");
  const state = takeFlag(args, "--state");
  const assignedTo = takeFlag(args, "--assigned-to");
  const description = takeBody(args);
  const area = takeFlag(args, "--area");
  const iteration = takeFlag(args, "--iteration");
  const reason = takeFlag(args, "--reason");

  const azArgs = ["boards", "work-item", "update", "--id", String(id)];
  if (title) azArgs.push("--title", title);
  if (state) azArgs.push("--state", state);
  if (assignedTo) azArgs.push("--assigned-to", assignedTo);
  if (description !== undefined) azArgs.push("--description", description);
  if (area) azArgs.push("--area", area);
  if (iteration) azArgs.push("--iteration", iteration);
  if (reason) azArgs.push("--reason", reason);

  const updated = await azJson<WorkItemRaw>(withOrgProject(azArgs, ctx, { project: false }));

  return renderOutput([
    renderDetail("updated", updated, [idField, titleField, stateField]),
    renderHelp(getSuggestions({ domain: "work-item", action: "update", id, ctx })),
  ]);
}

async function workItemClose(args: string[], ctx?: AdoContext): Promise<string> {
  const reason = takeFlag(args, "--reason");
  const id = takeNumber(args, "work item");

  const current = await azJson<WorkItemRaw>(
    withOrgProject(
      ["boards", "work-item", "show", "--id", String(id), "--fields", "System.State"],
      ctx,
      { project: false },
    ),
  );
  const state = String(wiField(current, "System.State") ?? "");
  if (state === "Closed") {
    return renderOutput([
      renderDetail("work_item", { id, state, already: true }, [
        idField,
        custom("state", (i: { state: string }) => i.state),
        custom("already", (i: { already: boolean }) => i.already),
      ]),
      renderHelp(getSuggestions({ domain: "work-item", action: "close", id, ctx })),
    ]);
  }

  const azArgs = ["boards", "work-item", "update", "--id", String(id), "--state", "Closed"];
  if (reason) azArgs.push("--reason", reason);
  await azJson<WorkItemRaw>(withOrgProject(azArgs, ctx, { project: false }));

  return renderOutput([
    renderDetail("closed", { id, state: "Closed", status: "ok" }, [
      idField,
      custom("state", (i: { state: string }) => i.state),
      custom("status", (i: { status: string }) => i.status),
    ]),
    renderHelp(getSuggestions({ domain: "work-item", action: "close", id, ctx })),
  ]);
}

export async function workItemCommand(args: string[], ctx?: AdoContext): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      return workItemList(rest, ctx);
    case "view":
      return workItemView(rest, ctx);
    case "create":
      return workItemCreate(rest, ctx);
    case "update":
      return workItemUpdate(rest, ctx);
    case "close":
      return workItemClose(rest, ctx);
    case "--help":
    case "-h":
    case "help":
    case undefined:
      return WORK_ITEM_HELP;
    default:
      throw new AxiError(`Unknown work-item subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `ado-axi work-item --help` to see available subcommands",
      ]);
  }
}
