"use client";

import { useState } from "react";
import { ApiError } from "@/lib/api/client";
import {
  extractBookingErrorDetail,
  extractCancellationReasonError,
} from "@/lib/bookings/errors";
import type {
  BookingStatusAction,
  BookingStatusChangeResult,
  ProviderBooking,
} from "@/lib/bookings/types";

export const CANCELLATION_REASON_MAX_LENGTH = 500;

export type StatusChangeHandler = (
  id: number,
  status: BookingStatusAction,
  cancellationReason?: string
) => Promise<BookingStatusChangeResult>;

type Mode = "view" | "confirm-cancel";

/**
 * The one shared implementation of a provider's booking-status actions,
 * including the cancel-with-required-reason flow and the post-cancel
 * notification warnings. Extracted out of `AgendaRow` so the agenda row
 * (narrow-screen fallback) and the week grid's detail popover share this
 * exact behavior rather than drifting copies:
 *
 * - `handleAction` runs the one-click transitions (completed / no_show),
 *   surfacing a 400's `detail` (or a generic message) via `error`.
 * - Cancel is a two-step confirm: `openConfirmCancel` shows the reason
 *   step; `handleConfirmCancel` submits the trimmed reason. A 400
 *   `cancellation_reason` field error keeps the confirm step open (via
 *   `cancelReasonError`) so the provider can fix and retry; any other
 *   failure drops back to view mode with the row-level `error`.
 * - After a successful cancel, `emailNotDelivered` flips when the
 *   response's notification reports the email wasn't sent (which also
 *   covers an unconfigured mail backend), and `smsNotDelivered` when an
 *   SMS send was *attempted* and failed (`sms_attempted && !sms_sent`) —
 *   a skipped send (no phone/carrier on file) is expected, not a failure,
 *   and warns about nothing. The two are independent: 0, 1, or 2 warnings
 *   can show (see `NotificationWarnings`).
 *
 * `acting` carries which action is in flight (all buttons disable
 * together while any runs); 401s are left silent — the shared auth hook
 * already redirects to login.
 */
export function useBookingStatusActions(
  booking: ProviderBooking,
  onStatusChange: StatusChangeHandler
) {
  const [mode, setMode] = useState<Mode>("view");
  const [acting, setActing] = useState<BookingStatusAction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelReasonError, setCancelReasonError] = useState<string | null>(null);
  const [emailNotDelivered, setEmailNotDelivered] = useState(false);
  const [smsNotDelivered, setSmsNotDelivered] = useState(false);

  async function handleAction(action: BookingStatusAction) {
    if (acting) {
      return;
    }
    setActing(action);
    setError(null);
    try {
      await onStatusChange(booking.id, action);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError(
          extractBookingErrorDetail(err.body) ??
            "Couldn't update this appointment — please try again."
        );
      } else if (!(err instanceof ApiError && err.status === 401)) {
        setError("Couldn't update this appointment — please try again.");
      }
    } finally {
      setActing(null);
    }
  }

  function openConfirmCancel() {
    setError(null);
    setCancelReason("");
    setCancelReasonError(null);
    setMode("confirm-cancel");
  }

  function closeConfirmCancel() {
    setMode("view");
  }

  async function handleConfirmCancel() {
    if (acting) {
      return;
    }
    setActing("cancelled");
    setError(null);
    setCancelReasonError(null);
    try {
      const result = await onStatusChange(booking.id, "cancelled", cancelReason.trim());
      setMode("view");
      // `notification` is only present on a successful cancel; "not sent"
      // (rather than only `email_failed`) is the trigger so an unconfigured
      // mail backend also warns.
      if (result.notification && !result.notification.email_sent) {
        setEmailNotDelivered(true);
      }
      // SMS warns only on an attempted-and-failed send. `sms_attempted`
      // false means it was skipped (no phone/carrier on file) — expected,
      // not a delivery failure, so no warning.
      if (
        result.notification &&
        result.notification.sms_attempted &&
        !result.notification.sms_sent
      ) {
        setSmsNotDelivered(true);
      }
    } catch (err) {
      const fieldError =
        err instanceof ApiError && err.status === 400
          ? extractCancellationReasonError(err.body)
          : null;
      if (fieldError) {
        // Stay in the confirm step: the reason itself was rejected, so the
        // provider needs the textarea right there to fix it and retry.
        setCancelReasonError(fieldError);
      } else {
        setMode("view");
        if (err instanceof ApiError && err.status === 400) {
          setError(
            extractBookingErrorDetail(err.body) ??
              "Couldn't update this appointment — please try again."
          );
        } else if (!(err instanceof ApiError && err.status === 401)) {
          setError("Couldn't update this appointment — please try again.");
        }
      }
    } finally {
      setActing(null);
    }
  }

  return {
    mode,
    acting,
    error,
    cancelReason,
    setCancelReason,
    cancelReasonError,
    emailNotDelivered,
    smsNotDelivered,
    handleAction,
    openConfirmCancel,
    closeConfirmCancel,
    handleConfirmCancel,
  };
}
