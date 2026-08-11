"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { isFieldErrorBody, splitFieldErrors } from "@/lib/api/field-errors";
import { validateAppointmentType } from "@/lib/availability/validation";
import type { AppointmentType, AppointmentTypeInput } from "@/lib/availability/types";
import { AppointmentTypeForm } from "./AppointmentTypeForm";
import { AppointmentTypeRow } from "./AppointmentTypeRow";

const DEFAULT_DURATION = 15;
const KNOWN_SERVER_FIELDS = new Set(["name", "duration_minutes"]);

/**
 * Appointment types: list with inline edit, confirm-before-delete, and an
 * add-new form, plus a read-only timezone line. Uses
 * `GET`/`POST`/`PATCH`/`DELETE /scheduling/appointment-types`. The
 * timezone display reuses the existing `GET /profile` rather than a new
 * scheduling-specific field; it's read-only here (edit it from Account
 * settings).
 */
export function AppointmentTypesSection() {
  const authFetch = useAuthenticatedRequest();
  const [types, setTypes] = useState<AppointmentType[] | null>(null); // null = loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [timezone, setTimezone] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDuration, setNewDuration] = useState(DEFAULT_DURATION);
  const [newNameError, setNewNameError] = useState<string | undefined>();
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);
  const newNameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    authFetch<AppointmentType[]>("/scheduling/appointment-types")
      .then((result) => {
        if (!cancelled) {
          setTypes(result);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ApiError && error.status === 401)) {
          setLoadError("Couldn't load your appointment types — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, reloadKey]);

  useEffect(() => {
    let cancelled = false;

    authFetch<{ timezone: string }>("/profile")
      .then((result) => {
        if (!cancelled) {
          setTimezone(result.timezone);
        }
      })
      .catch(() => {
        // Display-only; if it fails to load, just omit the line rather
        // than blocking or cluttering this section with a second error.
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  useEffect(() => {
    if (adding) {
      newNameRef.current?.focus();
    }
  }, [adding]);

  function retry() {
    setLoadError(null);
    setTypes(null);
    setReloadKey((key) => key + 1);
  }

  function startAdding() {
    setNewName("");
    setNewDuration(DEFAULT_DURATION);
    setNewNameError(undefined);
    setAddFormError(null);
    setAdding(true);
  }

  async function handleAddSubmit() {
    const errors = validateAppointmentType({
      name: newName,
      duration_minutes: newDuration,
    });
    if (errors.name) {
      setNewNameError(errors.name);
      newNameRef.current?.focus();
      return;
    }

    setNewNameError(undefined);
    setAddFormError(null);
    setAddSaving(true);
    try {
      const created = await authFetch<AppointmentType>(
        "/scheduling/appointment-types",
        { method: "POST", body: { name: newName.trim(), duration_minutes: newDuration } }
      );
      setTypes((current) => [...(current ?? []), created]);
      setAdding(false);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 400 &&
        isFieldErrorBody(error.body)
      ) {
        const { fieldErrors, formError } = splitFieldErrors(
          error.body,
          KNOWN_SERVER_FIELDS
        );
        setNewNameError(fieldErrors.name);
        setAddFormError(formError);
      } else if (!(error instanceof ApiError && error.status === 401)) {
        setAddFormError("Couldn't add this appointment type — please try again.");
      }
    } finally {
      setAddSaving(false);
    }
  }

  async function handleRowSave(
    id: number,
    values: AppointmentTypeInput
  ): Promise<AppointmentType> {
    const updated = await authFetch<AppointmentType>(
      `/scheduling/appointment-types/${id}`,
      { method: "PATCH", body: values }
    );
    setTypes((current) =>
      (current ?? []).map((type) => (type.id === id ? updated : type))
    );
    return updated;
  }

  async function handleRowDelete(id: number): Promise<void> {
    await authFetch(`/scheduling/appointment-types/${id}`, { method: "DELETE" });
    setTypes((current) => (current ?? []).filter((type) => type.id !== id));
  }

  const showHeaderAddButton = types !== null && types.length > 0 && !adding;

  return (
    <section
      aria-labelledby="appointment-types-heading"
      className="flex flex-col gap-4 rounded border border-gray-200 p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="appointment-types-heading" className="text-lg font-semibold">
          Appointment types
        </h2>
        {showHeaderAddButton ? (
          <button
            type="button"
            onClick={startAdding}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            + Add type
          </button>
        ) : null}
      </div>

      {loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-red-600">
            {loadError}
          </p>
          <button
            type="button"
            onClick={retry}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50"
          >
            Try again
          </button>
        </div>
      ) : types === null ? (
        <p className="text-sm text-gray-600">Loading appointment types…</p>
      ) : types.length === 0 && !adding ? (
        <div className="flex flex-col items-start gap-3 rounded border border-dashed border-gray-300 p-4">
          <p className="text-sm text-gray-600">
            Add at least one appointment type before patients can book with
            you.
          </p>
          <button
            type="button"
            onClick={startAdding}
            className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            Add type
          </button>
        </div>
      ) : (
        <ul className="flex flex-col">
          {types.map((type) => (
            <AppointmentTypeRow
              key={type.id}
              appointmentType={type}
              onSave={handleRowSave}
              onDelete={handleRowDelete}
            />
          ))}
        </ul>
      )}

      {adding ? (
        <AppointmentTypeForm
          idPrefix="new-appointment-type"
          name={newName}
          onNameChange={setNewName}
          durationMinutes={newDuration}
          onDurationChange={setNewDuration}
          nameError={newNameError}
          formError={addFormError}
          saving={addSaving}
          submitLabel="Add type"
          onSubmit={handleAddSubmit}
          onCancel={() => setAdding(false)}
          nameInputRef={newNameRef}
        />
      ) : null}

      {timezone ? (
        <p className="text-sm text-gray-600">
          Timezone: {timezone} —{" "}
          <Link href="/settings" className="underline">
            change in Account settings
          </Link>
        </p>
      ) : null}
    </section>
  );
}
