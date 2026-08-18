"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";

import {
  DUPONT_TEDLAR_ICP,
  renderICPMarkdown,
  type ICPFormInput,
} from "../../backend/prototypes/icp-builder.ts";

type Field = {
  name: keyof ICPFormInput;
  label: string;
  hint: string;
  placeholder: string;
  required?: boolean;
  short?: boolean;
};

const coreFields: Field[] = [
  {
    name: "offering",
    label: "Product or offering",
    hint: "What are you selling, and what outcome does it provide?",
    placeholder: "Protective film for long-lasting outdoor graphics",
    required: true,
  },
  {
    name: "targetCompanies",
    label: "Target companies",
    hint: "Describe the types of businesses most likely to buy it.",
    placeholder: "Manufacturers and converters of signage materials",
    required: true,
  },
  {
    name: "applications",
    label: "Applications or use cases",
    hint: "List the jobs, products, or situations where the offering is useful.",
    placeholder: "Vehicle wraps, outdoor signs, building murals",
    required: true,
  },
];

const qualificationFields: Field[] = [
  {
    name: "strongFitSignals",
    label: "Strong-fit signals",
    hint: "What evidence makes a company especially promising?",
    placeholder: "Frequent UV exposure, premium product lines, costly replacement needs",
  },
  {
    name: "companySize",
    label: "Company size",
    hint: "Add a useful size or maturity range.",
    placeholder: "Established companies with commercial scale",
    short: true,
  },
  {
    name: "geography",
    label: "Geography",
    hint: "Name target regions, or leave unrestricted.",
    placeholder: "North America and Europe",
    short: true,
  },
  {
    name: "exclusions",
    label: "Exclusions",
    hint: "Call out companies the agent should avoid.",
    placeholder: "Short-term indoor applications or companies without a protective-film need",
  },
];

const exampleFields: Field[] = [
  {
    name: "idealCompany",
    label: "Example ideal company",
    hint: "Give the agent one concrete reference point.",
    placeholder: "Avery Dennison Graphics Solutions",
    short: true,
  },
  {
    name: "idealCompanyReason",
    label: "Why it fits",
    hint: "Explain which traits make this a representative customer.",
    placeholder: "It serves the right market at scale and develops durable graphic films",
  },
];

export function ICPBuilder({ error }: { error?: string }) {
  const router = useRouter();
  const [criteria, setCriteria] = useState<ICPFormInput>(DUPONT_TEDLAR_ICP);
  const markdown = renderICPMarkdown(criteria);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") router.push("/");
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [router]);

  return (
    <div className="icpModalLayer" id="new-icp">
      <Link className="icpModalBackdrop" href="/" aria-label="Close ICP builder" />
      <section
        className="icpModal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="icp-builder-title"
      >
        <header className="icpModalHeader">
          <div>
            <p className="eyebrow">Ideal customer profile</p>
            <h2 id="icp-builder-title">Create a reusable target</h2>
            <p className="subtle">
              Give the research agent a clear picture of who to find and why.
            </p>
          </div>
          <Link className="modalClose" href="/" aria-label="Close ICP builder">
            ×
          </Link>
        </header>

        {error ? (
          <div className="error modalError" role="alert">
            <strong>ICP not created</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <form action="/api/icps" method="post" className="icpBuilderForm">
          <div className="icpModalBody">
            <div className="icpFormSections">
              <FormSection
                number="01"
                title="Name your profile"
                description="Use a name your team will recognize in the pipeline launcher."
              >
                <label className="field">
                  <span>ICP name <Required /></span>
                  <small>A short label for this saved profile.</small>
                  <input
                    name="name"
                    defaultValue="DuPont Tedlar Graphics & Signage"
                    placeholder="Graphics and signage manufacturers"
                    required
                    autoFocus
                  />
                </label>
              </FormSection>

              <FormSection
                number="02"
                title="Define the opportunity"
                description="Start with the three essentials. These fields guide every research stage."
              >
                {coreFields.map((field) => (
                  <FormField
                    field={field}
                    value={criteria[field.name] ?? ""}
                    onChange={(value) => updateCriteria(field.name, value)}
                    key={field.name}
                  />
                ))}
              </FormSection>

              <FormSection
                number="03"
                title="Sharpen the fit"
                description="Add boundaries that help the agent separate a good lead from a distraction."
              >
                <FormField
                  field={qualificationFields[0]}
                  value={criteria.strongFitSignals ?? ""}
                  onChange={(value) => updateCriteria("strongFitSignals", value)}
                />
                <div className="fieldPair">
                  {qualificationFields.slice(1, 3).map((field) => (
                    <FormField
                      field={field}
                      value={criteria[field.name] ?? ""}
                      onChange={(value) => updateCriteria(field.name, value)}
                      key={field.name}
                    />
                  ))}
                </div>
                <FormField
                  field={qualificationFields[3]}
                  value={criteria.exclusions ?? ""}
                  onChange={(value) => updateCriteria("exclusions", value)}
                />
              </FormSection>

              <FormSection
                number="04"
                title="Ground it with an example"
                description="Optional, but useful when your target is easier to show than describe."
              >
                {exampleFields.map((field) => (
                  <FormField
                    field={field}
                    value={criteria[field.name] ?? ""}
                    onChange={(value) => updateCriteria(field.name, value)}
                    key={field.name}
                  />
                ))}
              </FormSection>
            </div>

            <aside className="icpPreviewPane" aria-live="polite">
              <div className="markdownPreviewHeader">
                <div>
                  <span>Profile preview</span>
                  <small>This is what the qualification agents will receive.</small>
                </div>
                <code>Live</code>
              </div>
              <div className="markdown">
                <ReactMarkdown>{markdown}</ReactMarkdown>
              </div>
            </aside>
          </div>

          <footer className="icpModalFooter">
            <p><span>*</span> Required fields</p>
            <div>
              <Link className="secondaryButton" href="/">Cancel</Link>
              <button className="primaryButton" type="submit">Save ICP</button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );

  function updateCriteria(name: keyof ICPFormInput, value: string) {
    setCriteria((current) => ({ ...current, [name]: value }));
  }
}

function FormSection({
  number,
  title,
  description,
  children,
}: {
  number: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="icpFormSection" aria-labelledby={`section-${number}`}>
      <div className="icpFormSectionHeader">
        <span>{number}</span>
        <div>
          <h3 id={`section-${number}`}>{title}</h3>
          <p>{description}</p>
        </div>
      </div>
      <div className="icpFormFields">{children}</div>
    </section>
  );
}

function FormField({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>{field.label} {field.required ? <Required /> : null}</span>
      <small>{field.hint}</small>
      {field.short ? (
        <input
          name={field.name}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          required={field.required}
        />
      ) : (
        <textarea
          name={field.name}
          rows={3}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.placeholder}
          required={field.required}
        />
      )}
    </label>
  );
}

function Required() {
  return <b className="requiredMark" aria-label="required">*</b>;
}
