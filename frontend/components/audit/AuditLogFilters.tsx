"use client";

import type { FormEvent } from "react";
import type { AuditLogFilterValues } from "@/lib/audit/types";

interface AuditLogFiltersProps {
  values: AuditLogFilterValues;
  onChange: (values: AuditLogFilterValues) => void;
  onApply: () => void;
  disabled?: boolean;
}

const FIELD_CLASS =
  "rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black";

/**
 * The audit log's filter row: Actor, Action, Target type, and a date range,
 * plus an explicit Apply submit -- deliberately not a live/debounced
 * filter-as-you-type, so keyboard and screen-reader users get predictable
 * "type, then submit" behavior instead of the table re-fetching mid-input.
 *
 * Action and Target type are both free-text rather than closed `<select>`s:
 * actions are backend free-text strings (e.g.
 * `"status:confirmed->completed"`), not a fixed enum, and there's no
 * authoritative list of target types to hardcode into a picker either --
 * both would risk offering options that don't match what the backend
 * actually stores.
 */
export function AuditLogFilters({
  values,
  onChange,
  onApply,
  disabled = false,
}: AuditLogFiltersProps) {
  function updateField<K extends keyof AuditLogFilterValues>(
    key: K,
    value: AuditLogFilterValues[K]
  ) {
    onChange({ ...values, [key]: value });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onApply();
  }

  return (
    <form onSubmit={handleSubmit}>
      <fieldset
        disabled={disabled}
        className="flex flex-wrap items-end gap-4"
      >
        <legend className="mb-2 text-sm font-semibold">
          Filter audit log
        </legend>

        <div className="flex flex-col gap-1">
          <label htmlFor="audit-filter-actor" className="text-sm font-medium">
            Actor (user ID)
          </label>
          <input
            id="audit-filter-actor"
            type="text"
            inputMode="numeric"
            placeholder="e.g. 42"
            value={values.actor}
            onChange={(event) => updateField("actor", event.target.value)}
            className={FIELD_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="audit-filter-action"
            className="text-sm font-medium"
          >
            Action
          </label>
          <input
            id="audit-filter-action"
            type="text"
            value={values.action}
            onChange={(event) => updateField("action", event.target.value)}
            className={FIELD_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="audit-filter-target-type"
            className="text-sm font-medium"
          >
            Target type
          </label>
          <input
            id="audit-filter-target-type"
            type="text"
            value={values.targetType}
            onChange={(event) =>
              updateField("targetType", event.target.value)
            }
            className={FIELD_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="audit-filter-date-from"
            className="text-sm font-medium"
          >
            From date
          </label>
          <input
            id="audit-filter-date-from"
            type="date"
            value={values.dateFrom}
            onChange={(event) => updateField("dateFrom", event.target.value)}
            className={FIELD_CLASS}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label
            htmlFor="audit-filter-date-to"
            className="text-sm font-medium"
          >
            To date
          </label>
          <input
            id="audit-filter-date-to"
            type="date"
            value={values.dateTo}
            onChange={(event) => updateField("dateTo", event.target.value)}
            className={FIELD_CLASS}
          />
        </div>

        <button
          type="submit"
          className="rounded bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          Apply
        </button>
      </fieldset>
    </form>
  );
}
