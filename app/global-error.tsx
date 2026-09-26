"use client";

import "./globals.css";
import { ErrorScreen } from "@/components/connect/ErrorScreen";

/** When even the frame of the app fails: the same way out, without the app around it. */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body>
        <ErrorScreen
          title="RepoBoard did not start"
          body="Something went wrong while opening the app. Nothing was lost — try again."
          detail={error.message || error.digest}
        />
      </body>
    </html>
  );
}
