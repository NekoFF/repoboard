"use client";

import { ArrowLeft, Home } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/ui";

/** Inside the app: a page that does not exist, with the way back. */
export function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-sm flex-col items-center text-center">
        <EmptyState title="There is no such page" body="The link may be old, or the card or board was deleted." />
        <div className="mt-4 flex gap-2">
          <button type="button" className="rb-btn" onClick={() => window.history.back()}>
            <ArrowLeft className="size-3.5" /> Back
          </button>
          <Link href="/" className="rb-btn-primary">
            <Home className="size-3.5" /> Overview
          </Link>
        </div>
      </div>
    </div>
  );
}
