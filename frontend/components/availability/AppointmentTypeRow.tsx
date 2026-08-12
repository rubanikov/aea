"use client";

import { useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { isFieldErrorBody, splitFieldErrors } from "@/lib/api/field-errors";
import { formatDuration } from "@/lib/availability/durations";
import { validateAppointmentType } from "@/lib/availability/validation";
import type { AppointmentType, AppointmentTypeInput } from "@/lib/availability/types";
import { AppointmentTypeForm } from "./AppointmentTypeForm";

const KNOWN_SERVER_FIELDS = new Set(["name", "duration_minutes"]);

interface AppointmentTypeRowProps {
  appointmentType: AppointmentType;
  onSave: (
    id: number,
    values: AppointmentTypeInput
  ) => Promise<AppointmentType>;
  onDelete: (id: number) => Promise<void>;
}

type Mode = "view" | "edit" | "confirm-delete";

/**
 * A single appointment type: view mode (name, "45 minutes"-style duration,
 * Edit/Remove), inline edit mode (`AppointmentTypeForm`), and an inline
 * delete confirmation. Deleting is a two-step action so a misclick can't
 * destroy a type a provider is relying on.
 */
export function AppointmentTypeRow({
  appointmentType,
  onSave,
  onDelete,
}: AppointmentTypeRowProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [name, setName] = useState(appointmentType.name);
  const [durationMinutes, setDurationMinutes] = useState(
    appointmentType.duration_minutes
  );
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setName(appointmentType.name);
    setDurationMinutes(appointmentType.duration_minutes);
    setNameError(undefined);
    setFormError(null);
    setMode("edit");
  }

  async function handleSubmit() {
    const errors = validateAppointmentType({ name, duration_minutes: durationMinutes });
    if (errors.name) {
      setNameError(errors.name);
      nameInputRef.current?.focus();
      return;
    }

    setNameError(undefined);
    setFormError(null);
    setSaving(true);
    try {
      await onSave(appointmentType.id, {
        name: name.trim(),
        duration_minutes: durationMinutes,
      });
      setMode("view");
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        isFieldErrorBody(error.body)
      ) {
        const { fieldErrors, formError: serverFormError } = splitFieldErrors(
          error.body,
          KNOWN_SERVER_FIELDS
        );
        setNameError(fieldErrors.name);
        setFormError(serverFormError);
      } else if (!(error instanceof ApiError && error.status === 401)) {
        setFormError("Couldn't save changes — please try again.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await onDelete(appointmentType.id);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        setFormError("Couldn't remove this appointment type — please try again.");
        setMode("view");
      }
    } finally {
      setDeleting(false);
    }
  }

  if (mode === "edit") {
    return (
      <li className="border-b border-border py-3 last:border-b-0">
        <AppointmentTypeForm
          idPrefix={`appointment-type-${appointmentType.id}`}
          name={name}
          onNameChange={setName}
          durationMinutes={durationMinutes}
          onDurationChange={setDurationMinutes}
          nameError={nameError}
          formError={formError}
          saving={saving}
          submitLabel="Save"
          onSubmit={handleSubmit}
          onCancel={() => setMode("view")}
          nameInputRef={nameInputRef}
        />
      </li>
    );
  }

  if (mode === "confirm-delete") {
    return (
      <li className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">
            Remove {appointmentType.name}? Patients won&apos;t be able to book
            this appointment type anymore.
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="rounded bg-danger px-3 py-1.5 text-sm font-medium text-danger-foreground hover:opacity-90 disabled:opacity-50"
            >
              {deleting ? "Removing…" : "Confirm remove"}
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              disabled={deleting}
              className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
        {formError ? (
          <p role="alert" className="text-sm text-danger-text">
            {formError}
          </p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-medium">{appointmentType.name}</span>
        <div className="flex items-center gap-3">
          <span className="text-sm text-muted-foreground">
            {formatDuration(appointmentType.duration_minutes)}
          </span>
          <button
            type="button"
            onClick={startEdit}
            aria-label={`Edit ${appointmentType.name} appointment type`}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => setMode("confirm-delete")}
            aria-label={`Remove ${appointmentType.name} appointment type`}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium text-danger-text hover:bg-danger-soft"
          >
            Remove
          </button>
        </div>
      </div>
      {formError ? (
        <p role="alert" className="text-sm text-danger-text">
          {formError}
        </p>
      ) : null}
    </li>
  );
}
