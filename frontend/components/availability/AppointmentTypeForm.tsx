"use client";

import type { Ref } from "react";
import { TextField } from "@/components/forms/TextField";
import {
  SLOT_DURATION_OPTIONS,
  formatDuration,
  type SlotDuration,
} from "@/lib/availability/durations";

interface AppointmentTypeFormProps {
  idPrefix: string;
  name: string;
  onNameChange: (value: string) => void;
  duration: SlotDuration;
  onDurationChange: (value: SlotDuration) => void;
  nameError?: string;
  formError?: string | null;
  saving: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  nameInputRef?: Ref<HTMLInputElement>;
}

/**
 * Form shared by "add a new appointment type" (`AppointmentTypesSection`)
 * and "edit this one" (`AppointmentTypeRow`): a name plus the slot-length
 * choice — real `<input type="radio">`s inside a `fieldset`/`legend`
 * (the `CollisionWarningModal` precedent), so the two lengths are
 * arrow-key switchable with native grouped semantics; 30 and 60 minutes
 * are the only choices the server accepts, so a closed radio pair beats a
 * free-typed number field. Fully controlled: the caller owns the field
 * values, saving state, and error state, and does its own client
 * validation before calling `onSubmit` (see both call sites for the
 * identical shape, matching this codebase's existing forms rather than a
 * shared submit-handling hook).
 */
export function AppointmentTypeForm({
  idPrefix,
  name,
  onNameChange,
  duration,
  onDurationChange,
  nameError,
  formError,
  saving,
  submitLabel,
  onSubmit,
  onCancel,
  nameInputRef,
}: AppointmentTypeFormProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      noValidate
      className="flex flex-wrap items-end gap-3 rounded border border-border bg-muted p-4 text-foreground"
    >
      <TextField
        label="Name"
        id={`${idPrefix}-name`}
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
        error={nameError}
        inputRef={nameInputRef}
      />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-sm font-medium">Slot length</legend>
        <div className="flex gap-4">
          {SLOT_DURATION_OPTIONS.map((option) => (
            <label
              key={option}
              className="flex items-center gap-2 text-sm"
              htmlFor={`${idPrefix}-duration-${option}`}
            >
              <input
                type="radio"
                id={`${idPrefix}-duration-${option}`}
                name={`${idPrefix}-duration`}
                value={option}
                checked={duration === option}
                onChange={() => onDurationChange(option)}
                disabled={saving}
              />
              {formatDuration(option)}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded border border-border-strong px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
      {formError ? (
        <p role="alert" className="w-full text-sm text-danger-text">
          {formError}
        </p>
      ) : null}
    </form>
  );
}
