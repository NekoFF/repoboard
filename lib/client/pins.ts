"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * What a person pins to the tool rail — a board, a card, a document — for
 * one press from anywhere. Kept on this computer, per project, like the
 * other conveniences (it is no one else's business which board you pin).
 */
export interface Pin {
  kind: "board" | "card" | "doc";
  /** Board id, card id or RB-n, or the document's path. */
  id: string;
  href: string;
  label: string;
}

const EVENT = "rb-pins";
const key = (repo: string) => `rb-pins:${repo.toLowerCase()}`;

function read(repo: string | null): Pin[] {
  if (!repo) return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(key(repo)) ?? "[]");
    return Array.isArray(raw) ? raw.filter((p) => p && typeof p.href === "string" && typeof p.label === "string") : [];
  } catch {
    return [];
  }
}

function write(repo: string, pins: Pin[]) {
  try {
    window.localStorage.setItem(key(repo), JSON.stringify(pins));
  } catch {
    // Private windows may refuse; the pins then last until the page closes.
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: repo }));
}

export const MAX_PINS = 8;

export function usePins(repo: string | null) {
  const [pins, setPins] = useState<Pin[]>([]);

  useEffect(() => {
    setPins(read(repo));
    const update = () => setPins(read(repo));
    window.addEventListener(EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, [repo]);

  const pin = useCallback(
    (next: Pin) => {
      if (!repo) return;
      const list = read(repo).filter((p) => p.href !== next.href);
      write(repo, [...list, next].slice(-MAX_PINS));
    },
    [repo],
  );
  const unpin = useCallback(
    (href: string) => {
      if (!repo) return;
      write(repo, read(repo).filter((p) => p.href !== href));
    },
    [repo],
  );
  const move = useCallback(
    (href: string, by: -1 | 1) => {
      if (!repo) return;
      const list = read(repo);
      const i = list.findIndex((p) => p.href === href);
      const j = i + by;
      if (i < 0 || j < 0 || j >= list.length) return;
      [list[i], list[j]] = [list[j], list[i]];
      write(repo, list);
    },
    [repo],
  );

  return { pins, pin, unpin, move, full: pins.length >= MAX_PINS };
}
