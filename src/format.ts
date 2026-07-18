/**
 * Shared formatting helpers for consistent count and truncation phrasing.
 *
 * Standard phrases:
 *   count: N                     - simple count
 *   count: N of T total          - when a true total is known
 *   count: N (showing first N)   - when truncated by --limit
 */

export interface CountLineOptions {
  count: number;
  limit?: number;
  totalCount?: number;
}

export function formatCountLine(opts: CountLineOptions): string {
  const { count, limit, totalCount } = opts;

  if (totalCount !== undefined && totalCount !== null) {
    return `count: ${count} of ${totalCount} total`;
  }

  if (limit !== undefined && count === limit && count > 0) {
    return `count: ${count} (showing first ${count})`;
  }

  return `count: ${count}`;
}

const MAX_BODY_CHARS = 1000;

/**
 * Truncate a description/body field at roughly 1000 characters, per the AXI
 * content-truncation principle. Returns the raw text unmodified when it
 * already fits.
 */
export function truncateBody(body: unknown, maxLen = MAX_BODY_CHARS): string {
  if (typeof body !== "string" || !body) return "";
  if (body.length <= maxLen) return body;
  return `${body.slice(0, maxLen)}\n... (truncated, ${body.length} chars total - use --full to see the complete text)`;
}
