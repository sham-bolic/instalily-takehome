import Link from "next/link";

import {
  DUPONT_TEDLAR_ICP,
  type ICPFormInput,
} from "../../backend/prototypes/icp-builder.ts";

const fields: Array<{
  name: keyof ICPFormInput;
  label: string;
  required?: boolean;
}> = [
  { name: "offering", label: "Product or offering", required: true },
  { name: "targetCompanies", label: "Target companies", required: true },
  { name: "applications", label: "Applications or use cases", required: true },
  { name: "strongFitSignals", label: "Strong-fit signals" },
  { name: "companySize", label: "Company size" },
  { name: "geography", label: "Geography" },
  { name: "exclusions", label: "Exclusions" },
  { name: "idealCompany", label: "Example ideal company" },
  { name: "idealCompanyReason", label: "Why it fits" },
];

export function ICPBuilder({ error }: { error?: string }) {
  return (
    <section className="panel builder" id="new-icp">
      <div className="builderHeader">
        <div>
          <p className="eyebrow">Ideal customer profile</p>
          <h2>Create a reusable target</h2>
          <p className="subtle">The supplied answers become an immutable snapshot for each run.</p>
        </div>
        <Link className="secondaryButton" href="/">Cancel</Link>
      </div>
      {error ? <div className="error"><strong>ICP not created</strong><span>{error}</span></div> : null}
      <form action="/api/icps" method="post" className="builderForm">
        <label className="field full">
          <span>ICP name *</span>
          <input name="name" defaultValue="DuPont Tedlar Graphics & Signage" required />
        </label>
        {fields.map((field) => (
          <label className={`field ${field.name === "offering" || field.name === "targetCompanies" || field.name === "applications" || field.name === "strongFitSignals" || field.name === "exclusions" ? "full" : ""}`} key={field.name}>
            <span>{field.label}{field.required ? " *" : ""}</span>
            <textarea
              name={field.name}
              rows={2}
              defaultValue={DUPONT_TEDLAR_ICP[field.name]}
              required={field.required}
            />
          </label>
        ))}
        <button className="primaryButton" type="submit">Save ICP</button>
      </form>
    </section>
  );
}
