# Personalized outbound enrichment recommendation

Retrieved: 2026-08-18

> Implementation update: Gemini now evaluates all Surfe candidates together against the ICP. Application code validates candidate identities and generates drafts for candidates scoring at least 70. This supersedes the deterministic top-three ranking proposed in the original research below.

## Executive recommendation

The prototype should add two stages after the existing Surfe decision-maker search:

```text
qualified company + matching people
  -> outreach evidence enrichment (once per company)
  -> personalized message drafting (once per selected person)
```

The key design choice is to personalize around the recipient's **business context**, not personal trivia. A useful message should answer:

1. Why this company?
2. Why this person and role?
3. Why Tedlar is relevant now?
4. What is the smallest useful next step?

The current Surfe search result already supplies enough person data to draft a message: full name, current title, company name and domain, role classifications, country, and LinkedIn URL. Since the requested output is a copyable message rather than a delivered email, person contact enrichment should be deferred. Surfe's additional people-enrichment endpoint is asynchronous and is mainly useful when job history, email, or phone data is required.[1][2]

The missing input is not more contact data. It is a small, sourced **outreach evidence pack** that connects a current company fact to a relevant Tedlar benefit.

## What good personalization should look like

A personalized message is not merely a template containing the recipient's name and job title. It should contain one verifiable company-specific reason for writing and explain why that reason may matter to the recipient's role.

Use this four-part structure:

1. **Relevant observation** - one sourced fact about the company's product, application, market activity, or event participation.
2. **Role connection** - explain cautiously why that fact may fall within this person's Product Development, Innovation, R&D, coatings, or protective-solutions remit.
3. **Tedlar value** - connect only the most relevant approved product benefit.
4. **Interest question** - ask whether the topic is relevant, rather than immediately demanding a meeting.

Recommended constraints:

- 60 to 110 words
- 3 or 4 short sentences
- one company-specific observation
- one Tedlar value proposition
- one low-pressure question
- no invented pain, familiarity, quantified savings, or claims about the recipient's responsibilities
- no generic praise such as "I love what your company is doing"

Gong reports that its analysis of 304,174 emails found an interest-based call to action performed best for cold outreach, while meeting requests were more appropriate after a sales conversation had begun.[3] Its broader cold-email analysis treats 30 to 150 words as a viable range when each sentence is personalized and intentional.[4] These are vendor-reported correlations, not universal rules, so the dashboard should make drafts editable and eventual reply data should determine whether the format works for DuPont.

## The information needed

### 1. Person identity and role context

Already available from Surfe search:

- first and last name
- current title
- current company name and domain
- seniority and department labels
- country
- LinkedIn profile URL

Before drafting, require the normalized returned `companyDomain` to match the qualified company's domain. Treat every person as a **likely stakeholder**, not a confirmed buyer. A title supports a role hypothesis but does not prove budget ownership.

Derive a short `why_this_person` explanation in application code:

- Product Development: likely involved in evaluating or introducing differentiated graphics materials
- Innovation: likely involved in new material or product opportunities
- R&D: likely involved in compatibility, durability, coatings, films, or qualification testing
- Coatings or Protective Solutions: likely close to the surface-performance problem Tedlar addresses

Do not claim more than the title supports. For example, use "Given your product development role..." rather than "You own Avery's overlaminate purchasing."

LinkedIn's own Sales Navigator guidance recommends looking at role, seniority, function, recent activity, company priorities, growth, hiring, and news when preparing a relevant conversation.[5] Its alerts also distinguish job and role changes, lead activity, and senior hires as useful current signals.[6]

### 2. Company-specific outreach evidence

Research once per qualified company and reuse the result for all selected people. Prefer these signals, in order:

| Priority | Signal | Example | Why it is useful |
|---|---|---|---|
| 1 | Relevant product or application | Outdoor signage, fleet wraps, architectural graphics, graphic films, laminates | Direct connection to the Tedlar Graphics & Signage ICP |
| 2 | Recent first-party activity | Product launch, expansion, partnership, sustainability initiative, new facility | Supplies a credible "why now" |
| 3 | Event participation | Exhibitor, sponsor, or speaker at the sourced event | Explains how the prospect was found |
| 4 | Company strategy | Durability, cleanability, weather resistance, premium graphics, lifecycle improvements | Supports a specific product angle |
| 5 | Role-only fallback | No fresh public signal, but the company and title are strongly relevant | Better than inventing a current event |

Use first-party pages whenever possible:

- the qualified company's product and application pages
- its newsroom or press releases
- the event's exhibitor page already captured by the pipeline
- DuPont's approved Tedlar product pages

Do not use weak facts such as headquarters, founding year, or employee count unless they directly affect the message. Those fields help qualification but rarely make outreach feel relevant.

### 3. Approved Tedlar claims

Store product claims as a small, versioned knowledge object rather than searching the web for them on every run. DuPont says Tedlar Clear Protection film is a surface laminate for graphics that protects against graffiti, fading, corrosion, and harsh UV exposure and can reduce cleaning, maintenance, and replacement costs.[7]

Select only one benefit that matches the company evidence:

- outdoor graphics or wraps -> UV and fading protection
- public signage or transit graphics -> graffiti resistance and cleanability
- harsh environments -> moisture, corrosion, and weather protection
- premium durable graphics -> longer-lasting appearance and fewer replacements

Never convert these general product properties into an unsupported account-specific outcome. "Tedlar is designed to resist fading" is supported. "Tedlar will cut your replacement costs by 30%" is not.

## Recommended enrichment implementation

### Stage A: `outreach_research`

Run once for each qualified company with at least one matched person.

Input:

```ts
type OutreachResearchInput = {
  companyName: string;
  companyDomain: string;
  eventName: string;
  qualificationRationale: string;
  qualificationEvidence: string[];
};
```

Perform two narrow Tavily searches instead of repeating broad company enrichment:

```text
site:{companyDomain} (graphics OR signage OR wrap OR laminate OR film OR coating)
site:{companyDomain} (launch OR expands OR partnership OR sustainability OR news) (graphics OR film OR coating)
```

Keep at most three relevant results. Use Tavily Extract only for the selected URLs when the search excerpt is not enough to support a precise claim. Tavily Search returns source URLs, excerpts, relevance scores, request IDs, and usage. Tavily Extract returns page content plus failed URLs and its own request and usage metadata.[8][9]

Normalize the result into evidence, rather than passing raw search output directly into message generation:

```ts
type OutreachEvidence = {
  id: string;
  claim: string;
  sourceUrl: string;
  sourceTitle: string;
  retrievedAt: string;
  sourceType: "company" | "event" | "dupont";
  relevance: "direct" | "supporting";
};

type OutreachBrief = {
  companyDomain: string;
  evidence: OutreachEvidence[];
  recommendedAngle:
    | "uv_fading"
    | "graffiti_cleanability"
    | "weather_corrosion"
    | "durable_graphics"
    | "role_only";
  warnings: string[];
};
```

A deterministic filter should require every company source URL to use the qualified company domain. The event evidence and DuPont claims may use their known domains. If no direct evidence survives validation, return `role_only` with a warning instead of failing or fabricating a signal.

### Stage B: `outreach_drafting`

Draft for no more than the top three people per company. Rank contacts deterministically before invoking Gemini:

1. exact Product Development, Innovation, or relevant R&D title
2. VP, Head, then Director, while preserving stronger functional relevance over seniority alone
3. coatings, films, laminates, materials, graphics, or protective-solutions wording
4. exact current-employer domain match

Give Gemini only the selected person's role data, company qualification summary, validated outreach evidence, and approved Tedlar claim. Treat all retrieved page text as untrusted data and instruct the model to ignore any instructions inside it.

Suggested output:

```ts
type PersonalizedOutreach = {
  personLinkedInUrl: string;
  message: string;
  whyThisPerson: string;
  whyThisCompany: string;
  evidenceIds: string[];
  productClaimId: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
};
```

Use Gemini structured output through the existing Vercel AI SDK and Zod pattern. Gemini supports JSON Schema constrained output and explicitly supports Zod in JavaScript.[10] Continue to validate content after schema validation because valid JSON can still contain unsupported prose.

## Deterministic quality checks

Reject or flag a generated draft when:

- the returned person's company domain does not match the qualified company
- the message names a fact that cannot be traced to an `evidenceId` or approved product claim
- it asserts a private pain, budget, responsibility, existing material, or quantified result
- it refers to a "recent" event without a date in the evidence
- it exceeds 110 words
- it has more than one question or call to action
- it asks for a meeting in the first cold message
- it contains fake familiarity, generic praise, or unexplained acronyms
- there is no company evidence and the draft pretends to contain company-specific research

A failed draft should be visible as `draft_error`, while a lack of strong evidence should be `drafted_with_warning`. This preserves the dashboard's existing distinction between no result and a technical error.

## Example message shape

Assume the pipeline has a sourced company claim that the prospect makes outdoor fleet-wrap films and a matching Product Development Director. A valid draft could be:

> Hi Maya - I came across Example Graphics through ISA Sign Expo and saw your focus on outdoor fleet-wrap films. Given your product development role, I thought surface durability may be relevant. Tedlar Clear Protection film is designed to help graphics resist UV exposure, fading, dirt, and graffiti. Would exploring its fit for the outdoor films your team develops be relevant?

What makes this useful:

- the event and product observation explain why this company
- the title explains why this person without claiming purchasing authority
- the Tedlar claim is narrow and approved
- the final question tests interest without demanding calendar time

If only the role and company qualification are available, fall back honestly:

> Hi Maya - Given your product development role at Example Graphics, I wanted to share a material option that may be relevant to durable graphics applications. Tedlar Clear Protection film is designed to help graphics resist UV exposure, fading, dirt, and graffiti. Is surface protection for outdoor graphics an area your team is exploring?

The second message is less personalized, so it should carry a warning in the dashboard, but it is preferable to invented detail.

## Dashboard recommendation

Extend each existing person row or card with:

- `Why this person`
- `Why this company`
- personalization confidence
- evidence links
- the generated message in an editable text area
- `Copy message`
- warning or error state

Do not add a Send action. The case-study instructions require a personalized outreach message, and a copyable draft satisfies that deliverable while keeping review explicit.

Generate drafts as part of a dedicated follow-up run from the completed decision-maker run, matching the workflow already used to test Surfe independently. This allows the current run with Surf/Surfe results to be reused without rerunning event discovery, company enrichment, qualification, or people search.

## What not to build now

- **No email or phone enrichment:** it is unnecessary for a copyable message and introduces credits, privacy handling, and async job polling.
- **No LinkedIn scraping:** use the returned profile URL as a review link.
- **No autonomous send:** keep a human in control.
- **No unconstrained web-enabled writer:** research first, normalize evidence, then draft.
- **No personal-life personalization:** role and company context are more defensible and relevant.
- **No message for zero-match companies:** keep the existing `0 matches` state.

If contact delivery is added later, Surfe V2 people enrichment can accept a LinkedIn URL or a name plus company name/domain, supports up to 10,000 people, and returns an enrichment job ID for webhook completion or polling.[1][2] Credit and quota handling must then become an explicit provider outcome. Surfe documents a free people-search quota of 200 results per day and separate credit behavior for people enrichment.[11]

## Compliance note

Although this prototype only creates drafts, production sending needs suppression and opt-out handling. The FTC states that CAN-SPAM applies to business-to-business commercial email, requires truthful headers and subjects, a postal address, ad disclosure, a working opt-out path, and honoring opt-outs within ten business days.[12] Other countries have different requirements, so this is not a complete production compliance design.

## Suggested implementation order

1. Add the versioned Tedlar product-claim object and tests.
2. Add `outreach_research` with recorded Tavily fixtures and URL/domain validation.
3. Add deterministic contact ranking and `why_this_person` generation.
4. Add Zod-constrained Gemini drafting.
5. Add the content quality validator and warning states.
6. Add editable message and Copy controls to the People dashboard.
7. Run it as a follow-up against the existing completed decision-maker run.
8. Review all generated drafts manually before considering broader pipeline integration.

## Sources

1. Surfe, [Enrich People (start)](https://developers.surfe.com/public-015-create-people-bulk-enrichment)
2. Surfe, [Enrich People (get)](https://developers.surfe.com/public-016-get-bulk-enrichment)
3. Gong Labs, [Surprising cold email CTA that increases meeting bookings](https://www.gong.io/blog/this-surprising-cold-email-cta-will-help-you-book-a-lot-more-meetings)
4. Gong, [7 cold email statistics that can refine your engagement strategy](https://www.gong.io/blog/cold-email-stats)
5. LinkedIn Sales Navigator Help, [Research an account in Sales Navigator before a sales call](https://www.linkedin.com/help/sales-navigator/answer/a10524036)
6. LinkedIn Sales Navigator Help, [Sales Navigator alerts](https://www.linkedin.com/help/sales-navigator/answer/a105133)
7. DuPont, [Easy-to-Clean Durable Surface Finishes for Graphic Signage](https://www.dupont.com/tedlar/tedlar-signage-applications.html)
8. Tavily, [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
9. Tavily, [Extract API](https://docs.tavily.com/documentation/api-reference/endpoint/extract)
10. Google, [Gemini structured outputs](https://ai.google.dev/gemini-api/docs/structured-output)
11. Surfe, [Credits and quotas](https://developers.surfe.com/credits-and-quotas)
12. U.S. Federal Trade Commission, [CAN-SPAM Act: A Compliance Guide for Business](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
