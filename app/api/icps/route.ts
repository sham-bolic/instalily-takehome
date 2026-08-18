import { NextResponse } from "next/server";

import {
  buildICPSnapshot,
  type ICPFormInput,
} from "../../../backend/prototypes/icp-builder.ts";
import { getDatabase } from "../../lib/database.ts";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData();

  try {
    const snapshot = buildICPSnapshot(readICPInput(form));
    const id = getDatabase().createICP({
      name: stringValue(form, "name"),
      snapshot,
    });
    return NextResponse.redirect(new URL(`/?icp=${id}`, request.url), 303);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the ICP.";
    const url = new URL("/", request.url);
    url.searchParams.set("new-icp", "1");
    url.searchParams.set("error", message);
    url.hash = "new-icp";
    return NextResponse.redirect(url, 303);
  }
}

function readICPInput(form: FormData): ICPFormInput {
  return {
    offering: stringValue(form, "offering"),
    targetCompanies: stringValue(form, "targetCompanies"),
    applications: stringValue(form, "applications"),
    strongFitSignals: stringValue(form, "strongFitSignals"),
    companySize: stringValue(form, "companySize"),
    geography: stringValue(form, "geography"),
    exclusions: stringValue(form, "exclusions"),
    idealCompany: stringValue(form, "idealCompany"),
    idealCompanyReason: stringValue(form, "idealCompanyReason"),
  };
}

function stringValue(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
