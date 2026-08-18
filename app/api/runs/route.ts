import { NextResponse } from "next/server";

import { getDatabase } from "../../lib/database.ts";
import {
  resumeLivePipeline,
  startLivePipeline,
  startLivePipelineForEvent,
} from "../../lib/pipeline-runner.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();
  const dashboardUrl = new URL("/", request.url);
  const deleteRunIdValue = form.get("deleteRunId");
  const resumeRunIdValue = form.get("resumeRunId");
  const eventRunIdValue = form.get("eventRunId");

  if (deleteRunIdValue !== null) {
    const deleteRunId = Number(deleteRunIdValue);
    if (!Number.isInteger(deleteRunId) || deleteRunId < 1) {
      dashboardUrl.searchParams.set("error", "Choose a valid run to delete.");
      return NextResponse.redirect(dashboardUrl, 303);
    }

    if (!getDatabase().deleteRun(deleteRunId)) {
      dashboardUrl.searchParams.set(
        "error",
        `Run ${deleteRunId} could not be deleted. It may still be running or no longer exist.`,
      );
    }
    return NextResponse.redirect(dashboardUrl, 303);
  }

  if (eventRunIdValue !== null) {
    const eventRunId = Number(eventRunIdValue);
    const eventName = form.get("eventName");
    const sourceRunUrl = new URL(`/runs/${eventRunId}?tab=events`, request.url);
    if (
      !Number.isInteger(eventRunId) ||
      eventRunId < 1 ||
      typeof eventName !== "string" ||
      !eventName.trim()
    ) {
      sourceRunUrl.searchParams.set("error", "Choose a valid event to enrich.");
      return NextResponse.redirect(sourceRunUrl, 303);
    }
    try {
      const runId = startLivePipelineForEvent(eventRunId, eventName);
      return NextResponse.redirect(
        new URL(`/runs/${runId}?tab=companies`, request.url),
        303,
      );
    } catch (error) {
      sourceRunUrl.searchParams.set(
        "error",
        error instanceof Error
          ? error.message
          : "Could not start enrichment for that event.",
      );
      return NextResponse.redirect(sourceRunUrl, 303);
    }
  }

  if (resumeRunIdValue !== null) {
    const resumeRunId = Number(resumeRunIdValue);
    if (!Number.isInteger(resumeRunId) || resumeRunId < 1) {
      dashboardUrl.searchParams.set("error", "Choose a valid run to resume.");
      return NextResponse.redirect(dashboardUrl, 303);
    }
    try {
      const runId = resumeLivePipeline(resumeRunId);
      return NextResponse.redirect(new URL(`/runs/${runId}`, request.url), 303);
    } catch (error) {
      const runUrl = new URL(`/runs/${resumeRunId}`, request.url);
      runUrl.searchParams.set(
        "error",
        error instanceof Error ? error.message : "Could not resume the pipeline.",
      );
      return NextResponse.redirect(runUrl, 303);
    }
  }

  const icpId = Number(form.get("icpId"));
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
