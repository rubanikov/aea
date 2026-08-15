"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
}

interface FocusTrapOptions {
  /** The control that opened the dialog; focus returns here on unmount
   * (only if it's still in the document). */
  triggerElement: HTMLElement | null;
  /** Called on Escape, after the event has been stopped from propagating.
   * Each dialog decides for itself whether Esc may close it (e.g. not
   * mid-submit), so that decision lives in the callback, not here. */
  onEscape: () => void;
}

interface FocusTrap<T extends HTMLElement> {
  ref: RefObject<T | null>;
  onKeyDown: (event: KeyboardEvent<T>) => void;
}

/**
 * The modal focus-trap pattern shared by `RescheduleDialog` and
 * `CollisionWarningModal`: focus moves onto the container on mount,
 * Tab/Shift+Tab wrap within the container's own focusable elements, Esc is
 * handed to `onEscape`, and focus returns to `triggerElement` on unmount.
 * Attach `ref` and `onKeyDown` to the `role="dialog"`/`"alertdialog"`
 * element (which needs `tabIndex={-1}` so it can take the initial focus).
 */
export function useFocusTrap<T extends HTMLElement>({
  triggerElement,
  onEscape,
}: FocusTrapOptions): FocusTrap<T> {
  const ref = useRef<T>(null);
  // Kept in a ref, updated post-render, so the mount/unmount focus-restore
  // effect below can stay a one-time `[]` effect.
  const triggerElementRef = useRef(triggerElement);

  useEffect(() => {
    triggerElementRef.current = triggerElement;
  }, [triggerElement]);

  useEffect(() => {
    ref.current?.focus();
    return () => {
      const trigger = triggerElementRef.current;
      if (trigger && document.contains(trigger)) {
        trigger.focus();
      }
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<T>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const container = ref.current;
    if (!container) {
      return;
    }
    const focusable = focusableElements(container);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (event.shiftKey) {
      if (active === first || !container.contains(active)) {
        event.preventDefault();
        last.focus();
      }
    } else if (active === last || !container.contains(active)) {
      event.preventDefault();
      first.focus();
    }
  }

  return { ref, onKeyDown };
}
