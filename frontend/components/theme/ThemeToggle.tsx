"use client";

import type { Theme } from "@/lib/theme/theme";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme } from "./ThemeProvider";

const OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

/**
 * Three-way Light / Dark / System segmented control, wired to the
 * ThemeProvider. Built on shadcn/ui's ToggleGroup (Radix), which in
 * `type="single"` mode renders radiogroup/radio semantics with a roving
 * tabindex and arrow-key navigation. Selection follows focus (each item's
 * onFocus selects it), matching both radio-group convention and the
 * hand-rolled control this replaced.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <ToggleGroup
      type="single"
      value={theme}
      onValueChange={(value) => {
        // Radix reports "" when the pressed item is clicked again; a theme
        // control has no "no theme" state, so ignore the deselect.
        if (value) {
          setTheme(value as Theme);
        }
      }}
      aria-label="Theme"
      size="sm"
      className="gap-0.5 rounded-md border border-border bg-muted p-0.5"
    >
      {OPTIONS.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          onFocus={() => setTheme(option.value)}
          className="h-auto rounded px-2.5 py-1 text-xs font-medium text-muted-foreground first:rounded-l last:rounded-r hover:bg-transparent hover:text-foreground data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-sm"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
