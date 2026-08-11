"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import { formatZonedDateTime } from "@/lib/availability/timezone";
import type { BlockedTime } from "@/lib/availability/types";

interface BlockedTimeRowProps {
  block: BlockedTime;
  timezone: string;
  onRemove: (id: number) => Promise<void>;
}

type Mode = "view" | "confirm-delete";

/**
 * One blocked-time range: label (or a "Blocked" default), its date/time
 * range rendered in the provider's own timezone, and an inline two-step
 * delete confirmation -- the same pattern `AppointmentTypeRow` established,
 * so a misclick can't remove a block a provider is relying on. There's no
 * Edit here: per the ticket, editing is skipped in favor of delete-and-
 * recreate (see `BlockedTimeSection.tsx`'s docstring).
 */
export function BlockedTimeRow({ block, timezone, onRemove }: BlockedTimeRowProps) {
  const [mode, setMode] = useState<Mode>("view");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const label = block.label.trim() ? block.label : "Blocked";
  const range = `${formatZonedDateTime(block.start, timezone)} → ${formatZonedDateTime(block.end, timezone)} (${timezone})`;

  async function handleConfirmDelete() {
    setDeleting(true);
    try {
      await onRemove(block.id);
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) {
        setError("Couldn't remove this block — please try again.");
        setMode("view");
      }
    } finally {
      setDeleting(false);
    }
  }

  if (mode === "confirm-delete") {
    return (
      <li className="flex flex-col gap-2 border-b border-gray-200 py-3 last:border-b-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm">Remove {label}? These slots will become bookable again.</p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={handleConfirmDelete}
              disabled={deleting}
              className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Removing…" : "Confirm remove"}
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              disabled={deleting}
              className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        ) : null}
      </li>
    );
  }

  return (
    <li className="flex flex-col gap-2 border-b border-gray-200 py-3 last:border-b-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{label}</p>
          <p className="text-sm text-gray-600">{range}</p>
        </div>
        <button
          type="button"
          onClick={() => setMode("confirm-delete")}
          aria-label={`Remove ${label} (${range})`}
          className="rounded border border-gray-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Remove
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      ) : null}
    </li>
  );
}
