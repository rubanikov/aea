interface AuditLogPaginationProps {
  page: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  totalCount: number;
  onPrevious: () => void;
  onNext: () => void;
  disabled?: boolean;
}

/**
 * Page N of M, real Prev/Next buttons (focusable, clearly labeled, not
 * bare arrow icons), and a "Showing X-Y of Z" count. The count text is
 * plain, visible text rather than an `aria-live` region: it's read
 * naturally by anything that reads the page, so extra ARIA plumbing here
 * would be over-engineering, not an accessibility improvement.
 */
export function AuditLogPagination({
  page,
  totalPages,
  rangeStart,
  rangeEnd,
  totalCount,
  onPrevious,
  onNext,
  disabled = false,
}: AuditLogPaginationProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p>
        Showing {totalCount === 0 ? 0 : rangeStart}
        &ndash;
        {totalCount === 0 ? 0 : rangeEnd} of {totalCount}
      </p>
      <nav
        aria-label="Audit log pagination"
        className="flex items-center gap-3"
      >
        <button
          type="button"
          onClick={onPrevious}
          disabled={disabled || page <= 1}
          aria-label="Go to previous page"
          className="rounded border border-border-strong px-3 py-1.5 font-medium hover:bg-accent disabled:opacity-50"
        >
          Previous
        </button>
        <span>
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={onNext}
          disabled={disabled || page >= totalPages}
          aria-label="Go to next page"
          className="rounded border border-border-strong px-3 py-1.5 font-medium hover:bg-accent disabled:opacity-50"
        >
          Next
        </button>
      </nav>
    </div>
  );
}
