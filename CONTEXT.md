# Lead Qualification

This context describes how the prototype discovers and qualifies potential customers for DuPont Tedlar's Graphics & Signage team.

## Language

**Ideal Customer Profile (ICP)**:
A user-provided, editable description of the kinds of companies most likely to need the product. Automatic generation from a company website is an optional extension.
_Avoid_: Lead profile, customer profile

**Event Source**:
An industry event, trade show, association, or relevant gathering used to discover candidate companies. Event quality learning from user feedback is an optional extension.
_Avoid_: Lead source company

**Candidate Company**:
A company sourced from an Event Source but not yet evaluated against the ICP.
_Avoid_: Qualified lead

**Attendance Confidence**:
An evidence-derived High, Medium, or Low rating for how strongly public sources connect a Candidate Company to an Event Source. High uses organizer evidence; Medium uses an explicit first-party company statement; Low covers indirect, ambiguous, or weakly matched evidence. The run's attendance threshold determines which persisted discoveries proceed to enrichment.
_Avoid_: Uncalibrated model certainty, inferred attendance

**Enriched Company Profile**:
The sourced facts and evidence about a Candidate Company used to evaluate ICP fit. Unknown facts remain explicitly unknown rather than inferred.
_Avoid_: ICP, contact profile

**Source Record**:
A stored record of where and when retrieved information came from, including its provider or URL and a reference to the original response or excerpt.
_Avoid_: Evidence claim, profile field

**Evidence Claim**:
A specific fact extracted from a Source Record and linked to any Enriched Company Profile field that uses it. Conflicting claims remain visible.
_Avoid_: Uncited model inference

**Qualification Assessment**:
An evidence-citing evaluation of an Enriched Company Profile against a versioned ICP rubric. The assessor supplies bounded criterion ratings; application code calculates the final score.
_Avoid_: Enriched Company Profile, unconstrained LLM score

**Stage Artifact**:
The persisted input references, structured output, evidence references, warnings, usage, and timing produced by one completed pipeline stage.
_Avoid_: User-facing resume checkpoint

**Lead**:
A Candidate Company whose Enriched Company Profile has been evaluated as a plausible ICP fit. A lead is not an individual contact.
_Avoid_: Contact, decision-maker, stakeholder

**Decision-maker**:
A person at a lead who may be suitable for outbound sales contact. The default pipeline sources decision-makers, evaluates their outreach relevance, and drafts messages for selected people.
_Avoid_: Lead
