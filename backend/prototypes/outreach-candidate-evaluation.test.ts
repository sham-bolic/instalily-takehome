import assert from "node:assert/strict";
import { test } from "node:test";

import {
  validateCandidateAssessments,
  type CandidateAssessment,
} from "./outreach-candidate-evaluation.ts";
import type { DecisionMaker } from "./decision-maker-search.ts";

const people = [
  person("Dana", "Director", "Director of Product Development"),
  person("Riley", "Researcher", "Head of R&D"),
];

test("accepts and sorts one assessment for every supplied candidate", () => {
  const assessments: CandidateAssessment[] = [
    assessment(people[0]!.linkedInUrl, 72),
    assessment(people[1]!.linkedInUrl, 91),
  ];

  assert.deepEqual(
    validateCandidateAssessments(people, assessments).map(
      ({ personLinkedInUrl }) => personLinkedInUrl,
    ),
    [people[1]!.linkedInUrl, people[0]!.linkedInUrl],
  );
});

test("rejects invented, duplicate, and missing candidates", () => {
  assert.throws(
    () => validateCandidateAssessments(people, [
      assessment(people[0]!.linkedInUrl, 80),
      assessment("https://www.linkedin.com/in/invented", 90),
    ]),
    /unknown candidate/,
  );
  assert.throws(
    () => validateCandidateAssessments(people, [
      assessment(people[0]!.linkedInUrl, 80),
      assessment(people[0]!.linkedInUrl, 90),
    ]),
    /more than once/,
  );
  assert.throws(
    () => validateCandidateAssessments(people, [assessment(people[0]!.linkedInUrl, 80)]),
    /did not evaluate every candidate/,
  );
});

function assessment(personLinkedInUrl: string, relevanceScore: number): CandidateAssessment {
  return {
    personLinkedInUrl,
    relevanceScore,
    confidence: "high",
    rationale: "The role is directly relevant to product and material decisions.",
  };
}

function person(
  firstName: string,
  lastName: string,
  jobTitle: string,
): DecisionMaker {
  return {
    firstName,
    lastName,
    companyName: "Example Materials",
    companyDomain: "example.com",
    linkedInUrl: `https://www.linkedin.com/in/${firstName.toLocaleLowerCase()}`,
    jobTitle,
    seniorities: [jobTitle.startsWith("Director") ? "Director" : "Head"],
    departments: ["Research and Development"],
    country: "US",
  };
}
