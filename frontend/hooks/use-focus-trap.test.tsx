import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFocusTrap } from "./use-focus-trap";

function TrappedDialog({
  triggerElement,
  onEscape,
}: {
  triggerElement: HTMLElement | null;
  onEscape: () => void;
}) {
  const { ref, onKeyDown } = useFocusTrap<HTMLDivElement>({ triggerElement, onEscape });
  return (
    <div ref={ref} role="dialog" aria-label="Trapped" tabIndex={-1} onKeyDown={onKeyDown}>
      <button type="button">First</button>
      <button type="button">Middle</button>
      <button type="button">Last</button>
    </div>
  );
}

function renderTrap({
  triggerElement = null,
  onEscape = vi.fn(),
}: { triggerElement?: HTMLElement | null; onEscape?: () => void } = {}) {
  return render(<TrappedDialog triggerElement={triggerElement} onEscape={onEscape} />);
}

describe("useFocusTrap", () => {
  it("moves focus onto the container on mount", () => {
    renderTrap();
    expect(screen.getByRole("dialog")).toHaveFocus();
  });

  it("wraps Tab from the last focusable element back to the first", async () => {
    const user = userEvent.setup();
    renderTrap();
    screen.getByRole("button", { name: "Last" }).focus();

    await user.keyboard("{Tab}");

    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("wraps Shift+Tab from the first focusable element to the last", async () => {
    const user = userEvent.setup();
    renderTrap();
    screen.getByRole("button", { name: "First" }).focus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
  });

  it("Tab from the container itself lands on the first focusable element", async () => {
    const user = userEvent.setup();
    renderTrap();
    expect(screen.getByRole("dialog")).toHaveFocus();

    await user.keyboard("{Tab}");

    expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
  });

  it("calls onEscape on Escape", async () => {
    const user = userEvent.setup();
    const onEscape = vi.fn();
    renderTrap({ onEscape });

    await user.keyboard("{Escape}");

    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("returns focus to the trigger element on unmount", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const { unmount } = renderTrap({ triggerElement: trigger });
    expect(screen.getByRole("dialog")).toHaveFocus();

    unmount();

    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("does not restore focus to a trigger that has left the document", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    const focusSpy = vi.spyOn(trigger, "focus");
    const { unmount } = renderTrap({ triggerElement: trigger });
    trigger.remove();

    unmount();

    expect(focusSpy).not.toHaveBeenCalled();
  });
});
