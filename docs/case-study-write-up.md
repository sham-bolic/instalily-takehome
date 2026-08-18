# Instalily AI Case Study Write-up

_Draft for the final three-page submission_

## 1. Prototype overview

I built a working lead qualification prototype for DuPont Tedlar's Graphics & Signage team. A user defines an Ideal Customer Profile (ICP), starts a run, and receives a ranked set of companies found through public industry-event data. The dashboard preserves the event, company, qualification rationale, evidence, size data when available, and the status of every pipeline step.

The DuPont demonstration ICP was grounded in DuPont's first-party product pages and brochures. It targets manufacturers and converters that can incorporate a clear protective overlaminate into durable graphic media, vehicle wraps, architectural graphics, outdoor signage, and similar products. Strong signals include coating or laminating capability, long outdoor warranties, anti-graffiti or easy-clean products, broad distribution, and recurring exposure to UV, moisture, chemicals, or heavy cleaning.

The central design choice is to use AI for bounded research and assessment tasks, while ordinary application code controls execution. The model does not decide stage order, retry forever, silently fill missing fields, or calculate its own unbounded score. This makes the workflow easier to inspect, test, and scale.

### Technology

- Next.js 16 and React 19 dashboard
- TypeScript pipeline and application logic
- Tavily for public-web event discovery and company research
- Playwright for JavaScript-rendered exhibitor directories
- Gemini through the Vercel AI SDK for structured extraction and qualification
- Apollo Organization Enrichment for optional company size and revenue data
- SQLite for ICPs, runs, stage artifacts, provider results, and assembled company profiles
- Zod schemas for structured AI output validation

## 2. AI agent workflow

1. **Create and snapshot the ICP**  
   The dashboard collects the offering, target companies, applications, fit signals, company size, geography, exclusions, and a representative company. It formats these inputs into a reusable named ICP. Starting a run stores an immutable snapshot, so later edits cannot change a historical assessment.

2. **Discover relevant events**  
   Tavily searches for upcoming trade shows and expos using concise queries derived from the ICP. Results are deduplicated by URL and stored with source URLs, summaries, retrieval metadata, relevance scores, and any recognized exhibitor or participant directory. The current run threshold is `0.5`.

3. **Source participating companies**  
   The pipeline tries the highest-ranked event with a usable company directory and can fall back to another event if the directory fails. Playwright renders the directory, including client-side content and embedded frames. Gemini classifies the page and extracts at most ten explicitly listed companies. Application code then rejects any company name, evidence excerpt, or URL that is not present in the rendered page. The event directory is retained as attendance evidence.

4. **Research and verify company identity**  
   Each company receives one neutral Tavily search for its official website and general public information. Domain and company-name checks reject ambiguous matches, event-profile redirects, social networks, and data-broker pages. Unresolved identities are skipped instead of guessed.

5. **Enrich the company profile**  
   A verified domain is sent to Apollo when credentials are available. The coordinator accepts the result only when the returned domain or normalized company name matches the sourced company. Tavily research remains usable when Apollo has no match or fails. Missing employee and revenue values remain explicitly unknown. Successful Apollo results are cached by domain and reused with a reference to the original artifact.

6. **Assess and rank ICP fit**  
   Gemini receives only the immutable ICP and saved company profile. It cannot browse during assessment. It returns schema-validated `high`, `medium`, or `low` values for both fit and confidence, a concise rationale, and up to five supporting facts. Missing facts lower confidence rather than automatically lowering fit. Application code ranks by fit first and confidence second.

7. **Review the result in the dashboard**  
   The dashboard separates discovered events, all sourced companies, enriched profiles, and qualified companies. Users can inspect sources, verified websites, enrichment status, fit, confidence, rationale, and evidence. They can also choose another discovered event for enrichment, resume a failed run after event discovery, delete finished runs, or inspect the persisted developer trace.

## 3. Data processing, validation, and resilience

Every external call produces an immutable stage artifact containing its input, structured output, provider, timestamps, and error state. This gives the prototype a complete trace from ICP to final ranking and makes provider behavior debuggable without hiding it inside model prose.

The pipeline applies several safeguards:

- Hard bounds on search results, directory traversal, extracted companies, enrichment calls, and model retries
- Structured Gemini outputs validated with Zod, with up to two correction retries
- Exact-page validation for extracted exhibitor names, evidence excerpts, and links
- Official-domain and normalized-name checks before accepting enrichment
- Explicit `unknown`, `skipped`, and `failed` states instead of invented facts
- Company-level failure isolation, so one provider or model failure does not stop other companies
- Event fallback when the highest-ranked directory cannot be used
- Resume and event-continuation flows that reuse saved discovery rather than repeating paid searches
- SQLite persistence and domain-level Apollo caching for repeatability and lower cost

The prototype is a modular monolith, which keeps the demo simple while preserving clean seams between event discovery, company sourcing, research, enrichment, qualification, persistence, and presentation. Provider-specific code is isolated behind narrow functions, so a different search or company-data service can be added without changing the dashboard or ranking logic. A future production version could move the same contracts to PostgreSQL and a durable job queue for higher concurrency.

## 4. Implementation results

A representative persisted live Graphics & Signage run demonstrates the complete workflow:

| Stage | Observed result |
| --- | ---: |
| Public event candidates discovered | 29 |
| Event used for company sourcing | PRINTING United Expo |
| Companies extracted from the rendered directory | 10 |
| Company identities verified and profiles saved | 6 |
| Companies skipped rather than ambiguously matched | 4 |
| Completed qualification assessments | 2 |
| Qualification calls isolated after Gemini quota failures | 4 |

The two completed assessments were both low-fit, high-confidence results. This is a useful outcome rather than a false success: presence at a broadly relevant printing event did not by itself make those exhibitors good Tedlar prospects. The system retained the evidence and filtered them instead of promoting them based only on event attendance. The run also exposed two practical areas for the next iteration: improve event selection toward graphics-material manufacturers and make the demo less dependent on live model quota.

The same saved-ICP workflow was also exercised with a separate aerospace ICP. That run found 23 event candidates, sourced ten exhibitors, verified five company profiles, and returned five assessments, including two high-fit and high-confidence companies. This provides an early check that the pipeline is reusable rather than hard-coded to one market.

Current automated verification passes:

- 48 backend and application tests covering discovery, extraction, identity resolution, caching, persistence, partial failures, qualification, ICP workflows, resume behavior, and dashboard view models
- TypeScript type checking
- Next.js production build
- Browser-level dashboard test for ICP selection and the ICP builder workflow

## 5. Current status and next iteration

The core live-data workflow is operational from the dashboard and terminal. The next iteration should rerun the Graphics & Signage ICP through the latest identity-verification logic, strengthen event ranking using manufacturer and converter signals, normalize public evidence into field-level source claims, and pin a labelled successful demo run for quota-independent presentation. These changes preserve the current principle: show a smaller set of defensible results rather than a larger set built from guesses.
