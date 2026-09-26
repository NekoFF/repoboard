"use client";

import { ErrorScreen } from "@/components/connect/ErrorScreen";

export default function PageError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <ErrorScreen
      title="This screen did not load"
      body="Something went wrong while opening it. Your boards and checklists are not affected."
      detail={error.message || error.digest}
      onRetry={() => {
        reset();
        window.location.reload();
      }}
    />
  );
}
