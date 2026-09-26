"use client";

import { useEffect, useRef } from "react";

/** True while focus is somewhere that owns its keystrokes. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.isContentEditable ||
    Boolean(el.closest?.("[cmdk-root]"))
  );
}

/** A dialog, sheet or menu is open, so page-level shortcuts should stand down. */
export function overlayOpen(): boolean {
  return Boolean(
    document.querySelector('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper]'),
  );
}

type Handler = (event: KeyboardEvent) => void;

// Shared by every useHotkeys instance: while one of them is in the middle of
// "g …", the others must not treat the second key as their own shortcut
// (on the board, "g c" would otherwise also create a card).
let sequenceUntil = 0;

/**
 * Single-key and two-key ("g b") shortcuts. They never fire while typing or
 * with a modifier held, so they cannot fight the browser or a text field.
 * Bindings with a modifier ("mod+k") are matched explicitly.
 */
export function useHotkeys(
  bindings: Record<string, Handler>,
  options: { enabled?: boolean; allowInOverlay?: boolean } = {},
) {
  const { enabled = true, allowInOverlay = false } = options;
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    let pending: string | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const onKey = (event: KeyboardEvent) => {
      const map = ref.current;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const mod = event.metaKey || event.ctrlKey;

      if (mod) {
        const combo = `mod+${key}`;
        if (map[combo]) {
          event.preventDefault();
          map[combo](event);
        }
        return;
      }
      if (event.altKey || isTyping(event.target)) return;
      if (!allowInOverlay && overlayOpen()) return;

      if (pending) {
        const combo = `${pending} ${key}`;
        pending = null;
        clearTimeout(timer);
        if (map[combo]) {
          event.preventDefault();
          map[combo](event);
          return;
        }
      } else if (Date.now() < sequenceUntil) {
        return;
      }
      const starts = Object.keys(map).some((k) => k.startsWith(`${key} `));
      if (starts) {
        pending = key;
        sequenceUntil = Date.now() + 900;
        timer = setTimeout(() => (pending = null), 900);
        event.preventDefault();
        return;
      }
      const name = event.shiftKey && key === "?" ? "?" : key;
      if (map[name]) {
        event.preventDefault();
        map[name](event);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [enabled, allowInOverlay]);
}

/** Pressing the key shown next to an action, rendered for the current OS. */
export function modKey(): string {
  if (typeof navigator === "undefined") return "Ctrl";
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}
