"use client";

import { useRef, useState } from "react";
import { ApiError } from "@/lib/api/client";
import { isFieldErrorBody, splitFieldErrors } from "@/lib/api/field-errors";
import { isCollisionResponseBody } from "@/lib/availability/collisions";
import { formatDuration, type SlotDuration } from "@/lib/availability/durations";
import { validateAppointmentType } from "@/lib/availability/validation";
import type { AppointmentType, AppointmentTypeInput } from "@/lib/availability/types";
import { AppointmentTypeForm } from "./AppointmentTypeForm";

const KNOWN_SERVER_FIELDS = new Set(["name", "duration_minutes"]);

/** The 409 a `duration_minutes` change gets while the type has upcoming
 * booked appointments (`AppointmentTypeDetailView.patch`): those bookings
 * were made at the current length and are never silently stranded. */
function durationConflictMessage(collisionCount: number): string {
  const appointments =
    collisionCount === 1 ? "1 upcoming appointment" : `${collisionCount} upcoming appointments`;
  return `Can't change the slot length: ${appointments} of this type ${
    collisionCount === 1 ? "is" : "are"
  } already booked at the current length. Cancel or reschedule them first, or wait until they've passed.`;
}

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
 * A single appointment type: view mode (name, the chosen "30 minutes"/"60
 * minutes" slot length, Edit/Remove), inline edit mode
 * (`AppointmentTypeForm`: name + slot-length radios), and an inline delete
 * confirmation. Deleting is a two-step action so a misclick can't destroy
 * a type a provider is relying on. A slot-length change the server
 * refuses (409: upcoming appointments booked at the current length) is
 * surfaced as a specific message with the affected count, not a generic
 * failure.
 */
export function AppointmentTypeRow({
  appointmentType,
  onSave,
  onDelete,
}: AppointmentTypeRowProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [name, setName] = useState(appointmentType.name);
  const [duration, setDuration] = useState<SlotDuration>(
    appointmentType.duration_minutes === 30 ? 30 : 60
  );
  const [nameError, setNameError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    setName(appointmentType.name);
    setDuration(appointmentType.duration_minutes === 30 ? 30 : 60);
    setNameError(undefined);
    setFormError(null);
    setMode("edit");
  }

  async function handleSubmit() {
    const errors = validateAppointmentType({ name });
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
        duration_minutes: duration,
      });
      setMode("view");
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        isCollisionResponseBody(error.body)
      ) {
        setFormError(durationConflictMessage(error.body.collisions.length));
      } else if (
        error instanceof ApiError &&
        error.status === 400 &&
        isFieldErrorBody(error.body)
      ) {
        const { fieldErrors, formError: serverFormError } = splitFieldErrors(
          error.body,
          KNOWN_SERVER_FIELDS
        );
        setNameError(fieldErrors.name);
        setFormError(fieldErrors.duration_minutes ?? serverFormError);
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
          duration={duration}
          onDurationChange={setDuration}
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
