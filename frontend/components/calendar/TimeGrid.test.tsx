import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { TimeGrid } from "./TimeGrid";

const DAYS = [
  "2026-08-17",
  "2026-08-18",
  "2026-08-19",
  "2026-08-20",
  "2026-08-21",
  "2026-08-22",
  "2026-08-23",
];
const RANGE = { startHour: 9, endHour: 17 };

// 10:00am–12:00pm ET on the visible Tuesday.
const HOLD = {
  id: 1,
  label: "Lunch",
  start: "2026-08-18T14:00:00.000Z",
  end: "2026-08-18T16:00:00.000Z",
};

function renderGrid(extra?: Partial<Parameters<typeof TimeGrid>[0]>) {
  return render(
    <TimeGrid
      days={DAYS}
      todayKey="2026-08-18"
      range={RANGE}
      renderDay={(dayKey) => <span data-testid={`day-${dayKey}`} />}
      {...extra}
    />
  );
}

describe("TimeGrid blockedTimes prop", () => {
  it("renders byte-identically with the prop omitted vs. an empty list, with no hatch artifacts (guards the slot-picker reuse)", () => {
    // The patient booking wizard reuses TimeGrid WITHOUT this prop; its
    // output must be unaffected by ticket 04.
    const without = renderGrid();
    const withoutHtml = without.container.innerHTML;
    without.unmount();

    const withEmpty = renderGrid({ blockedTimes: [], timezone: "America/New_York" });

    expect(withEmpty.container.innerHTML).toBe(withoutHtml);
    expect(withoutHtml).not.toContain("hatch-unavailable");
    expect(withoutHtml).not.toContain("Blocked");
  });

  it("hatches a provided blocked range beneath the day's own content, keeping renderDay output intact", () => {
    const { container, getByTestId, getByText } = renderGrid({
      blockedTimes: [HOLD],
      timezone: "America/New_York",
    });

    const hatch = container.querySelector<HTMLElement>(".hatch-unavailable");
    expect(hatch).not.toBeNull();
    expect(hatch).toHaveAttribute("aria-hidden", "true");
    // Beneath = earlier in DOM order than the day's positioned blocks
    // within the same column (later absolutely-positioned siblings paint
    // on top), and never click-intercepting.
    const dayContent = getByTestId("day-2026-08-18");
    expect(
      hatch!.compareDocumentPosition(dayContent) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(hatch).toHaveClass("pointer-events-none");
    expect(getByText("Blocked: Lunch, 10:00am–12:00pm")).toBeInTheDocument();
  });
});
