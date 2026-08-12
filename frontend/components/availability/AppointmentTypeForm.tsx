"use client";

import type { Ref } from "react";
import { TextField } from "@/components/forms/TextField";
import { DurationSelect } from "./DurationSelect";

interface AppointmentTypeFormProps {
  idPrefix: string;
  name: string;
  onNameChange: (value: string) => void;
  durationMinutes: number;
  onDurationChange: (value: number) => void;
  nameError?: string;
  formError?: string | null;
  saving: boolean;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  nameInputRef?: Ref<HTMLInputElement>;
}

/**
 * Name + duration fields shared by "add a new appointment type"
 * (`AppointmentTypesSection`) and "edit this one" (`AppointmentTypeRow`).
 * Fully controlled: the caller owns the field values, saving state, and
 * error state, and does its own client validation before calling
 * `onSubmit` (see both call sites for the identical shape, matching this
 * codebase's existing forms rather than a shared submit-handling hook).
 */
export function AppointmentTypeForm({
  idPrefix,
  name,
  onNameChange,
  durationMinutes,
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
      <DurationSelect
        id={`${idPrefix}-duration`}
        value={durationMinutes}
        onChange={onDurationChange}
      />
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
