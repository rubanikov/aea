import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TextField } from "./TextField";

describe("TextField", () => {
  it("associates the label with the input via htmlFor/id", () => {
    render(<TextField label="Email" id="email" value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Email")).toBeInTheDocument();
  });

  it("shows an inline, specific error message tied to the input via aria-describedby", () => {
    render(
      <TextField
        label="Email"
        id="email"
        value=""
        onChange={() => {}}
        error="Enter a valid email address"
      />
    );
    const input = screen.getByLabelText("Email");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a valid email address"
    );
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "email-error");
  });

  it("renders no error message when none is given", () => {
    render(<TextField label="Email" id="email" value="" onChange={() => {}} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
