"use client";

/**
 * The board the person is working on: the one open now, or the last one they
 * opened. "New card" from the tool rail or the command menu goes there instead
 * of always to the main board.
 */
let current = "/board";

export function setCurrentBoard(href: string): void {
  current = href;
}

export function newCardHref(): string {
  return `${current}?new=1`;
}
