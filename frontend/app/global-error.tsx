"use client"; // Error boundaries must be Client Components

import Link from "next/link";
import { Geist } from "next/font/google";
import { Button } from "@/components/ui/button";
import { PRE_PAINT_THEME_SCRIPT } from "@/lib/theme/theme";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

/**
 * Root-level error boundary: replaces the entire root layout when the
 * layout itself (or something above every segment boundary) throws, so it
 * must render its own `<html>`/`<body>` and re-import the global styles,
 * font, and pre-paint theme script that `app/layout.tsx` normally
 * provides — Next does not include any of them here.
 *
 * Same privacy stance as `app/error.tsx`: the raw error is never
 * rendered and nothing is written to the console (this codebase keeps
 * runtime console output at zero); `error.digest` is shown as the support
 * reference that matches the server-side logs.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    // suppressHydrationWarning: the pre-paint script below adds/removes
    // the `dark` class on <html> before React hydrates, same as the root
    // layout (see app/layout.tsx).
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} h-full antialiased`}
    >
      <head>
        <title>Something went wrong</title>
        <script dangerouslySetInnerHTML={{ __html: PRE_PAINT_THEME_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col">
        <div className="mx-auto flex max-w-md flex-1 flex-col items-start justify-center gap-4 px-6 py-16">
          <h1 className="text-2xl font-semibold tracking-tight">
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground">
            An unexpected error interrupted the app. It may be temporary —
            trying again usually fixes it.
          </p>
          {error.digest ? (
            <p className="text-xs text-muted-foreground">
              Support reference:{" "}
              <span className="font-mono">{error.digest}</span>
            </p>
          ) : null}
          <div className="flex items-center gap-4">
            <Button onClick={retry}>Try again</Button>
            <Link href="/" className="text-sm underline">
              Back to home
            </Link>
          </div>
        </div>
      </body>
    </html>
  );
}
