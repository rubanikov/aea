import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RouteError from "./error";

/** What Next actually hands the boundary: a real Error, plus `digest` for
 * server-thrown errors (absent for pure client-side render failures). */
function makeError(digest?: string): Error & { digest?: string } {
  const error: Error & { digest?: string } = new Error(
    "raw internal detail that must never render"
  );
  if (digest) {
    error.digest = digest;
  }
  return error;
}

describe("RouteError", () => {
  it("shows the designed fallback with the digest as a support reference, never the raw error", () => {
    render(<RouteError error={makeError("digest-abc123")} retry={vi.fn()} />);

    expect(
      screen.getByRole("heading", { name: "Something went wrong" })
    ).toBeInTheDocument();
    expect(screen.getByText("digest-abc123")).toBeInTheDocument();
    expect(
      screen.queryByText(/raw internal detail/)
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to home" })).toHaveAttribute(
      "href",
      "/"
    );
  });

  it("omits the support reference line when the error has no digest", () => {
    render(<RouteError error={makeError()} retry={vi.fn()} />);

    expect(screen.queryByText(/support reference/i)).not.toBeInTheDocument();
  });

  it("re-renders the failed segment via retry() on 'Try again'", async () => {
    const retry = vi.fn();
    const user = userEvent.setup();
    render(<RouteError error={makeError("digest-abc123")} retry={retry} />);

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(retry).toHaveBeenCalledTimes(1);
  });
});
