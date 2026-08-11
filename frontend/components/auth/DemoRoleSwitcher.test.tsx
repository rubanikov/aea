import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { clearMockRole, readMockRole } from "@/lib/auth/mock-session";
import { DemoRoleSwitcher } from "./DemoRoleSwitcher";

const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

describe("DemoRoleSwitcher", () => {
  afterEach(() => {
    clearMockRole();
    pushMock.mockClear();
  });

  it("sets the mock session to patient and navigates to /patient", async () => {
    const user = userEvent.setup();
    render(<DemoRoleSwitcher />);

    await user.click(
      screen.getByRole("button", { name: /continue as patient/i })
    );

    expect(readMockRole()).toBe("patient");
    expect(pushMock).toHaveBeenCalledWith("/patient");
  });

  it("sets the mock session to provider and navigates to /provider", async () => {
    const user = userEvent.setup();
    render(<DemoRoleSwitcher />);

    await user.click(
      screen.getByRole("button", { name: /continue as provider/i })
    );

    expect(readMockRole()).toBe("provider");
    expect(pushMock).toHaveBeenCalledWith("/provider");
  });

  it("sets the mock session to admin and navigates to /admin", async () => {
    const user = userEvent.setup();
    render(<DemoRoleSwitcher />);

    await user.click(
      screen.getByRole("button", { name: /continue as admin/i })
    );

    expect(readMockRole()).toBe("admin");
    expect(pushMock).toHaveBeenCalledWith("/admin");
  });
});
