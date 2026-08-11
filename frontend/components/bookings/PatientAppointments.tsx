"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { useAuthenticatedRequest } from "@/hooks/use-authenticated-request";
import { usePatientTimeZone } from "@/hooks/use-patient-timezone";
import { ApiError } from "@/lib/api/client";
import { classifyAppointmentTab } from "@/lib/bookings/status";
import type { AppointmentTab, BookingStatus, PatientBooking } from "@/lib/bookings/types";
import { AppointmentCard } from "./AppointmentCard";
import { AppointmentTabs, tabButtonId, tabPanelId } from "./AppointmentTabs";

const BOOKINGS_MINE_PATH = "/bookings/mine";

const EMPTY_TAB_MESSAGE: Record<AppointmentTab, string> = {
  upcoming: "No upcoming appointments.",
  past: "No past appointments.",
  cancelled: "No cancelled appointments.",
};

/**
 * Patient's own appointment list: Upcoming/Past/Cancelled tabs over one
 * fetched list, plus the cancel action per card.
 *
 * `GET /bookings` explicitly 403s a patient caller (see `PatientBooking`'s
 * docstring, `lib/bookings/types.ts`), so this screen calls
 * `GET /bookings/mine` instead.
 *
 * Tabs are derived client-side from this one fetched list
 * (`classifyAppointmentTab`) rather than three separate requests, since a
 * demo-sized patient appointment list doesn't justify the extra round
 * trips.
 *
 * The patient's own timezone comes from `usePatientTimeZone`
 * (browser-detected), the same convention `SlotBrowser`/`BookingFlow`
 * already use, not a second, competing "read the stored profile timezone"
 * convention. Its brief `null` (pre-hydration) window is treated as part
 * of the loading state, same as `BookingFlow` does.
 *
 * `PATCH /bookings/:id/cancel` matches path/method/error shape, but its
 * success response is `BookingSerializer`'s canonical shape (`{id,
 * provider_id, patient_id, appointment_type_id, start_time, end_time,
 * status}`); display names like `provider_name` aren't in it.
 * `handleCancel` below only reads `.status` off that response and merges
 * it onto the already-known local booking, rather than replacing the row
 * outright, so the card doesn't lose its provider/appointment-type name
 * on cancel.
 *
 * Reschedule (`RescheduleDialog`, launched from `AppointmentCard`) reacts
 * differently on success: `refetchBookings` below does a plain
 * `GET /bookings/mine` refetch rather than a local merge. A reschedule
 * doesn't fit `handleCancel`'s single-row-`status`-flip merge shape: it
 * turns the old booking `cancelled` *and* creates a new one at the new
 * time, so a local patch would mean reconstructing a whole second
 * `PatientBooking` row from `RescheduleDialog`'s response by hand. A rarer
 * action than routine list loads, so the extra round trip is the honest
 * trade here.
 */
export function PatientAppointments() {
  const authFetch = useAuthenticatedRequest();
  const timezone = usePatientTimeZone();

  const [bookings, setBookings] = useState<PatientBooking[] | null>(null); // null = loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeTab, setActiveTab] = useState<AppointmentTab>("upcoming");

  useEffect(() => {
    let cancelled = false;

    authFetch<PatientBooking[]>(BOOKINGS_MINE_PATH)
      .then((result) => {
        if (!cancelled) {
          setBookings(result);
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        if (!(error instanceof ApiError && error.status === 401)) {
          setLoadError("Couldn't load your appointments — please try again.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [authFetch, reloadKey]);

  /** Bumps `reloadKey`, which the fetch effect above is keyed on, forcing a
   * fresh `GET /bookings/mine`. Used by the load-error "Try again" button
   * and as the reaction to a successful reschedule: the old booking is now
   * `cancelled` and a new one exists at the new time, a two-row change a
   * plain refetch handles more honestly than hand-merging locally (unlike
   * `handleCancel` below, which *does* merge in place: a single row's
   * `status` flip is a much smaller, safer surface for a local patch than
   * a reschedule's "one row disappears, a different one appears" shape). */
  function refetchBookings() {
    setBookings(null);
    setReloadKey((key) => key + 1);
  }

  function retry() {
    setLoadError(null);
    refetchBookings();
  }

  async function handleCancel(id: number): Promise<void> {
    const response = await authFetch<{ status: BookingStatus }>(`/bookings/${id}/cancel`, {
      method: "PATCH",
    });
    setBookings((current) =>
      (current ?? []).map((booking) =>
        booking.id === id ? { ...booking, status: response.status } : booking
      )
    );
  }

  let body: ReactNode;

  if (loadError) {
    body = (
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
    );
  } else if (!timezone || bookings === null) {
    body = <p className="text-sm text-gray-600">Loading your appointments…</p>;
  } else if (bookings.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-3 rounded border border-dashed border-gray-300 p-10 text-center">
        <span aria-hidden="true" className="text-3xl">
          🗓
        </span>
        <p className="max-w-sm text-sm text-gray-600">
          You don&apos;t have any appointments yet. Book your first visit with a
          provider in seconds.
        </p>
        <Link
          href="/patient"
          className="rounded bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          Find a provider
        </Link>
      </div>
    );
  } else {
    const now = new Date();
    const grouped: Record<AppointmentTab, PatientBooking[]> = {
      upcoming: [],
      past: [],
      cancelled: [],
    };
    for (const booking of bookings) {
      grouped[classifyAppointmentTab(booking, now)].push(booking);
    }
    const visible = grouped[activeTab];

    body = (
      <div className="flex flex-col gap-4">
        <AppointmentTabs active={activeTab} onChange={setActiveTab} />
        <div
          role="tabpanel"
          id={tabPanelId(activeTab)}
          aria-labelledby={tabButtonId(activeTab)}
          tabIndex={0}
        >
          {visible.length === 0 ? (
            <p className="text-sm text-gray-600">{EMPTY_TAB_MESSAGE[activeTab]}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {visible.map((booking) => (
                <AppointmentCard
                  key={booking.id}
                  booking={booking}
                  timezone={timezone}
                  onCancel={handleCancel}
                  onRescheduled={refetchBookings}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  return <div className="flex flex-col gap-6">{body}</div>;
}
