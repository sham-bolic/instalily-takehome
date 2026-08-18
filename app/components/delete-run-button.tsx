"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function DeleteRunButton({ runId }: { runId: number }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteRun() {
    const confirmed = window.confirm(
      `Delete run #${runId}? This permanently removes its artifacts and company profiles.`,
    );
    if (!confirmed) return;

    setDeleting(true);
    setError(null);

    try {
      const form = new FormData();
      form.set("deleteRunId", String(runId));
      const response = await fetch("/api/runs", { method: "POST", body: form });
      if (!response.ok) throw new Error("The run could not be deleted.");

      const destination = new URL(response.url);
      router.push(`${destination.pathname}${destination.search}`);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "The run could not be deleted.",
      );
      setDeleting(false);
    }
  }

  return (
    <div className="deleteRunAction">
      <button
        className="dangerButton"
        disabled={deleting}
        onClick={deleteRun}
        type="button"
      >
        {deleting ? "Deleting..." : "Delete run"}
      </button>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
