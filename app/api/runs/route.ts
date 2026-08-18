import { NextResponse } from "next/server";

import { getDatabase } from "../../lib/database.ts";
import { startLivePipeline } from "../../lib/pipeline-runner.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const icpId = Number(form.get("icpId"));
  const dashboardUrl = new URL("/", request.url);

  if (!Number.isInteger(icpId) || icpId < 1) {
    dashboardUrl.searchParams.set("error", "Choose a valid ICP before starting a run.");
    return NextResponse.redirect(dashboardUrl, 303);
  }

  const icp = getDatabase().getICP(icpId);
  if (!icp) {
    dashboardUrl.searchParams.set("error", `ICP ${icpId} was not found.`);
    return NextResponse.redirect(dashboardUrl, 303);
  }

  try {
    const runId = startLivePipeline(icp);
    return NextResponse.redirect(new URL(`/runs/${runId}?icp=${icpId}`, request.url), 303);
  } catch (error) {
    dashboardUrl.searchParams.set("icp", String(icpId));
    dashboardUrl.searchParams.set(
      "error",
      error instanceof Error ? error.message : "Could not start the pipeline.",
    );
    return NextResponse.redirect(dashboardUrl, 303);
  }
}
