"use client";

import type { ReactNode } from "react";
import { PixelSky } from "@/components/connect/PixelSky";

/**
 * The app itself, out of focus: sidebar, panel, a board's columns — drawn as
 * shapes, blurred, so a screen shown before any project is open still sits on
 * top of the window it leads into.
 */
function GhostShell() {
  const line = (w: string) => <span className="block h-2.5 rounded-full bg-ink/[0.16]" style={{ width: w }} />;
  return (
    <div className="rb-desk pointer-events-none absolute inset-0 flex gap-0 p-3 md:pt-3" aria-hidden>
      <div className="rb-glass hidden w-[268px] shrink-0 flex-col gap-4 rounded-[18px] p-4 pr-[64px] md:flex">
        <span className="flex items-center gap-2.5">
          <span className="size-6 rounded-md bg-accent/60" />
          {line("60%")}
        </span>
        <span className="h-8 rounded-lg bg-ink/[0.08]" />
        {["52%", "64%", "48%", "58%", "44%", "54%"].map((w, i) => (
          <span key={i} className="flex items-center gap-2.5">
            <span className="size-4 rounded bg-ink/[0.14]" />
            {line(w)}
          </span>
        ))}
      </div>
      <div className="relative -ml-[60px] flex flex-1 flex-col gap-5 rounded-[18px] bg-surface p-8">
        {line("22%")}
        <div className="mt-4 grid flex-1 grid-cols-3 gap-4">
          {[4, 3, 2].map((n, c) => (
            <div key={c} className="flex flex-col gap-3 rounded-xl bg-ink/[0.045] p-3">
              {line("40%")}
              {Array.from({ length: n }, (_, i) => (
                <span key={i} className="flex h-16 flex-col justify-center gap-2 rounded-lg bg-surface px-3 shadow-[0_0_0_1px_rgb(var(--ink)/0.08),0_6px_14px_-10px_rgb(var(--shadow)/0.4)]">
                  {line(`${50 + ((i * 17 + c * 11) % 35)}%`)}
                  <span className="flex gap-1.5">
                    <span className="h-2 w-8 rounded-full bg-state-doing/40" />
                    <span className="h-2 w-6 rounded-full bg-accent/30" />
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The frame of the screens that stand before the app: first start, adding a
 * project, a project that no longer opens. A banner card with a living sky
 * floats above the card that does the work; both cast a soft glow.
 */
export function StartFrame({ children, banner }: { children: ReactNode; banner?: ReactNode }) {
  return (
    <div className="fixed inset-0 z-[40] overflow-y-auto">
      <GhostShell />
      <div className="rb-start-veil absolute inset-0" aria-hidden />
      {/* In the desktop app: the window is dragged by its top strip here too. */}
      <div className="rb-desktop-titlebar" aria-hidden />
      <div className="relative flex min-h-full items-center justify-center px-4 py-14">
        <div className="rb-enter flex w-full max-w-[560px] flex-col gap-4">
          <div className="rb-start-banner relative h-[150px] overflow-hidden rounded-[22px]">
            <PixelSky />
            {banner && <div className="pointer-events-none absolute inset-0 flex items-end p-5">{banner}</div>}
          </div>
          <div className="rb-start-card rounded-[22px] p-7 sm:p-9">{children}</div>
        </div>
      </div>
    </div>
  );
}
