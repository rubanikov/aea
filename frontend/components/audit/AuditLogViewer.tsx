"use client";

import { useEffect, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { buildAuditLogQuery, describeActiveFilters } from "@/lib/audit/filters";
import {
  EMPTY_AUDIT_LOG_FILTERS,
  type AuditLogFilterValues,
  type AuditLogResponse,
} from "@/lib/audit/types";
import { AuditLogFilters } from "./AuditLogFilters";
import { AuditLogPagination } from "./AuditLogPagination";
import { AuditLogTable } from "./AuditLogTable";

/**
 * Admin audit-log viewer: filter row, results table, pagination. Loads via
 * `GET /audit-log` through `useAuthenticatedRequest()` so 401 handling
 * (silent refresh, then redirect-to-login) is the same as every other
 * authenticated page -- this component never rolls its own fetch/401 logic.
 *
 * `draftFilters` is what the filter inputs show; `appliedFilters` is what's
 * actually driving the current fetch. They only converge on Apply/Clear --
 * this is what makes the filter row "explicit Apply", not
 * filter-as-you-type.
 */
export function AuditLogViewer() {
  const authFetch = useAuthenticatedRequest();
  const [draftFilters, setDraftFilters] = useState<AuditLogFilterValues>(
    EMPTY_AUDIT_LOG_FILTERS
  );
  const [appliedFilters, setAppliedFilters] = useState<AuditLogFilterValues>(
    EMPTY_AUDIT_LOG_FILTERS
  );
  const [page, setPage] = useState(1);
  const [retryToken, setRetryToken] = useState(0);
  const [data, setData] = useState<AuditLogResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The query this request cycle is for, and the query `data`/`error` last
  // resolved for. `loading` is derived from the two disagreeing rather than
  // its own imperative `setLoading(true/false)` -- an effect shouldn't set
  // state that's really just a computation of its own inputs.
  const requestQuery = `${buildAuditLogQuery(appliedFilters, page)}#${retryToken}`;
  const [resolvedQuery, setResolvedQuery] = useState<string | null>(null);
  const loading = resolvedQuery !== requestQuery;

  useEffect(() => {
    let cancelled = false;

    authFetch<AuditLogResponse>(
      `/audit-log?${buildAuditLogQuery(appliedFilters, page)}`
    )
      .then((result) => {
        if (cancelled) {
          return;
        }
        setData(result);
        setError(null);
        setResolvedQuery(requestQuery);
      })
      .catch((requestError) => {
        if (cancelled) {
          return;
        }
        // A 401 already triggers a redirect inside useAuthenticatedRequest.
        if (!(requestError instanceof ApiError && requestError.status === 401)) {
          setError("Couldn't load the audit log — please try again.");
        }
        setResolvedQuery(requestQuery);
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, appliedFilters, page, retryToken, requestQuery]);

  function handleApply() {
    setAppliedFilters(draftFilters);
    setPage(1);
  }

  function handleClear() {
    setDraftFilters(EMPTY_AUDIT_LOG_FILTERS);
    setAppliedFilters(EMPTY_AUDIT_LOG_FILTERS);
    setPage(1);
  }

  function handleRetry() {
    setRetryToken((token) => token + 1);
  }

  const totalCount = data?.count ?? 0;
  const pageSize = data?.page_size ?? 0;
  const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1;
  const rangeStart = (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, totalCount);

  return (
    <div className="flex flex-col gap-6">
      <AuditLogFilters
        values={draftFilters}
        onChange={setDraftFilters}
        onApply={handleApply}
        disabled={loading}
      />

      <p className="text-sm text-gray-600">
        {describeActiveFilters(appliedFilters)}
      </p>

      {loading ? (
        <p role="status" className="text-sm text-gray-600">
          Loading audit log…
        </p>
      ) : error ? (
        <div
          role="alert"
          className="flex flex-col items-start gap-2 text-sm text-red-600"
        >
          <p>{error}</p>
          <button
            type="button"
            onClick={handleRetry}
            className="rounded border border-red-600 px-4 py-2 text-sm font-medium hover:bg-red-50"
          >
            Retry
          </button>
        </div>
      ) : !data || data.results.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-gray-600">
            No audit events match these filters.
          </p>
          <button
            type="button"
            onClick={handleClear}
            className="text-sm underline"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            All timestamps are UTC. This log is append-only.
          </p>
          <AuditLogTable entries={data.results} />
          <AuditLogPagination
            page={page}
            totalPages={totalPages}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            totalCount={totalCount}
            onPrevious={() => setPage((current) => Math.max(1, current - 1))}
            onNext={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
            disabled={loading}
          />
        </>
      )}
    </div>
  );
}
