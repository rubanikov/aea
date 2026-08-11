"use client";

import type { Ref } from "react";
import { TextField } from "@/components/forms/TextField";
import type {
  BlockedTimeFieldErrors,
  BlockedTimeFormValues,
} from "@/lib/availability/validation";

const FIELD_CLASS =
  "rounded border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black";

interface BlockedTimeFormProps {
  idPrefix: string;
  values: BlockedTimeFormValues;
  onChange: (values: BlockedTimeFormValues) => void;
  fieldErrors: BlockedTimeFieldErrors;
  formError?: string | null;
  saving: boolean;
  onSubmit: () => void;
  onCancel: () => void;
  fromDateInputRef?: Ref<HTMLInputElement>;
  fromTimeInputRef?: Ref<HTMLInputElement>;
  toDateInputRef?: Ref<HTMLInputElement>;
  toTimeInputRef?: Ref<HTMLInputElement>;
}

/**
 * The "add a blocked-time range" form: an optional label plus From/To date
 * and time, entered in the provider's own timezone (converted to UTC at
 * submit time; see `BlockedTimeSection.tsx`). Fully controlled, one
 * `values` object like `AuditLogFilters` rather than `AppointmentTypeForm`'s
 * one-prop-per-field: five fields makes the single-object shape the
 * lighter prop list. There's no edit variant of this form (see
 * `BlockedTimeSection.tsx`'s docstring for why), so unlike
 * `AppointmentTypeForm` this one has exactly one call site.
 */
export function BlockedTimeForm({
  idPrefix,
  values,
  onChange,
  fieldErrors,
  formError,
  saving,
  onSubmit,
  onCancel,
  fromDateInputRef,
  fromTimeInputRef,
  toDateInputRef,
  toTimeInputRef,
}: BlockedTimeFormProps) {
  function updateField<K extends keyof BlockedTimeFormValues>(
    key: K,
    value: BlockedTimeFormValues[K]
  ) {
    onChange({ ...values, [key]: value });
  }

  const fromDateId = `${idPrefix}-from-date`;
  const fromTimeId = `${idPrefix}-from-time`;
  const toDateId = `${idPrefix}-to-date`;
  const toTimeId = `${idPrefix}-to-time`;
  const rangeErrorId = `${idPrefix}-range-error`;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      noValidate
      className="flex flex-col gap-3 rounded border border-gray-200 bg-gray-50 p-4"
    >
      <TextField
        label="Label (optional)"
        id={`${idPrefix}-label`}
        value={values.label}
        onChange={(event) => updateField("label", event.target.value)}
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={fromDateId} className="text-sm font-medium">
            From date
          </label>
          <input
            id={fromDateId}
            ref={fromDateInputRef}
            type="date"
            value={values.fromDate}
            onChange={(event) => updateField("fromDate", event.target.value)}
            aria-invalid={fieldErrors.fromDate ? true : undefined}
            aria-describedby={fieldErrors.fromDate ? `${fromDateId}-error` : undefined}
            className={FIELD_CLASS}
          />
          {fieldErrors.fromDate ? (
            <p id={`${fromDateId}-error`} role="alert" className="text-sm text-red-600">
              {fieldErrors.fromDate}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={fromTimeId} className="text-sm font-medium">
            From time
          </label>
          <input
            id={fromTimeId}
            ref={fromTimeInputRef}
            type="time"
            value={values.fromTime}
            onChange={(event) => updateField("fromTime", event.target.value)}
            aria-invalid={fieldErrors.fromTime ? true : undefined}
            aria-describedby={fieldErrors.fromTime ? `${fromTimeId}-error` : undefined}
            className={FIELD_CLASS}
          />
          {fieldErrors.fromTime ? (
            <p id={`${fromTimeId}-error`} role="alert" className="text-sm text-red-600">
              {fieldErrors.fromTime}
            </p>
          ) : null}
        </div>

        <span className="pb-2.5 text-sm text-gray-600">to</span>

        <div className="flex flex-col gap-1">
          <label htmlFor={toDateId} className="text-sm font-medium">
            To date
          </label>
          <input
            id={toDateId}
            ref={toDateInputRef}
            type="date"
            value={values.toDate}
            onChange={(event) => updateField("toDate", event.target.value)}
            aria-invalid={fieldErrors.toDate || fieldErrors.range ? true : undefined}
            aria-describedby={
              fieldErrors.toDate
                ? `${toDateId}-error`
                : fieldErrors.range
                  ? rangeErrorId
                  : undefined
            }
            className={FIELD_CLASS}
          />
          {fieldErrors.toDate ? (
            <p id={`${toDateId}-error`} role="alert" className="text-sm text-red-600">
              {fieldErrors.toDate}
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor={toTimeId} className="text-sm font-medium">
            To time
          </label>
          <input
            id={toTimeId}
            ref={toTimeInputRef}
            type="time"
            value={values.toTime}
            onChange={(event) => updateField("toTime", event.target.value)}
            aria-invalid={fieldErrors.toTime || fieldErrors.range ? true : undefined}
            aria-describedby={
              fieldErrors.toTime
                ? `${toTimeId}-error`
                : fieldErrors.range
                  ? rangeErrorId
                  : undefined
            }
            className={FIELD_CLASS}
          />
          {fieldErrors.toTime ? (
            <p id={`${toTimeId}-error`} role="alert" className="text-sm text-red-600">
              {fieldErrors.toTime}
            </p>
          ) : null}
        </div>
      </div>

      {fieldErrors.range ? (
        <p id={rangeErrorId} role="alert" className="text-sm text-red-600">
          {fieldErrors.range}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save block"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-100 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {formError ? (
        <p role="alert" className="text-sm text-red-600">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
