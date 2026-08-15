"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Route-level error boundary: what renders in place of a segment whose
 * render or data fetch threw, instead of Next's default unstyled screen.
 *
 * The raw error is deliberately never rendered — in production Next only
 * forwards a generic message for server errors precisely so nothing
 * sensitive (PHI included) leaks, and this component keeps the same
 * guarantee for client errors. There's no `console.error` either: this
 * codebase keeps runtime console output at zero, and `error.digest` —
 * Next's hash of the thrown error, shown below as a support reference —
 * is already the handle that matches the server-side logs.
 *
 * `retry()` (stable as of Next 16.3, preferred over `reset()`) re-fetches
 * and re-renders the failed segment, the right recovery for the transient
 * fetch failures this boundary most often catches.
 */
export default function RouteError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-1 flex-col items-start justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">
        Something went wrong
      </h1>
      <p className="text-sm text-muted-foreground">
        An unexpected error interrupted this page. It may be temporary —
        trying again usually fixes it.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          Support reference: <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-4">
        <Button onClick={retry}>Try again</Button>
        <Link href="/" className="text-sm underline">
          Back to home
        </Link>
      </div>
    </div>
  );
}
