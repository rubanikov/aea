import type { AuditLogFilterValues } from "./types";

/**
 * Builds the `GET /audit-log` query string for a set of filter values and a
 * page number. Blank fields are omitted entirely rather than sent as empty
 * strings, so the backend sees "not filtering on this" the same way an
 * untouched filter row does.
 */
export function buildAuditLogQuery(
  filters: AuditLogFilterValues,
  page: number
): string {
  const params = new URLSearchParams();
  if (filters.actor.trim()) {
    params.set("actor", filters.actor.trim());
  }
  if (filters.action.trim()) {
    params.set("action", filters.action.trim());
  }
  if (filters.targetType.trim()) {
    params.set("target_type", filters.targetType.trim());
  }
  if (filters.dateFrom) {
    params.set("date_from", filters.dateFrom);
  }
  if (filters.dateTo) {
    params.set("date_to", filters.dateTo);
  }
  params.set("page", String(page));
  return params.toString();
}

/**
 * Human-readable summary of the currently applied filters, e.g. for a
 * visible "Filtered by ..." line -- so a sighted or screen-reader user can
 * tell what's filtering the table without re-reading every field in the
 * form above it.
 */
export function describeActiveFilters(filters: AuditLogFilterValues): string {
  const parts: string[] = [];
  if (filters.actor) {
    parts.push(`actor "${filters.actor}"`);
  }
  if (filters.action) {
    parts.push(`action "${filters.action}"`);
  }
  if (filters.targetType) {
    parts.push(`target type "${filters.targetType}"`);
  }
  if (filters.dateFrom) {
    parts.push(`from ${filters.dateFrom}`);
  }
  if (filters.dateTo) {
    parts.push(`to ${filters.dateTo}`);
  }

  return parts.length
    ? `Filtered by ${parts.join(", ")}.`
    : "Showing all audit events (no filters applied).";
}
