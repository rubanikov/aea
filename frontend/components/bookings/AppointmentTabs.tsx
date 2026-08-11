"use client";

import { useRef, type KeyboardEvent } from "react";
import type { AppointmentTab } from "@/lib/bookings/types";

const TABS: readonly { id: AppointmentTab; label: string }[] = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
];

/** Shared with `PatientAppointments`, which renders the matching
 * `role="tabpanel"` these ids point at via `aria-controls`/`aria-labelledby`. */
export function tabButtonId(tab: AppointmentTab): string {
  return `appointments-tab-${tab}`;
}

export function tabPanelId(tab: AppointmentTab): string {
  return `appointments-panel-${tab}`;
}

interface AppointmentTabsProps {
  active: AppointmentTab;
  onChange: (tab: AppointmentTab) => void;
}

/**
 * The Upcoming/Past/Cancelled tab strip: a real `role="tablist"`/
 * `role="tab"` pair with roving `tabIndex` and arrow-key switching
 * (Left/Right cycle, Home/End jump to the ends), matching the WAI-ARIA
 * tabs pattern. `AuthPageClient`'s login/signup switcher uses a different
 * pattern for a different job, a `role="group"` of `aria-pressed` buttons
 * for two mutually exclusive forms, not three views over one
 * already-loaded list.
 */
export function AppointmentTabs({ active, onChange }: AppointmentTabsProps) {
  const tabRefs = useRef<Partial<Record<AppointmentTab, HTMLButtonElement | null>>>({});

  function selectAndFocus(tab: AppointmentTab) {
    onChange(tab);
    tabRefs.current[tab]?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = TABS.findIndex((tab) => tab.id === active);
    if (event.key === "ArrowRight") {
      event.preventDefault();
      selectAndFocus(TABS[(index + 1) % TABS.length].id);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      selectAndFocus(TABS[(index - 1 + TABS.length) % TABS.length].id);
    } else if (event.key === "Home") {
      event.preventDefault();
      selectAndFocus(TABS[0].id);
    } else if (event.key === "End") {
      event.preventDefault();
      selectAndFocus(TABS[TABS.length - 1].id);
    }
  }

  return (
    <div
      role="tablist"
      aria-label="Appointments"
      onKeyDown={handleKeyDown}
      className="flex gap-4 border-b border-gray-200"
    >
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={tabButtonId(tab.id)}
            aria-selected={selected}
            aria-controls={tabPanelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            ref={(element) => {
              tabRefs.current[tab.id] = element;
            }}
            onClick={() => onChange(tab.id)}
            className={`-mb-px border-b-2 px-1 py-2 text-sm font-medium ${
              selected
                ? "border-black text-black"
                : "border-transparent text-gray-500 hover:text-black"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
