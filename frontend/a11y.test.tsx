import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { axe } from "vitest-axe";
import { LoginForm } from "@/components/auth/LoginForm";
import { AppointmentTypeForm } from "@/components/availability/AppointmentTypeForm";
import { ConfirmStep } from "@/components/booking/ConfirmStep";
import { SlotBlock } from "@/components/booking/SlotBlock";
import { TimeSlotGrid } from "@/components/booking/TimeSlotGrid";
import { PatientAppointments } from "@/components/bookings/PatientAppointments";
import type { PatientBooking } from "@/lib/bookings/types";
import type { Slot } from "@/lib/scheduling/types";

/**
 * Axe checks over the key booking-flow surfaces: the slot pickers, the
 * confirm step, the login form, and the patient appointment list. Each is
 * rendered with realistic props and asserted to produce zero violations.
 *
 * Companion to `theme-contrast.test.ts`, which already proves every
 * foreground/background token pairing meets WCAG AA — so axe's
 * `color-contrast` rule is disabled here (it couldn't run anyway: jsdom
 * computes no real styles). `region` is also disabled: these are component
 * fragments rendered without the page chrome that provides landmarks, so
 * "content must be in a landmark" would flag the harness, not the code.
 */
async function expectNoAxeViolations(container: HTMLElement) {
  const results = await axe(container, {
    rules: {
      "color-contrast": { enabled: false },
      region: { enabled: false },
    },
  });
  expect(results.violations).toEqual([]);
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const SCHEDULE_TIME_ZONE = "America/New_York";

const SLOTS: Slot[] = [
  { start: "2026-08-24T13:00:00.000Z", end: "2026-08-24T14:00:00.000Z" }, // 9:00am EDT
  { start: "2026-08-24T14:00:00.000Z", end: "2026-08-24T15:00:00.000Z" }, // 10:00am EDT
];

describe("booking-flow accessibility (axe)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("TimeSlotGrid has no axe violations", async () => {
    const { container } = render(
      <TimeSlotGrid
        slots={SLOTS}
        scheduleTimeZone={SCHEDULE_TIME_ZONE}
        viewerTimeZone="America/Chicago"
        selectedDateLabel="Monday, August 24, 2026"
        isToday={false}
        onSelectSlot={vi.fn()}
      />
    );

    await expectNoAxeViolations(container);
  });

  it("SlotBlock has no axe violations", async () => {
    // Same absolutely-positioned-in-a-relative-column setup the week grid
    // gives it (see `lib/calendar/layout.ts`'s BlockGeometry convention).
    const { container } = render(
      <div className="relative h-96">
        <SlotBlock
          slot={SLOTS[0]}
          scheduleTimeZone={SCHEDULE_TIME_ZONE}
          viewerTimeZone="America/Chicago"
          geometry={{
            topPercent: 25,
            heightPercent: 12.5,
            leftPercent: 0,
            widthPercent: 100,
          }}
          onSelect={vi.fn()}
        />
      </div>
    );

    await expectNoAxeViolations(container);
  });

  it("ConfirmStep's form view has no axe violations", async () => {
    const { container } = render(
      <ConfirmStep
        provider={{ id: 1, name: "Dr. Amara Osei", timezone: SCHEDULE_TIME_ZONE }}
        appointmentType={{ id: 10, name: "Annual Physical", duration_minutes: 60 }}
        slot={SLOTS[0]}
        patientTimeZone="America/Chicago"
        onBooked={vi.fn()}
        onSlotUnavailable={vi.fn()}
        onStartOver={vi.fn()}
      />
    );

    await expectNoAxeViolations(container);
  });

  it("LoginForm has no axe violations", async () => {
    const { container } = render(<LoginForm />);

    await expectNoAxeViolations(container);
  });

  it("AppointmentTypeForm (with the slot-length radio group) has no axe violations", async () => {
    const { container } = render(
      <AppointmentTypeForm
        idPrefix="a11y-appointment-type"
        name="Follow-up"
        onNameChange={vi.fn()}
        duration={30}
        onDurationChange={vi.fn()}
        saving={false}
        submitLabel="Save"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    await expectNoAxeViolations(container);
  });
});

// "Now" for the appointment list: Wed, Aug 12 2026, 09:00 UTC, so the
// fixtures below classify deterministically as upcoming/past/cancelled.
// jsdom's detected timezone defaults to UTC, matching provider_timezone.
const NOW = new Date("2026-08-12T09:00:00.000Z");

const BOOKINGS: PatientBooking[] = [
  {
    id: 1,
    provider_id: 10,
    provider_name: "Dr. Amara Osei",
    provider_timezone: "UTC",
    appointment_type_id: 20,
    appointment_type_name: "Annual Physical",
    start_time: "2026-08-18T15:00:00.000Z",
    end_time: "2026-08-18T16:00:00.000Z",
    status: "confirmed",
    reminder_sent: false,
    cancellation_reason: "",
  },
  {
    id: 2,
    provider_id: 11,
    provider_name: "Dr. Renata Silva",
    provider_timezone: "UTC",
    appointment_type_id: 21,
    appointment_type_name: "Follow-up",
    start_time: "2026-08-01T13:00:00.000Z",
    end_time: "2026-08-01T14:00:00.000Z",
    status: "completed",
    reminder_sent: true,
    cancellation_reason: "",
  },
];

describe("PatientAppointments accessibility (axe)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("has no axe violations once the tabbed list has loaded", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const path = new URL(url).pathname;
        if (path === "/bookings/mine") {
          return Promise.resolve(
            new Response(JSON.stringify(BOOKINGS), { status: 200 })
          );
        }
        throw new Error(`Unhandled fetch in test: ${path}`);
      })
    );

    const { container } = render(<PatientAppointments />);
    await screen.findByText(/Dr\. Amara Osei/);

    await expectNoAxeViolations(container);
  });
});
