import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AuditLogPagination } from "./AuditLogPagination";

describe("AuditLogPagination", () => {
  it("shows the page count and the showing range", () => {
    render(
      <AuditLogPagination
        page={2}
        totalPages={5}
        rangeStart={21}
        rangeEnd={40}
        totalCount={97}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />
    );

    expect(screen.getByText("Page 2 of 5")).toBeInTheDocument();
    expect(screen.getByText(/showing 21.*40 of 97/i)).toBeInTheDocument();
  });

  it("shows 0 of 0 when there's no data", () => {
    render(
      <AuditLogPagination
        page={1}
        totalPages={1}
        rangeStart={1}
        rangeEnd={1}
        totalCount={0}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />
    );

    expect(screen.getByText(/showing 0.*0 of 0/i)).toBeInTheDocument();
  });

  it("disables Previous on the first page and calls onNext from a real, labeled button", async () => {
    const onNext = vi.fn();
    const user = userEvent.setup();
    render(
      <AuditLogPagination
        page={1}
        totalPages={3}
        rangeStart={1}
        rangeEnd={20}
        totalCount={50}
        onPrevious={vi.fn()}
        onNext={onNext}
      />
    );

    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
    const nextButton = screen.getByRole("button", { name: /next page/i });
    expect(nextButton).toBeEnabled();

    await user.click(nextButton);
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it("disables Next on the last page", () => {
    render(
      <AuditLogPagination
        page={3}
        totalPages={3}
        rangeStart={41}
        rangeEnd={50}
        totalCount={50}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
      />
    );

    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /previous page/i })).toBeEnabled();
  });

  it("disables both buttons when disabled is set, regardless of page position", () => {
    render(
      <AuditLogPagination
        page={2}
        totalPages={3}
        rangeStart={21}
        rangeEnd={40}
        totalCount={50}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        disabled
      />
    );

    expect(screen.getByRole("button", { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
  });
});
