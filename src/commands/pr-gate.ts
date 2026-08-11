import {
  isThreadUnresolved,
  type CommentThread,
  type PolicyEvaluation,
  type PullRequest,
  type PullRequestStatus,
  type ReviewerRef,
} from "../api/types.js";
import { filterThreads, personName, voteLabel } from "./pr-format.js";

export type GateState = "passed" | "pending" | "failed" | "unknown";

export interface GateResource<T> {
  available: boolean;
  items: T[];
  error?: string;
}

export interface PullRequestGate {
  state: GateState;
  reasons: string[];
  pull_request: {
    id: number;
    status: string;
    merge_status: string;
    completed: boolean;
  };
  checks: {
    state: GateState;
    available: boolean;
    total: number;
    succeeded: number;
    pending: number;
    failed: number;
    unknown: number;
    statuses: PullRequestStatus[];
    error?: string;
  };
  policies: {
    state: GateState;
    available: boolean;
    total: number;
    blocking: number;
    passed: number;
    pending: number;
    failed: number;
    unknown: number;
    evaluations: PolicyEvaluation[];
    error?: string;
  };
  threads: {
    state: GateState;
    available: boolean;
    total: number;
    unresolved: number;
    threads: CommentThread[];
    error?: string;
  };
  reviewers: {
    state: GateState;
    required: number;
    approved: number;
    pending: number;
    rejected: number;
    unknown: number;
    reviewers: Array<{
      reviewer: string;
      vote: string;
      required: boolean;
    }>;
  };
  auto_complete: {
    enabled: boolean;
    state: "enabled" | "disabled";
    set_by: string;
  };
  ready_for_auto_complete: boolean;
}

interface PolicyCounts {
  total: number;
  blocking: number;
  passed: number;
  pending: number;
  failed: number;
  unknown: number;
}

export function aggregatePullRequestGate(
  pr: PullRequest,
  checks: GateResource<PullRequestStatus>,
  policies: GateResource<PolicyEvaluation>,
  threads: GateResource<CommentThread>,
): PullRequestGate {
  const checkCounts = countChecks(checks.items);
  const policyCounts = countPolicies(policies.items);
  const visibleThreads = filterThreads(threads.items, { includeSystem: false });
  const unresolvedThreads = visibleThreads.filter((thread) =>
    isThreadUnresolved(thread.status),
  );
  const reviewerSummary = summarizeReviewers(pr.reviewers);
  const pullRequestStatus = normalize(pr.status);
  const pullRequestState = pullRequestStatus === "completed"
    ? "passed"
    : pullRequestStatus === "abandoned"
      ? "failed"
      : pullRequestStatus === "active"
        ? "pending"
        : "unknown";
  const checksState = resourceState(
    checks.available,
    checkCounts.failed > 0 ? "failed" : checkCounts.unknown > 0 ? "unknown" : checkCounts.pending > 0 ? "pending" : checkCounts.total > 0 ? "passed" : "unknown",
  );
  const policiesState = resourceState(
    policies.available,
    policyCounts.failed > 0
      ? "failed"
      : policyCounts.unknown > 0
        ? "unknown"
        : policyCounts.pending > 0
          ? "pending"
          : "passed",
  );
  const threadsState = resourceState(
    threads.available,
    unresolvedThreads.length > 0 ? "pending" : "passed",
  );
  const states = [checksState, policiesState, threadsState, reviewerSummary.state, pullRequestState] as GateState[];
  const state = overallState(states);
  const reasons = [
    ...(checksState !== "passed" ? [`checks: ${checksState}`] : []),
    ...(policiesState !== "passed" ? [`policies: ${policiesState}`] : []),
    ...(threadsState !== "passed" ? [`review_threads: ${threadsState} (${unresolvedThreads.length} unresolved)`] : []),
    ...(reviewerSummary.state !== "passed" ? [`required_reviewers: ${reviewerSummary.state}`] : []),
    ...(pullRequestState !== "passed" ? [`pull_request: ${pullRequestState}`] : []),
    ...(checks.error ? [`checks_error: ${checks.error}`] : []),
    ...(policies.error ? [`policies_error: ${policies.error}`] : []),
    ...(threads.error ? [`threads_error: ${threads.error}`] : []),
  ];
  const autoCompleteEnabled = pr.autoCompleteSetBy !== undefined && pr.autoCompleteSetBy !== null;

  return {
    state,
    reasons,
    pull_request: {
      id: pr.pullRequestId,
      status: pullRequestStatus,
      merge_status: normalize(pr.mergeStatus),
      completed: pullRequestStatus === "completed",
    },
    checks: {
      state: checksState,
      available: checks.available,
      ...checkCounts,
      statuses: checks.items,
      ...(checks.error ? { error: checks.error } : {}),
    },
    policies: {
      state: policiesState,
      available: policies.available,
      ...policyCounts,
      evaluations: policies.items,
      ...(policies.error ? { error: policies.error } : {}),
    },
    threads: {
      state: threadsState,
      available: threads.available,
      total: visibleThreads.length,
      unresolved: unresolvedThreads.length,
      threads: visibleThreads,
      ...(threads.error ? { error: threads.error } : {}),
    },
    reviewers: reviewerSummary,
    auto_complete: {
      enabled: autoCompleteEnabled,
      state: autoCompleteEnabled ? "enabled" : "disabled",
      set_by: autoCompleteEnabled ? personName(pr.autoCompleteSetBy ?? undefined) : "",
    },
    ready_for_auto_complete:
      pullRequestState === "pending" &&
      [checksState, policiesState, threadsState, reviewerSummary.state].every(
        (part) => part === "passed",
      ),
  };
}

function resourceState(available: boolean, state: GateState): GateState {
  return available ? state : "unknown";
}

function overallState(states: GateState[]): GateState {
  if (states.includes("failed")) return "failed";
  if (states.includes("unknown")) return "unknown";
  if (states.includes("pending")) return "pending";
  return "passed";
}

function normalize(value: string | undefined): string {
  return (value ?? "unknown").toLowerCase();
}

function countChecks(statuses: PullRequestStatus[]): {
  total: number;
  succeeded: number;
  pending: number;
  failed: number;
  unknown: number;
} {
  const counts = { total: statuses.length, succeeded: 0, pending: 0, failed: 0, unknown: 0 };
  for (const status of statuses) {
    switch (normalize(status.state)) {
      case "succeeded":
      case "notapplicable":
        counts.succeeded++;
        break;
      case "failed":
      case "error":
        counts.failed++;
        break;
      case "pending":
      case "notset":
      case "queued":
      case "inprogress":
      case "running":
        counts.pending++;
        break;
      default:
        counts.unknown++;
    }
  }
  return counts;
}

function countPolicies(evaluations: PolicyEvaluation[]): PolicyCounts {
  const counts: PolicyCounts = {
    total: evaluations.length,
    blocking: 0,
    passed: 0,
    pending: 0,
    failed: 0,
    unknown: 0,
  };
  for (const evaluation of evaluations) {
    if (!evaluation.configuration?.isBlocking) continue;
    counts.blocking++;
    switch (normalize(evaluation.status)) {
      case "approved":
      case "succeeded":
        counts.passed++;
        break;
      case "rejected":
      case "failed":
      case "error":
      case "broken":
        counts.failed++;
        break;
      case "queued":
      case "pending":
      case "running":
      case "inprogress":
        counts.pending++;
        break;
      default:
        counts.unknown++;
    }
  }
  return counts;
}

function summarizeReviewers(reviewers: ReviewerRef[] | undefined): PullRequestGate["reviewers"] {
  const required = (reviewers ?? []).filter((reviewer) => reviewer.isRequired);
  let approved = 0;
  let pending = 0;
  let rejected = 0;
  let unknown = 0;
  for (const reviewer of required) {
    if ((reviewer.vote ?? 0) >= 5) approved++;
    else if (reviewer.vote === -10) rejected++;
    else if (reviewer.vote === -5 || reviewer.vote === 0 || reviewer.vote === undefined) pending++;
    else unknown++;
  }
  const state: GateState =
    rejected > 0 ? "failed" : unknown > 0 ? "unknown" : pending > 0 ? "pending" : "passed";
  return {
    state,
    required: required.length,
    approved,
    pending,
    rejected,
    unknown,
    reviewers: required.map((reviewer) => ({
      reviewer: personName(reviewer),
      vote: voteLabel(reviewer.vote),
      required: true,
    })),
  };
}
