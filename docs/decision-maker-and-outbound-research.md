# Decision-maker discovery and personalized outbound research

> Implementation update: Surfe replaced the originally considered Apollo people search. Gemini now scores all returned candidates against the ICP, and application code validates identities and applies a relevance threshold of 70. This supersedes the deterministic ranking proposal in the original research below.

## Recommendation

Add two post-qualification stages rather than expanding company qualification itself:

1. **Stakeholder discovery** - find and rank a small buying committee for each qualified Lead.
2. **Outreach drafting** - generate one evidence-grounded draft for each selected stakeholder.

For this prototype, the most credible implementation is:

- Apollo People Search scoped to the already-resolved company domain
- deterministic role ranking for Tedlar's likely buying committee
- Apollo People Enrichment only for the top two or three contacts
- one focused Tavily search for current, first-party account or person signals
- Gemini structured output for the message draft
- mandatory human review before any send action

This fits the existing architecture because Apollo, Tavily, Gemini, stage artifacts, and company-domain identity resolution already exist. It also avoids presenting LinkedIn Sales Navigator as an openly available API. LinkedIn says sales-related API access requires approval as a Sales Navigator Application Platform partner.[1]

## Case-study requirement: target the roles named in the instructions

The case-study instructions narrow the stakeholder target more than a generic buying-committee search. They ask for **VPs and Directors** and give these likely stakeholders for the Avery Dennison example:

- VPs of Product Development
- Directors of Innovation
- R&D leaders focused on coatings and protective solutions

Those should be the primary personas used for discovery, ranking, and the demo. The output must explain both **why the company is qualified** and **why the named person is a qualified decision-maker**, then use those two rationales to draft the personalized message. Lower-seniority technical employees, procurement, marketing, and generic executives should not displace a matching VP, Director, Head, or R&D leader.

## Main finding: target the named personas, then map supporting stakeholders

A title alone does not prove that someone owns a purchase. Sales Navigator itself models account roles such as Decision Maker, Champion, Evaluator, Procurement, and Influencer, and its Relationship Explorer recommends multiple contacts for a target persona.[2][3] The product should first find the senior technical and product personas required by the case study, then return supporting stakeholders as a secondary account map. It should not claim that one person is definitively the buyer.

For Tedlar clear overlaminates, DuPont describes a product that protects graphics from UV, moisture, fading, corrosion, dirt, mold, mildew, and graffiti, while reducing cleaning and replacement needs.[4][5] Those product characteristics suggest the following search order.

| Search tier | Relevant title families | Why they may care | Use in the prototype |
|---|---|---|---|
| 1 - Product development leadership | VP Product Development, Vice President Product Development, Head of Product Development, Director Product Development | Owns development and qualification of differentiated graphics products | Primary outreach target |
| 1 - Innovation leadership | VP Innovation, Head of Innovation, Director Innovation, Director R&D | Owns material and product innovation priorities | Primary outreach target |
| 1 - Relevant R&D leadership | VP R&D, Head of R&D, R&D Director, Research Director, technical leaders mentioning coatings, films, laminates, polymers, surfaces, or protective solutions | Evaluates film compatibility, adhesives, durability, and optical or mechanical performance | Primary outreach target |
| 2 - Materials and applications leadership | Director Materials Engineering, Director Applications Engineering, Principal Scientist, Technical Director | Can evaluate and champion the solution, but may have less purchasing authority | Fallback or supporting contact |
| 2 - Relevant product ownership | VP Product, Director Product Management, business-unit leader for graphics, signage, wraps, or architectural surfaces | Connects technical performance to roadmap, warranty, differentiation, and customer needs | Fallback or economic sponsor |
| 3 - Process stakeholders | Manufacturing engineering, quality, operations, procurement | Supports qualification, production, and supplier approval | Account map only unless no primary persona exists |

This taxonomy should be stored with the ICP or product profile, not hidden in an LLM prompt. Different ICPs can then supply different role families and exclusions.

## What to add to the Enriched Company Profile

The current profile is sufficient for company qualification, but personalized outreach needs a compact **account brief**. Add sourced fields only, leaving missing values unknown:

- `product_lines[]` - relevant films, laminates, signage, wraps, or architectural graphics
- `applications[]` - outdoor signage, fleet graphics, murals, transit, architectural surfaces, and similar uses
- `likely_pains[]` - evidence-backed exposure to fading, graffiti, cleaning, weather, warranty, or replacement problems
- `strategic_signals[]` - recent launches, facility expansions, hiring, partnerships, sustainability commitments, or event participation
- `buying_committee_hypotheses[]` - role, rationale, and confidence, clearly marked as hypotheses
- `people[]` - provider identity, current title, employer match, LinkedIn URL, contactability status, and source timestamps
- `outreach_angles[]` - an evidence claim connected to a Tedlar value proposition
- `do_not_contact` and `suppression_reasons[]`

Every signal and outreach angle should reference existing Source Records and Evidence Claims. Do not let the drafting model browse or invent evidence.

## Provider options

### 1. Apollo - best immediate fit

Apollo People Search supports employer domains, current title, seniority, location, email status, headcount, revenue, technologies, and hiring filters. A domain request can include up to 1,000 domains. The search endpoint returns limited records and Apollo IDs, but not email addresses or phone numbers, and currently lists search usage as zero credits.[6] Apollo recommends combining title and seniority filters.[6]

A practical request per qualified company would use:

- `q_organization_domains_list[]`: the verified company domain, or `organization_ids[]` when the Apollo organization ID is known
- `person_seniorities[]`: `vp`, `head`, `director`, with `c_suite` only for a relevant technical or product title
- `person_titles[]`: the exact Product Development, Innovation, and R&D title families above, followed by the tier-two fallbacks
- `include_similar_titles`: initially `true`, followed by deterministic exclusions
- `per_page`: 20 to 40

Then score all returned people and enrich only the best two or three. Apollo People Enrichment accepts an Apollo person ID or a name plus employer domain. It can return full name, current title, employment history, LinkedIn URL, email and email status, location, and employer identity.[7] Bulk enrichment handles up to ten people per call.[7] Apollo warns that sparse matching inputs can produce a successful HTTP response with no enriched record, so `no_match` must remain separate from technical failure.[8]

**Important validation:** require the enriched person's current employer organization domain to equal the qualified Lead domain. For subsidiaries, preserve the expected company entity and flag parent-company matches for review.

### 2. Clay - strong integration story, but not the simplest core dependency

Clay recommends "Find People at These Companies" when a company list already exists. Its guidance says title keyword lists are often more precise than broad function and seniority dropdowns, recommends exclusion lists, and explicitly says to verify current employment because people data is snapshot data.[9] Clay can also run provider waterfalls, stopping after a provider succeeds to improve coverage without duplicating spend.[10]

Clay now documents a Public API for backend services that can run searches and enrichment functions across Clay and its vendor marketplace. However, its Agent Plugin is in open beta, Workflows are alpha, and API-side credit budgets are not yet available.[11] For this take-home, Clay is best presented as a future adapter, not required infrastructure.

### 3. LinkedIn Sales Navigator - valuable user workflow, restricted programmatic access

Sales Navigator can surface key people, growth and hiring trends, account insights, recent activity, job changes, mutual connections, and stakeholder maps.[12] Those are excellent inputs for review and personalization.

The integration caveat is material: LinkedIn says most permissions require explicit approval, and sales permissions require approved SNAP partner status.[1] The prototype should therefore:

- display a normal LinkedIn profile URL returned by an authorized data provider
- allow a salesperson to open and verify the profile manually
- describe full Sales Navigator synchronization as a future approved-partner integration
- not scrape LinkedIn or imply that a normal developer account can search Sales Navigator

### 4. Hunter - useful contactability fallback

Hunter's Email Finder accepts a company domain plus a person's name and performs verification automatically. Its response includes verification state and, when found publicly, source URLs and last-seen dates.[13] Its verifier distinguishes `valid`, `invalid`, `accept_all`, `webmail`, `disposable`, and `unknown`.[13] Hunter also returns a `451 claimed_email` response when the person has requested that processing stop, which should immediately create a suppression record.[13]

Use Hunter only after person identity and current employment have been established. It should not decide who the stakeholder is.

### 5. Public and first-party sources

Use current provider data for discovery, then prefer first-party evidence for personalization:

- company leadership and team pages
- product and application pages
- press releases and newsroom posts
- event speaker biographies
- annual reports and investor presentations
- current job postings

Tavily Search returns URLs, excerpts, relevance scores, request IDs, and usage, while Tavily Extract can retrieve page content for selected URLs.[14][15] A focused strategy is better than another broad company search:

```text
site:{companyDomain} ({product terms}) (launch OR news OR case study)
site:{companyDomain} "{person name}" OR "{exact title}"
```

For public companies, SEC's unauthenticated EDGAR APIs provide real-time filing history and company financial facts. Filings can be used as first-party evidence for strategy and business-unit context, though the API itself is not a normalized people directory.[16]

## Ranking contacts without pretending certainty

Use application code to calculate a transparent ranking. The LLM may classify an unusual title into a role, but it should not assign the final score.

Suggested 10-point score:

- **Required-persona match, 0-4** - VP or Director of Product Development, Director or Head of Innovation, or R&D leadership relevant to coatings and protective solutions
- **Functional relevance, 0-2** - direct ownership of coatings, films, laminates, materials, graphics products, applications, or the relevant business unit
- **Authority, 0-1** - VP, Head, Director, or relevant business-unit leader
- **Employer confidence, 0-1** - current experience and domain both match
- **Evidence freshness, 0-1** - source or provider refreshed recently
- **Reachability, 0-1** - verified work email or usable LinkedIn URL

Apply hard gates before scoring:

- current employer must match
- reject former employees
- reject unrelated geography when the role is explicitly regional and outside the target market
- reject generic advisors, recruiters, salespeople, and unrelated corporate functions
- do not treat email availability as evidence of buying authority

Select up to three contacts in this order: one Product Development VP or Director, one Innovation Director or Head, and one relevant R&D leader. Use materials, applications, or product-management leadership only as fallbacks. Procurement and operations can appear in the account map but should not be the featured outreach recipient. Expose `why_selected`, `role_hypothesis`, `confidence`, and the supporting fields in the dashboard.

## Personalized outbound should be evidence composition, not free-form writing

The message generator should receive only:

- recipient name, current title, hypothesized buying role, and a concise `why_this_person` rationale
- company qualification rationale and a concise `why_this_company` rationale
- two or three approved company or person Evidence Claims
- the relevant Tedlar product facts
- the company's qualification rationale
- style and length constraints

It should return structured fields such as:

```ts
type OutreachDraft = {
  subject: string;
  body: string;
  openingClaimIds: string[];
  valuePropositionClaimIds: string[];
  callToAction: string;
  warnings: string[];
};
```

Structured output constrained by JSON Schema prevents omitted keys and invalid enum values, although the application must still handle refusals and truncated responses.[17]

Recommended message shape:

1. A factual reason for writing, tied to the recipient's company or role
2. A cautious problem hypothesis, not an assertion about an undisclosed pain
3. One relevant Tedlar outcome
4. One low-friction question or call to action

Example using only hypothetical account evidence:

> Hi Maya - I saw that Example Graphics recently expanded its outdoor fleet-wrap line. Given your product-development role, I thought the durability of the overlaminate may be relevant. Tedlar clear protection film is designed to resist UV, moisture, dirt, and graffiti while preserving the underlying graphic. Would it be useful to compare its outdoor test profile with the laminates your team currently qualifies?

Avoid unsupported lines such as "I know fading is costing your team millions" or fake personal familiarity. If there is no strong person-level signal, personalize at the company and role level rather than inventing one.

## Validation and safety gates

Before showing a draft as ready for review:

- all factual clauses must map to Evidence Claim IDs
- all cited pages must have retrieval dates
- current employment must pass domain validation
- email must be `valid`; treat `accept_all` and `unknown` as review-only
- stale people records must carry a warning
- suppress contacts with opt-outs, provider privacy claims, previous bounces, or existing CRM ownership
- prohibit automatic send in the prototype
- keep the sender identity, physical address, and unsubscribe mechanism outside the model as deterministic template content

The FTC says CAN-SPAM covers commercial email, including business-to-business messages. It requires accurate headers and subjects, ad disclosure, a valid postal address, a clear opt-out method, and honoring opt-outs within ten business days.[18] Other jurisdictions impose different rules, so production rollout requires jurisdiction-specific legal review and suppression handling.

## Proposed pipeline and artifacts

```text
ranked Lead
  -> stakeholder_search
  -> stakeholder_enrichment
  -> stakeholder_ranking
  -> outreach_signal_research
  -> outreach_drafting
  -> human_review
```

Suggested contracts:

```ts
type StakeholderCandidate = {
  providerPersonId: string;
  companyDomain: string;
  namePreview: string;
  title: string;
  seniority: string | null;
  roleHypothesis: "technical_evaluator" | "champion" | "economic_buyer" |
    "operations_approver" | "procurement" | "influencer";
};

type DecisionMakerProfile = {
  personId: string;
  companyDomain: string;
  name: string;
  title: string;
  currentEmployerVerified: boolean;
  linkedinUrl: string | null;
  workEmail: string | null;
  emailStatus: string | null;
  roleHypothesis: StakeholderCandidate["roleHypothesis"];
  score: number;
  whySelected: string[];
  sourceReferences: string[];
};
```

Persist provider responses separately from normalized people, just as company enrichment already does. Cache search by `(companyDomain, taxonomyVersion)` and enrichment by provider person ID. Include provider cost, request IDs, timestamps, warnings, and suppression outcomes in every stage artifact.

## Best take-home scope

A compelling final slice does not need an actual sender integration. It should:

1. Run stakeholder discovery only for high and medium fit Leads.
2. Search first for Product Development VPs or Directors, Innovation Directors or Heads, and relevant R&D leaders.
3. Show up to three ranked contacts per company with role, title, LinkedIn URL, match confidence, `why this person`, and `why this company`.
4. Generate one short, cited draft for the selected contact from those two rationales.
5. Display the exact evidence used and warnings for stale or missing data.
6. Offer **Edit draft** and **Copy**, not **Send**, unless a real email provider and compliance workflow are implemented.
7. Use recorded Apollo and Tavily fixtures for deterministic tests and a live run only as a manual smoke test.

This demonstrates real automation, provider integration seams, evidence discipline, error handling, and a credible path to Sales Navigator or Clay without overbuilding the prototype.

## Sources

1. LinkedIn, [Getting Access to LinkedIn APIs](https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access)
2. LinkedIn Sales Navigator Help, [Relationship Maps in Sales Navigator Account pages](https://www.linkedin.com/help/sales-navigator/answer/a456397)
3. LinkedIn Sales Navigator Help, [Relationship Explorer in Sales Navigator](https://www.linkedin.com/help/sales-navigator/answer/a1421128)
4. DuPont, [Easy-to-Clean Durable Surface Finishes for Graphic Signage](https://www.dupont.com/tedlar/tedlar-signage-applications.html)
5. DuPont, [Tedlar Clear Overlaminates for Graphics and Signage brochure](https://www.dupont.com/content/dam/dupont/amer/us/en/tedlar-pvf-films/public/documents/Tedlar-Graphic-and-Signage-Brochure.pdf)
6. Apollo, [People API Search](https://docs.apollo.io/reference/people-api-search)
7. Apollo, [Enrich People Data](https://docs.apollo.io/docs/enrich-people-data)
8. Apollo, [People Enrichment](https://docs.apollo.io/reference/people-enrichment)
9. Clay, [Finding companies and people in Clay](https://university.clay.com/docs/finding-companies-and-people-in-clay)
10. Clay, [Waterfalls](https://university.clay.com/docs/building-a-data-waterfall)
11. Clay, [Clay API and CLI](https://university.clay.com/docs/using-clay-as-an-api)
12. LinkedIn Sales Navigator Help, [Research an account in Sales Navigator before a sales call](https://www.linkedin.com/help/sales-navigator/answer/a10524036)
13. Hunter, [API Reference V2](https://hunter.io/api-documentation/v2)
14. Tavily, [Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
15. Tavily, [Extract API](https://docs.tavily.com/documentation/api-reference/endpoint/extract)
16. U.S. Securities and Exchange Commission, [EDGAR Application Programming Interfaces](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
17. OpenAI, [Structured model outputs](https://platform.openai.com/docs/guides/structured-outputs)
18. U.S. Federal Trade Commission, [CAN-SPAM Act: A Compliance Guide for Business](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)
