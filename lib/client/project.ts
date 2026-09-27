"use client";

/**
 * Another project is a different world: other boards, documents, history,
 * people. Screens hold what they loaded, so after connecting or switching
 * the window loads afresh instead of patching the page and leaving one
 * project's data under another's name.
 */
export function openProject(href = "/"): void {
  window.location.assign(href);
}
