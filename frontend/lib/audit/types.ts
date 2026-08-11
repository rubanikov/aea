/**
 * One row of the audit log, as returned by `GET /audit-log`. References
 * IDs only: no names, DOB, or contact details ever land in
 * `actor`/`action`/`target_id`, so this type carries no PHI-shaped fields.
 */
export interface AuditLogEntry {
  id: string;
  /** A user id, or `null` for a system-initiated entry with no human actor. */
  actor: string | null;
  action: string;
  target_type: string;
  target_id: string;
  /** ISO 8601, always UTC; see `lib/audit/format.ts`. */
  timestamp: string;
  metadata?: unknown;
}

/** `GET /audit-log`'s paginated-list response shape. */
export interface AuditLogResponse {
  results: AuditLogEntry[];
  count: number;
  page: number;
  page_size: number;
}

/**
 * The filter row's field values, in the form the UI edits them in (a plain
 * empty string means "not filtering on this"). Converted to
 * `GET /audit-log` query params by `buildAuditLogQuery`.
 */
export interface AuditLogFilterValues {
  /** A user id (the backend filters `actor` by exact numeric id, not name). */
  actor: string;
  action: string;
  targetType: string;
  /** `yyyy-mm-dd`, or `""` for "no lower bound". */
  dateFrom: string;
  /** `yyyy-mm-dd`, or `""` for "no upper bound". */
  dateTo: string;
}

export const EMPTY_AUDIT_LOG_FILTERS: AuditLogFilterValues = {
  actor: "",
  action: "",
  targetType: "",
  dateFrom: "",
  dateTo: "",
};
