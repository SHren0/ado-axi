import type { AdoContext } from "../context.js";
import { withOrgProject } from "../context.js";
import { azJson } from "../az.js";
import { AxiError } from "../errors.js";
import { getSuggestions } from "../suggestions.js";
import { takeFlag, takeBoolFlag, takeNumber, takeAllFlags } from "../args.js";
import { takeBody } from "../body.js";
import { formatCountLine, truncateBody } from "../format.js";
import {
  field,
  pluck,
  lower,
  boolYesNo,
  custom,
  renderList,
  renderDetail,
  renderHelp,
  renderOutput,
  type FieldDef,
} from "../toon.js";

interface Reviewer {
  displayName?: string;
  uniqueName?: string;
  vote?: number;
  isRequired?: boolean;
}

interface WorkItemRef {
  id?: string | number;
  url?: string;
}

interface PrItem {
  pullRequestId: number;
  title: string;
  status: string;
  createdBy?: { displayName?: string };
  isDraft?: boolean;
  sourceRefName?: string;
  targetRefName?: string;
  description?: string;
  reviewers?: Reviewer[];
  repository?: { name?: string; id?: string };
  mergeStatus?: string;
  closedDate?: string;
}

const VOTE_LABELS: Record<number, string> = {
  10: "approved",
  5: "approved_with_suggestions",
  0: "no_vote",
  [-5]: "waiting_for_author",
  [-10]: "rejected",
};

function reviewSummary(reviewers: Reviewer[] | undefined): string {
  if (!reviewers || reviewers.length === 0) return "no reviewers";
  const counts = { approved: 0, waiting: 0, rejected: 0, pending: 0 };
  for (const r of reviewers) {
    const vote = r.vote ?? 0;
    if (vote >= 5) counts.approved++;
    else if (vote === -5) counts.waiting++;
    else if (vote === -10) counts.rejected++;
    else counts.pending++;
  }
  const parts = [`${counts.approved} approved`];
  if (counts.rejected > 0) parts.push(`${counts.rejected} rejected`);
  if (counts.waiting > 0) parts.push(`${counts.waiting} waiting`);
  if (counts.pending > 0) parts.push(`${counts.pending} pending`);
  return parts.join(", ");
}

function reviewerNames(reviewers: Reviewer[] | undefined): string {
  if (!reviewers || reviewers.length === 0) return "none";
  return reviewers
    .map((r) => {
      const name = r.displayName ?? r.uniqueName ?? "unknown";
      const vote = VOTE_LABELS[r.vote ?? 0] ?? "no_vote";
      return r.isRequired ? `${name} (${vote}, required)` : `${name} (${vote})`;
    })
    .join(", ");
}

const reviewerSchema: FieldDef[] = [
  custom("reviewer", (r: Reviewer) => r.displayName ?? r.uniqueName ?? "unknown"),
  custom("vote", (r: Reviewer) => VOTE_LABELS[r.vote ?? 0] ?? "no_vote"),
  boolYesNo("isRequired", "required"),
];

const workItemRefSchema: FieldDef[] = [field("id"), field("url")];

const listSchema: FieldDef[] = [
  custom("id", (i: PrItem) => i.pullRequestId),
  field("title"),
  lower("status"),
  pluck("createdBy", "displayName", "author"),
  boolYesNo("isDraft", "draft"),
];

const viewSchema: FieldDef[] = [
  custom("id", (i: PrItem) => i.pullRequestId),
  field("title"),
  lower("status"),
  pluck("createdBy", "displayName", "author"),
  boolYesNo("isDraft", "draft"),
  custom("source", (i: PrItem) => (i.sourceRefName ?? "").replace(/^refs\/heads\//, "")),
  custom("target", (i: PrItem) => (i.targetRefName ?? "").replace(/^refs\/heads\//, "")),
  custom("reviewers", (i: PrItem) => reviewSummary(i.reviewers)),
  custom("reviewer_names", (i: PrItem) => reviewerNames(i.reviewers)),
  custom("description", (i: PrItem) => truncateBody(i.description)),
];

const viewSchemaFull: FieldDef[] = viewSchema.map((f) =>
  "as" in f && f.as === "description"
    ? custom("description", (i: PrItem) => i.description ?? "")
    : f,
);

export const PR_HELP = `usage: ado-axi pr <subcommand> [flags]
subcommands[11]:
  list, view <id>, create, complete <id>, review <id>, reviewers <id>, add-reviewer <id>, remove-reviewer <id>, work-items <id>, link-work-item <id>, unlink-work-item <id>
flags{list}:
  --status <active|completed|abandoned|all> (default active), --repository <name>, --creator <email>, --reviewer <email>, --source-branch <name>, --target-branch <name>, --top <n> (default 50)
flags{view}:
  --full (show complete description without truncation)
flags{create}:
  --title <text> (required), --source-branch <name> (required), --target-branch <name> (required), --repository <name>, --description <text> or --description-file <path>, --draft, --work-items <id> (repeatable), --required-reviewers <email> (repeatable)
flags{complete}:
  --squash, --delete-source-branch, --bypass-policy, --merge-commit-message <text>
flags{review}:
  --approve, --reject, --wait, --approve-with-suggestions, --reset
flags{add-reviewer}:
  --reviewers <email> (required, repeatable), --required (mark as a required reviewer)
flags{remove-reviewer}:
  --reviewers <email> (required, repeatable)
flags{link-work-item}:
  --work-items <id> (required, repeatable)
flags{unlink-work-item}:
  --work-items <id> (required, repeatable)
examples:
  ado-axi pr list --status active
  ado-axi pr view 42
  ado-axi pr create --title "Fix login" --source-branch feature/login --target-branch main
  ado-axi pr complete 42 --squash --delete-source-branch
  ado-axi pr review 42 --approve
  ado-axi pr add-reviewer 42 --reviewers alice@contoso.com --required
  ado-axi pr link-work-item 42 --work-items 14555`;

async function prList(args: string[], ctx?: AdoContext): Promise<string> {
  const status = takeFlag(args, "--status") ?? "active";
  const repository = takeFlag(args, "--repository") ?? ctx?.repo?.value;
  const creator = takeFlag(args, "--creator");
  const reviewer = takeFlag(args, "--reviewer");
  const sourceBranch = takeFlag(args, "--source-branch");
  const targetBranch = takeFlag(args, "--target-branch");
  const top = Number(takeFlag(args, "--top") ?? "50");

  const azArgs = ["repos", "pr", "list", "--status", status, "--top", String(top)];
  if (repository) azArgs.push("--repository", repository);
  if (creator) azArgs.push("--creator", creator);
  if (reviewer) azArgs.push("--reviewer", reviewer);
  if (sourceBranch) azArgs.push("--source-branch", sourceBranch);
  if (targetBranch) azArgs.push("--target-branch", targetBranch);

  const items = await azJson<PrItem[]>(withOrgProject(azArgs, ctx));
  const results = Array.isArray(items) ? items : [];
  const isEmpty = results.length === 0;

  const countLine = isEmpty
    ? `count: 0 ${status} pull requests`
    : formatCountLine({ count: results.length, limit: top });

  return renderOutput([
    countLine,
    isEmpty ? "" : renderList("pull_requests", results, listSchema),
    renderHelp(
      getSuggestions({ domain: "pr", action: "list", isEmpty, id: results[0]?.pullRequestId, ctx }),
    ),
  ]);
}

async function prView(args: string[], ctx?: AdoContext): Promise<string> {
  const full = takeBoolFlag(args, "--full");
  const id = takeNumber(args, "PR");

  const pr = await azJson<PrItem>(
    withOrgProject(["repos", "pr", "show", "--id", String(id)], ctx, { project: false }),
  );

  return renderOutput([
    renderDetail("pull_request", pr, full ? viewSchemaFull : viewSchema),
    renderHelp(getSuggestions({ domain: "pr", action: "view", id, state: pr.status, ctx })),
  ]);
}

async function prCreate(args: string[], ctx?: AdoContext): Promise<string> {
  const title = takeFlag(args, "--title");
  if (!title) throw new AxiError("--title is required", "VALIDATION_ERROR");
  const sourceBranch = takeFlag(args, "--source-branch");
  if (!sourceBranch) throw new AxiError("--source-branch is required", "VALIDATION_ERROR");
  const targetBranch = takeFlag(args, "--target-branch");
  if (!targetBranch) throw new AxiError("--target-branch is required", "VALIDATION_ERROR");
  const repository = takeFlag(args, "--repository") ?? ctx?.repo?.value;
  if (!repository) {
    throw new AxiError("--repository is required", "VALIDATION_ERROR", [
      "Pass --repository <name>, or run this from a clone of the target Azure Repos repository",
    ]);
  }
  const description = takeBody(args);
  const draft = takeBoolFlag(args, "--draft");
  const workItems = takeAllFlags(args, "--work-items");
  const requiredReviewers = takeAllFlags(args, "--required-reviewers");

  const azArgs = [
    "repos",
    "pr",
    "create",
    "--title",
    title,
    "--source-branch",
    sourceBranch,
    "--target-branch",
    targetBranch,
    "--repository",
    repository,
  ];
  if (description !== undefined) azArgs.push("--description", description);
  if (draft) azArgs.push("--draft");
  if (workItems.length > 0) azArgs.push("--work-items", ...workItems);
  if (requiredReviewers.length > 0) azArgs.push("--required-reviewers", ...requiredReviewers);

  const created = await azJson<PrItem>(withOrgProject(azArgs, ctx));

  return renderOutput([
    renderDetail("created", created, [
      custom("id", (i: PrItem) => i.pullRequestId),
      field("title"),
      lower("status"),
    ]),
    renderHelp(getSuggestions({ domain: "pr", action: "create", id: created.pullRequestId, ctx })),
  ]);
}

async function prComplete(args: string[], ctx?: AdoContext): Promise<string> {
  const squash = takeBoolFlag(args, "--squash");
  const deleteSourceBranch = takeBoolFlag(args, "--delete-source-branch");
  const bypassPolicy = takeBoolFlag(args, "--bypass-policy");
  const mergeCommitMessage = takeFlag(args, "--merge-commit-message");
  const id = takeNumber(args, "PR");

  const current = await azJson<PrItem>(
    withOrgProject(["repos", "pr", "show", "--id", String(id)], ctx, { project: false }),
  );
  if (current.status === "completed") {
    return renderOutput([
      renderDetail("pull_request", { id, status: "completed", already: true }, [
        custom("id", (i: { id: number }) => i.id),
        custom("status", (i: { status: string }) => i.status),
        custom("already", (i: { already: boolean }) => i.already),
      ]),
      renderHelp(getSuggestions({ domain: "pr", action: "complete", id, ctx })),
    ]);
  }

  const azArgs = ["repos", "pr", "update", "--id", String(id), "--status", "completed"];
  if (squash) azArgs.push("--squash", "true");
  if (deleteSourceBranch) azArgs.push("--delete-source-branch", "true");
  if (bypassPolicy) azArgs.push("--bypass-policy", "true");
  if (mergeCommitMessage) azArgs.push("--merge-commit-message", mergeCommitMessage);

  await azJson<PrItem>(withOrgProject(azArgs, ctx, { project: false }));

  return renderOutput([
    renderDetail("completed", { id, status: "ok" }, [
      custom("id", (i: { id: number }) => i.id),
      custom("status", (i: { status: string }) => i.status),
    ]),
    renderHelp(getSuggestions({ domain: "pr", action: "complete", id, ctx })),
  ]);
}

async function prReview(args: string[], ctx?: AdoContext): Promise<string> {
  const approve = takeBoolFlag(args, "--approve");
  const approveWithSuggestions = takeBoolFlag(args, "--approve-with-suggestions");
  const reject = takeBoolFlag(args, "--reject");
  const wait = takeBoolFlag(args, "--wait");
  const reset = takeBoolFlag(args, "--reset");
  const id = takeNumber(args, "PR");

  const chosen = [approve, approveWithSuggestions, reject, wait, reset].filter(Boolean).length;
  if (chosen !== 1) {
    throw new AxiError(
      "Choose exactly one of: --approve, --approve-with-suggestions, --reject, --wait, --reset",
      "VALIDATION_ERROR",
    );
  }

  const vote = approve
    ? "approve"
    : approveWithSuggestions
      ? "approve-with-suggestions"
      : reject
        ? "reject"
        : wait
          ? "wait-for-author"
          : "reset";

  await azJson(withOrgProject(["repos", "pr", "set-vote", "--id", String(id), "--vote", vote], ctx, {
    project: false,
  }));

  return renderOutput([
    renderDetail("review", { id, vote: VOTE_LABELS[voteValue(vote)] ?? vote }, [
      custom("id", (i: { id: number }) => i.id),
      custom("vote", (i: { vote: string }) => i.vote),
    ]),
    renderHelp(getSuggestions({ domain: "pr", action: "review", id, ctx })),
  ]);
}

async function prReviewers(args: string[], ctx?: AdoContext): Promise<string> {
  const id = takeNumber(args, "PR");

  const result = await azJson<Reviewer[]>(
    withOrgProject(["repos", "pr", "reviewer", "list", "--id", String(id)], ctx, {
      project: false,
    }),
  );
  const reviewers = Array.isArray(result) ? result : [];
  const isEmpty = reviewers.length === 0;

  return renderOutput([
    isEmpty ? "count: 0 reviewers" : `count: ${reviewers.length}`,
    isEmpty ? "" : renderList("reviewers", reviewers, reviewerSchema),
    renderHelp(getSuggestions({ domain: "pr", action: "reviewers", id, isEmpty, ctx })),
  ]);
}

async function prAddReviewer(args: string[], ctx?: AdoContext): Promise<string> {
  const required = takeBoolFlag(args, "--required");
  const id = takeNumber(args, "PR");
  const reviewers = takeAllFlags(args, "--reviewers");
  if (reviewers.length === 0) {
    throw new AxiError("--reviewers is required (repeatable)", "VALIDATION_ERROR", [
      "Pass --reviewers <email> once per reviewer to add",
    ]);
  }

  const azArgs = ["repos", "pr", "reviewer", "add", "--id", String(id), "--reviewers", ...reviewers];
  if (required) azArgs.push("--required", "true");
  await azJson(withOrgProject(azArgs, ctx, { project: false }));

  return renderOutput([
    renderDetail("reviewers_added", { id, reviewers: reviewers.join(", "), required }, [
      custom("id", (i: { id: number }) => i.id),
      custom("reviewers", (i: { reviewers: string }) => i.reviewers),
      boolYesNo("required"),
    ]),
    renderHelp(getSuggestions({ domain: "pr", action: "add-reviewer", id, ctx })),
  ]);
}

async function prRemoveReviewer(args: string[], ctx?: AdoContext): Promise<string> {
  const id = takeNumber(args, "PR");
  const reviewers = takeAllFlags(args, "--reviewers");
  if (reviewers.length === 0) {
    throw new AxiError("--reviewers is required (repeatable)", "VALIDATION_ERROR", [
      "Pass --reviewers <email> once per reviewer to remove",
    ]);
  }

  await azJson(
    withOrgProject(
      ["repos", "pr", "reviewer", "remove", "--id", String(id), "--reviewers", ...reviewers],
      ctx,
      { project: false },
    ),
  );

  return renderOutput([
    renderDetail("reviewers_removed", { id, reviewers: reviewers.join(", ") }, [
      custom("id", (i: { id: number }) => i.id),
      custom("reviewers", (i: { reviewers: string }) => i.reviewers),
    ]),
    renderHelp(getSuggestions({ domain: "pr", action: "remove-reviewer", id, ctx })),
  ]);
}

async function prWorkItems(args: string[], ctx?: AdoContext): Promise<string> {
  const id = takeNumber(args, "PR");

  const result = await azJson<WorkItemRef[]>(
    withOrgProject(["repos", "pr", "work-item", "list", "--id", String(id)], ctx, {
      project: false,
    }),
  );
  const items = Array.isArray(result) ? result : [];
  const isEmpty = items.length === 0;

  return renderOutput([
    isEmpty ? "count: 0 linked work items" : `count: ${items.length}`,
    isEmpty ? "" : renderList("work_items", items, workItemRefSchema),
    renderHelp(getSuggestions({ domain: "pr", action: "work-items", id, isEmpty, ctx })),
  ]);
}

async function prLinkWorkItem(args: string[], ctx?: AdoContext): Promise<string> {
  const id = takeNumber(args, "PR");
  const workItems = takeAllFlags(args, "--work-items");
  if (workItems.length === 0) {
    throw new AxiError("--work-items is required (repeatable)", "VALIDATION_ERROR", [
      "Pass --work-items <id> once per work item to link",
    ]);
  }

  await azJson(
    withOrgProject(
      ["repos", "pr", "work-item", "add", "--id", String(id), "--work-items", ...workItems],
      ctx,
      { project: false },
    ),
  );

  return renderOutput([
    renderDetail("work_items_linked", { id, workItems: workItems.join(", ") }, [
      custom("id", (i: { id: number }) => i.id),
      custom("work_items", (i: { workItems: string }) => i.workItems),
    ]),
    renderHelp(getSuggestions({ domain: "pr", action: "link-work-item", id, ctx })),
  ]);
}

async function prUnlinkWorkItem(args: string[], ctx?: AdoContext): Promise<string> {
  const id = takeNumber(args, "PR");
  const workItems = takeAllFlags(args, "--work-items");
  if (workItems.length === 0) {
    throw new AxiError("--work-items is required (repeatable)", "VALIDATION_ERROR", [
      "Pass --work-items <id> once per work item to unlink",
    ]);
  }

  await azJson(
    withOrgProject(
      ["repos", "pr", "work-item", "remove", "--id", String(id), "--work-items", ...workItems],
      ctx,
      { project: false },
    ),
  );

  return renderOutput([
    renderDetail("work_items_unlinked", { id, workItems: workItems.join(", ") }, [
      custom("id", (i: { id: number }) => i.id),
      custom("work_items", (i: { workItems: string }) => i.workItems),
    ]),
    renderHelp(getSuggestions({ domain: "pr", action: "unlink-work-item", id, ctx })),
  ]);
}

function voteValue(vote: string): number {
  switch (vote) {
    case "approve":
      return 10;
    case "approve-with-suggestions":
      return 5;
    case "reject":
      return -10;
    case "wait-for-author":
      return -5;
    default:
      return 0;
  }
}

export async function prCommand(args: string[], ctx?: AdoContext): Promise<string> {
  const sub = args[0];
  const rest = args.slice(1);

  switch (sub) {
    case "list":
      return prList(rest, ctx);
    case "view":
      return prView(rest, ctx);
    case "create":
      return prCreate(rest, ctx);
    case "complete":
      return prComplete(rest, ctx);
    case "review":
      return prReview(rest, ctx);
    case "reviewers":
      return prReviewers(rest, ctx);
    case "add-reviewer":
      return prAddReviewer(rest, ctx);
    case "remove-reviewer":
      return prRemoveReviewer(rest, ctx);
    case "work-items":
      return prWorkItems(rest, ctx);
    case "link-work-item":
      return prLinkWorkItem(rest, ctx);
    case "unlink-work-item":
      return prUnlinkWorkItem(rest, ctx);
    case "--help":
    case "-h":
    case "help":
    case undefined:
      return PR_HELP;
    default:
      throw new AxiError(`Unknown pr subcommand: ${sub}`, "VALIDATION_ERROR", [
        "Run `ado-axi pr --help` to see available subcommands",
      ]);
  }
}
