import { notFound } from "next/navigation";

import { Dashboard } from "../../components/dashboard.tsx";
import { getDatabase } from "../../lib/database.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PageProps = {
  params: Promise<{ runId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function RunPage({ params, searchParams }: PageProps) {
  const { runId: rawRunId } = await params;
  const runId = Number(rawRunId);
  if (!Number.isInteger(runId) || runId < 1 || !getDatabase().getRun(runId)) notFound();

  const query = await searchParams;
  const rawICP = Array.isArray(query.icp) ? query.icp[0] : query.icp;
  const icpId = Number(rawICP);

  return (
    <Dashboard
      selectedRunId={runId}
      requestedICPId={Number.isInteger(icpId) && icpId > 0 ? icpId : undefined}
      error={Array.isArray(query.error) ? query.error[0] : query.error}
    />
  );
}
