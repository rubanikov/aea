import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AuditLogTable } from "./AuditLogTable";
import type { AuditLogEntry } from "@/lib/audit/types";

const ENTRIES: AuditLogEntry[] = [
  {
    id: "a1",
    actor: "7",
    action: "status:confirmed->completed",
    target_type: "appointment",
    target_id: "apt-42",
    timestamp: "2026-08-10T14:32:07.000Z",
  },
  {
    id: "a2",
    actor: null,
    action: "created",
    target_type: "availability",
    target_id: "av-7",
    timestamp: "2026-08-09T09:00:00.000Z",
  },
];

describe("AuditLogTable", () => {
  it("renders real table markup with scoped column headers", () => {
    render(<AuditLogTable entries={ENTRIES} />);

    const table = screen.getByRole("table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent)).toEqual([
      "Timestamp (UTC)",
      "Actor",
      "Action",
      "Target",
    ]);
  });

  it("renders one row per entry, with the timestamp formatted as explicit UTC", () => {
    render(<AuditLogTable entries={ENTRIES} />);

    // header row + 2 data rows
    expect(screen.getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("2026-08-10 14:32:07Z")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("status:confirmed->completed")).toBeInTheDocument();
    expect(screen.getByText("appointment #apt-42")).toBeInTheDocument();
  });

  it("renders a null actor (a system-initiated entry) as 'System', not blank", () => {
    render(<AuditLogTable entries={ENTRIES} />);

    expect(screen.getByText("System")).toBeInTheDocument();
  });
});
