import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditLogFilters } from "./AuditLogFilters";
import { EMPTY_AUDIT_LOG_FILTERS } from "@/lib/audit/types";

describe("AuditLogFilters", () => {
  it("renders a labeled field for each filter, grouped under a fieldset legend", () => {
    render(
      <AuditLogFilters
        values={EMPTY_AUDIT_LOG_FILTERS}
        onChange={vi.fn()}
        onApply={vi.fn()}
      />
    );

    expect(
      screen.getByRole("group", { name: /filter audit log/i })
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Actor (user ID)")).toBeInTheDocument();
    expect(screen.getByLabelText("Action")).toBeInTheDocument();
    expect(screen.getByLabelText("Target type")).toBeInTheDocument();
    expect(screen.getByLabelText("From date")).toBeInTheDocument();
    expect(screen.getByLabelText("To date")).toBeInTheDocument();
  });

  it("calls onChange as the user types, without calling onApply", async () => {
    const onChange = vi.fn();
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <AuditLogFilters
        values={EMPTY_AUDIT_LOG_FILTERS}
        onChange={onChange}
        onApply={onApply}
      />
    );

    await user.type(screen.getByLabelText("Actor (user ID)"), "7");

    expect(onChange).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it("calls onApply only when the Apply button is submitted", async () => {
    const onApply = vi.fn();
    const user = userEvent.setup();
    render(
      <AuditLogFilters
        values={{ ...EMPTY_AUDIT_LOG_FILTERS, actor: "7" }}
        onChange={vi.fn()}
        onApply={onApply}
      />
    );

    await user.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it("disables every field while disabled is set", () => {
    render(
      <AuditLogFilters
        values={EMPTY_AUDIT_LOG_FILTERS}
        onChange={vi.fn()}
        onApply={vi.fn()}
        disabled
      />
    );

    expect(screen.getByLabelText("Actor (user ID)")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });
});
