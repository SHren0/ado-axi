import { AxiError } from "./errors.js";
import type { FieldDef } from "./toon.js";

/** Describes an extra field that can be requested via --fields. */
export interface ExtraFieldSpec {
  def: FieldDef;
}

export interface ParseFieldsResult {
  extraDefs: FieldDef[];
}

/**
 * Parse a --fields value (comma-separated field names) against the available
 * map. Returns an empty result when fieldsArg is undefined (no --fields passed).
 * Throws AxiError with VALIDATION_ERROR for any unknown field names.
 */
export function parseFields(
  fieldsArg: string | undefined,
  available: Record<string, ExtraFieldSpec>,
): ParseFieldsResult {
  if (fieldsArg === undefined) {
    return { extraDefs: [] };
  }

  const requested = [
    ...new Set(
      fieldsArg
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
    ),
  ];

  const unknown = requested.filter((f) => !(f in available));
  if (unknown.length > 0) {
    const availableNames = Object.keys(available).sort().join(", ");
    throw new AxiError(
      `Unknown field(s): ${unknown.join(", ")}. Available: ${availableNames}`,
      "VALIDATION_ERROR",
    );
  }

  return { extraDefs: requested.map((name) => available[name].def) };
}
