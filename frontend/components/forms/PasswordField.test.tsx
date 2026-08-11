import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordField } from "./PasswordField";

describe("PasswordField", () => {
  it("starts masked (type=password) with the toggle unpressed", () => {
    render(
      <PasswordField label="Password" id="password" value="" onChange={() => {}} />
    );
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "type",
      "password"
    );
    expect(screen.getByRole("button", { name: /show password/i })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
  });

  it("reveals the password and flips aria-pressed when the toggle is clicked", async () => {
    const user = userEvent.setup();
    render(
      <PasswordField label="Password" id="password" value="" onChange={() => {}} />
    );

    await user.click(screen.getByRole("button", { name: /show password/i }));

    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: /hide password/i })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });

  it("gives distinct accessible names to multiple password fields on one form", () => {
    render(
      <>
        <PasswordField
          label="New password"
          id="new-password"
          value=""
          onChange={() => {}}
        />
        <PasswordField
          label="Confirm password"
          id="confirm-password"
          value=""
          onChange={() => {}}
        />
      </>
    );
    expect(
      screen.getByRole("button", { name: /show new password/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show confirm password/i })
    ).toBeInTheDocument();
  });

  it("shows an inline error message", () => {
    render(
      <PasswordField
        label="Password"
        id="password"
        value=""
        onChange={() => {}}
        error="Password is required"
      />
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Password is required"
    );
  });
});
