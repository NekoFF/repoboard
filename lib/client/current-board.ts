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

/**
 * `boards` are the hrefs of the project's boards now: a board that was
 * archived, or one of another project, is not offered.
 */
export function newCardHref(boards?: string[]): string {
  const target = boards && !boards.includes(current) ? "/board" : current;
  return `${target}?new=1`;
}
