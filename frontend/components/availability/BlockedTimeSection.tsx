"use client";

import { useEffect, useRef, useState } from "react";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { ApiError } from "@/lib/api/client";
import { isFieldErrorBody, splitFieldErrors } from "@/lib/api/field-errors";
import {
  isCollisionResponseBody,
  type AvailabilityCollision,
} from "@/lib/availability/collisions";
import { formatZonedDateTime, zonedDateTimeToUtcIso } from "@/lib/availability/timezone";
import {
  validateBlockedTimeForm,
  type BlockedTimeFieldErrors,
  type BlockedTimeFormValues,
} from "@/lib/availability/validation";
import type { BlockedTime, BlockedTimeInput } from "@/lib/availability/types";
import { BlockedTimeForm } from "./BlockedTimeForm";
import { BlockedTimeRow } from "./BlockedTimeRow";
import { CollisionWarningModal } from "./CollisionWarningModal";

const BLOCKED_TIME_PATH = "/scheduling/blocked-time";
const KNOWN_SERVER_FIELDS = new Set(["label", "start", "end"]);
const EMPTY_FORM: BlockedTimeFormValues = {
  label: "",
  fromDate: "",
  fromTime: "",
  toDate: "",
  toTime: "",
};

/** One open collision-warning modal's worth of state: the exact body that
 * raised the collision (resent verbatim, plus a resolution, on "Keep new
 * hours"), the affected appointments to list, and the change description
 * to show. */
interface CollisionState {
  body: BlockedTimeInput;
  collisions: AvailabilityCollision[];
  description: string;
}

/** e.g. `("2026-08-24T04:00:00.000Z", "2026-08-24T21:00:00.000Z",
 * "America/New_York")` -> `"You're blocking Aug 24, 2026 00:00 → Aug 24,
 * 2026 17:00 (America/New_York)."` Built on `formatZonedDateTime`, the
 * same formatter `BlockedTimeRow` already uses for a saved block's range,
 * so the collision modal's framing sentence reads exactly like the rest of
 * this section. */
function describeBlockedTimeChange(body: BlockedTimeInput, timezone: string): string {
  return `You're blocking ${formatZonedDateTime(body.start, timezone)} → ${formatZonedDateTime(body.end, timezone)} (${timezone}).`;
}

/**
 * Blocked time: a list of upcoming one-off ranges (vacation, an admin
 * block) that stack on top of the provider's weekly working hours, plus
 * an add form and remove-with-confirm. Uses
 * `GET`/`POST`/`DELETE /scheduling/blocked-time`: `{id, label, start,
 * end}`, `start`/`end` UTC ISO 8601, `label` optional on `POST`.
 *
 * No Edit: delete-and-recreate covers it instead, since a range edit has
 * two independent date/time pairs plus re-validation and re-conversion
 * through the provider's timezone, all for a save path that's otherwise
 * identical to "delete this one, add a new one" (the same simplification
 * `WorkingHoursSection` used for its own row saves).
 *
 * The provider's timezone is needed to convert the form's local date/time
 * inputs to the UTC instants the API stores, and to render existing blocks
 * back into local wall-clock time. Reuses `AppointmentTypesSection`'s
 * pattern for this, a plain `GET /profile` effect, since there's no
 * shared hook for it in this codebase yet.
 *
 * A `409` from `POST /scheduling/blocked-time` means the range would
 * strand existing bookings outside it: `CollisionWarningModal` opens
 * instead of the generic "Couldn't add this block" error. "Keep new
 * hours" resubmits the exact same body plus `resolution: "keep_new_hours"`,
 * which both flags the affected bookings and creates the block in the
 * same response. "Cancel this change" just closes the modal; the add form
 * stays open with whatever the provider typed, since (unlike
 * `WorkingHoursSection`, which is reverting an *edit* to something already
 * saved) there's nothing saved to revert to here, only an in-progress add
 * they may want to adjust and retry.
 */
export function BlockedTimeSection() {
  const authFetch = useAuthenticatedRequest();
  const [blocks, setBlocks] = useState<BlockedTime[] | null>(null); // null = loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [timezone, setTimezone] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [formValues, setFormValues] = useState<BlockedTimeFormValues>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<BlockedTimeFieldErrors>({});
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const [collisionState, setCollisionState] = useState<CollisionState | null>(null);
  const [collisionTrigger, setCollisionTrigger] = useState<HTMLElement | null>(null);
  const [confirmingCollision, setConfirmingCollision] = useState(false);
  const [collisionError, setCollisionError] = useState<string | null>(null);

  const fromDateRef = useRef<HTMLInputElement>(null);
  const fromTimeRef = useRef<HTMLInputElement>(null);
  const toDateRef = useRef<HTMLInputElement>(null);
  const toTimeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;

    authFetch<BlockedTime[]>(BLOCKED_TIME_PATH)
      .then((result) => {
        if (!cancelled) {
          setBlocks([...result].sort((a, b) => a.start.localeCompare(b.start)));
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ApiError && error.status === 401)) {
          setLoadError("Couldn't load your blocked time — please try again.");
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
        // Display-only for the read-only line elsewhere; here it also
        // powers UTC conversion, but a form-time error already covers a
        // still-missing timezone, so no need to also break this section's
        // main load state over it.
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch]);

  useEffect(() => {
    if (adding) {
      fromDateRef.current?.focus();
    }
  }, [adding]);

  function retry() {
    setLoadError(null);
    setBlocks(null);
    setReloadKey((key) => key + 1);
  }

  function startAdding() {
    setFormValues(EMPTY_FORM);
    setFieldErrors({});
    setAddFormError(null);
    setAdding(true);
  }

  function focusFirstInvalid(errors: BlockedTimeFieldErrors) {
    if (errors.fromDate) {
      fromDateRef.current?.focus();
    } else if (errors.fromTime) {
      fromTimeRef.current?.focus();
    } else if (errors.toDate) {
      toDateRef.current?.focus();
    } else if (errors.toTime) {
      toTimeRef.current?.focus();
    } else if (errors.range) {
      // Mirrors WorkingHoursSection: an order error focuses the range's
      // start field, not the end field the message is nominally "about".
      fromDateRef.current?.focus();
    }
  }

  async function handleAddSubmit() {
    const errors = validateBlockedTimeForm(formValues);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setAddFormError(null);
      focusFirstInvalid(errors);
      return;
    }
    if (!timezone) {
      setAddFormError("Still finding your timezone — please try again in a moment.");
      return;
    }

    setFieldErrors({});
    setAddFormError(null);
    setAddSaving(true);

    const body: BlockedTimeInput = {
      ...(formValues.label.trim() ? { label: formValues.label.trim() } : {}),
      start: zonedDateTimeToUtcIso(formValues.fromDate, formValues.fromTime, timezone),
      end: zonedDateTimeToUtcIso(formValues.toDate, formValues.toTime, timezone),
    };
    // Captured before the request (and before `disabled` on this button can
    // take effect on the next render) so it's still the real triggering
    // element if a collision opens the modal, same technique
    // `WorkingHoursSection`/`BookingConfirmPanel`'s caller use.
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    try {
      const created = await authFetch<BlockedTime>(BLOCKED_TIME_PATH, {
        method: "POST",
        body,
      });
      setBlocks((current) =>
        [...(current ?? []), created].sort((a, b) => a.start.localeCompare(b.start))
      );
      setAdding(false);
    } catch (error) {
      if (error instanceof ApiError && error.status === 409 && isCollisionResponseBody(error.body)) {
        setCollisionState({
          body,
          collisions: error.body.collisions,
          description: describeBlockedTimeChange(body, timezone),
        });
        setCollisionTrigger(trigger);
      } else if (
        error instanceof ApiError &&
        error.status === 400 &&
        isFieldErrorBody(error.body)
      ) {
        const { fieldErrors: serverFieldErrors, formError } = splitFieldErrors(
          error.body,
          KNOWN_SERVER_FIELDS
        );
        setFieldErrors({
          range:
            serverFieldErrors.end ?? serverFieldErrors.start ?? undefined,
        });
        setAddFormError(formError ?? serverFieldErrors.label ?? null);
      } else if (!(error instanceof ApiError && error.status === 401)) {
        setAddFormError("Couldn't add this block — please try again.");
      }
    } finally {
      setAddSaving(false);
    }
  }

  async function handleKeepNewHours() {
    if (!collisionState) {
      return;
    }
    setConfirmingCollision(true);
    setCollisionError(null);
    try {
      const created = await authFetch<BlockedTime>(BLOCKED_TIME_PATH, {
        method: "POST",
        body: { ...collisionState.body, resolution: "keep_new_hours" },
      });
      setBlocks((current) =>
        [...(current ?? []), created].sort((a, b) => a.start.localeCompare(b.start))
      );
      setAdding(false);
      setCollisionState(null);
    } catch (error) {
      if (!(error instanceof ApiError && error.status === 401)) {
        setCollisionError("Couldn't add this block — please try again.");
      }
    } finally {
      setConfirmingCollision(false);
    }
  }

  function handleCancelCollisionChange() {
    setCollisionState(null);
    setConfirmingCollision(false);
    setCollisionError(null);
  }

  async function handleRemove(id: number): Promise<void> {
    await authFetch(`${BLOCKED_TIME_PATH}/${id}`, { method: "DELETE" });
    setBlocks((current) => (current ?? []).filter((block) => block.id !== id));
  }

  const showHeaderAddButton = blocks !== null && blocks.length > 0 && !adding;

  return (
    <section
      aria-labelledby="blocked-time-heading"
      className="flex flex-col gap-4 rounded border border-border p-6"
    >
      <div className="flex items-center justify-between gap-4">
        <h2 id="blocked-time-heading" className="text-lg font-semibold">
          Blocked time
        </h2>
        {showHeaderAddButton ? (
          <button
            type="button"
            onClick={startAdding}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            + Add block
          </button>
        ) : null}
      </div>

      {loadError ? (
        <div className="flex flex-col items-start gap-2">
          <p role="alert" className="text-sm text-danger-text">
            {loadError}
          </p>
          <button
            type="button"
            onClick={retry}
            className="rounded border border-border-strong px-3 py-1.5 text-sm font-medium hover:bg-accent"
          >
            Try again
          </button>
        </div>
      ) : blocks === null ? (
        <p className="text-sm text-muted-foreground">Loading blocked time…</p>
      ) : blocks.length === 0 && !adding ? (
        <div className="flex flex-col items-start gap-3 rounded border border-dashed border-border-strong p-4">
          <p className="text-sm text-muted-foreground">
            No blocked time yet. Add vacation or a one-off block — it stacks
            on top of your weekly hours.
          </p>
          <button
            type="button"
            onClick={startAdding}
            className="rounded bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Add block
          </button>
        </div>
      ) : (
        <>
          <h3 className="text-sm font-medium text-muted-foreground">Upcoming blocks</h3>
          <ul className="flex flex-col">
            {blocks.map((block) => (
              <BlockedTimeRow
                key={block.id}
                block={block}
                timezone={timezone ?? "UTC"}
                onRemove={handleRemove}
              />
            ))}
          </ul>
        </>
      )}

      {adding ? (
        <BlockedTimeForm
          idPrefix="new-blocked-time"
          values={formValues}
          onChange={setFormValues}
          fieldErrors={fieldErrors}
          formError={addFormError}
          saving={addSaving}
          onSubmit={handleAddSubmit}
          onCancel={() => setAdding(false)}
          fromDateInputRef={fromDateRef}
          fromTimeInputRef={fromTimeRef}
          toDateInputRef={toDateRef}
          toTimeInputRef={toTimeRef}
        />
      ) : null}

      {collisionState ? (
        <CollisionWarningModal
          description={collisionState.description}
          collisions={collisionState.collisions}
          timezone={timezone ?? "UTC"}
          confirming={confirmingCollision}
          error={collisionError}
          onKeepNewHours={handleKeepNewHours}
          onCancelChange={handleCancelCollisionChange}
          triggerElement={collisionTrigger}
        />
      ) : null}
    </section>
  );
}
