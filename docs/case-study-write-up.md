# Instalily AI Case Study

## 1. Prototype overview

I built a working lead-generation and outreach MVP for DuPont Tedlar's Graphics & Signage team. A user defines an editable Ideal Customer Profile (ICP) and starts one automated run. The application discovers relevant industry events, extracts participating companies, verifies and enriches those companies, assesses their fit, finds potential decision-makers at high-fit accounts, and drafts evidence-grounded outreach for human review.

The demonstration ICP targets established manufacturers and converters that could incorporate a clear protective overlaminate into durable graphic media, vehicle wraps, architectural graphics, outdoor signage, and similar products. Company scale is part of the ICP: the rubric prioritizes businesses with 200 or more employees, approximately $50M or more in revenue, multiple production sites, or broad distribution. Size contributes to the overall fit assessment but does not override product and application fit.

```text
Editable ICP
  -> Discover events and participating companies
  -> Verify, enrich, qualify, and rank companies
  -> Find and evaluate decision-makers at high-fit companies
  -> Research first-party company signals
  -> Draft, review, edit, and copy personalized outreach
```

AI performs bounded research, extraction, assessment, and drafting tasks. Regular application code controls stage order, validates structured output, applies thresholds, saves progress, and isolates failures. The MVP uses Next.js and TypeScript, Tavily for public-web research, Playwright for interactive event directories, Gemini for extraction and assessment, Apollo for company enrichment, Surfe for people search and LinkedIn URLs, and SQLite for ICPs, runs, profiles, and processing history.

## 2. Five-stage workflow

### 1. Define the ICP

The dashboard collects the offering, target companies, applications, fit signals, size, geography, exclusions, and a representative company. Every run saves an immutable ICP copy, so later edits cannot change historical results.

### 2. Discover events and participating companies

Tavily searches using terms derived from the ICP and retains source URLs, summaries, relevance scores, and recognized exhibitor, sponsor, speaker, or participant directories. Playwright renders JavaScript directories and embedded frames. Gemini extracts only companies and links present on the rendered source page; unusable sources are skipped rather than guessed.

The demonstrated source was the [PRINTING United Expo exhibitor directory](https://pru26.mapyourshow.com/8_0/floorplan/index.cfm). The current implementation operationalizes event participant lists. Association membership directories are a compatible future source, but were not demonstrated in the final run.

### 3. Verify, enrich, qualify, and rank companies

Tavily first resolves each company's official identity. Deterministic checks compare names and domains while rejecting event platforms, social networks, and data brokers. Apollo then supplies available organization size and revenue data. Missing facts remain unknown, and ambiguous identities remain unresolved.

Gemini assesses the assembled profile against the complete ICP, including business activity, applications, technical capability, company scale, geography, and exclusions. It returns schema-validated `high`, `medium`, or `low` fit and confidence with a rationale. Companies are ranked by overall ICP fit and evidence confidence. This means revenue and employee count influence qualification without allowing a large but irrelevant company to outrank a smaller strategic fit.

### 4. Find and evaluate decision-makers

Only high-fit companies proceed to Surfe. The search uses the verified company domain and looks for VPs, Directors, or Heads in Product Development, Innovation, R&D, Coatings, and Protective Solutions. Gemini evaluates all returned people together using their title, department, seniority, the ICP, and the company rationale. Application code rejects invented, missing, or duplicate identities and selects contacts scoring at least 70.

### 5. Draft reviewed outreach

Tavily performs one reusable first-party research search for each company with selected contacts. Gemini drafts a short message using validated company evidence and a claim from a versioned set of DuPont product claims. Application code rejects unknown evidence, unknown product claims, and employer-domain mismatches.

The dashboard never sends outreach automatically. A salesperson reviews the qualification reasoning and sources, edits the draft, and copies it when ready. Future sales feedback can tune message tone and selection policy so less editing is needed without removing the human approval boundary.

## 3. Live implementation result

The final live Graphics & Signage run completed the entire workflow in one run in approximately 32 seconds.

| Result | Final run |
| --- | ---: |
| Public event candidates discovered | 28 |
| Candidates with a usable company source | 8 |
| Event used | PRINTING United Expo |
| Companies extracted | 10 |
| Company identities resolved and assessed | 8 |
| High-fit / low-fit companies | 1 / 7 |
| High-fit companies searched in Surfe | 1 |
| Potential decision-makers returned | 2 |
| Contacts selected and messages drafted | 2 |

Agfa Corporation was the high-fit account. Its profile described a global manufacturer with more than $1.2B in revenue, thousands of employees, a Digital Printing Solutions division, large-format and industrial printing activity, and relevant event participation. The seven rejected companies included apparel suppliers, software vendors, equipment distributors, and substrate manufacturers that shared event relevance but lacked the ICP's ability to incorporate a protective overlaminate.

Surfe returned [Bart Verlinden, Head of R&D](https://www.linkedin.com/in/bart-verlinden-17a0331), and [Andy Clifton, Head of Innovation](https://www.linkedin.com/in/andyaclifton). Gemini scored them 90 and 75 respectively. Both exceeded the 70-point selection threshold.

[![Actual dashboard output from final run 27](images/dashboard-run-27-example.png)](images/dashboard-run-27.png)

The displayed Andy Clifton message is the actual editable output from the final run. It uses an [Agfa first-party description of its digital printing work](https://careers.agfa.com/job/Remote-Solutions-Architect/1254255201) and DuPont's [Tedlar signage application claim](https://www.dupont.com/tedlar/tedlar-signage-applications.html). Select the image to open the full dashboard capture.

A previous run exposed an employer-domain mismatch between `agfa.com` and `careers.agfa.com`. The drafting stage rejected both outputs and recorded inspectable failures instead of surfacing drafts tied to an uncertain match. After the employer check was updated to recognize a verified parent/subdomain relationship, the complete single-run workflow produced both drafts. The result also exposed a remaining improvement: normalize company identities to the main corporate domain so research favors product pages rather than career pages, and describe title-based responsibility as likely rather than confirmed.

## 4. Explicit MVP bounds

These controls keep a live demonstration fast and limit provider spend. They are testing parameters, not intended production capacity.

| Control | Current value |
| --- | ---: |
| Primary event searches | Up to 3 queries |
| Results per primary event search | 10, or up to 30 before deduplication |
| Follow-up directory searches | Up to 5 events, 5 results each |
| Event relevance threshold | 0.5 |
| Events processed downstream per run | 1, with fallback if its directory fails |
| Companies extracted and enriched | Up to 10 |
| General company identity searches | 1 per company, up to 5 results |
| People returned by Surfe | Up to 10 per high-fit company |
| Contact relevance threshold | 70 / 100 |
| Outreach research | 1 search per company with selected contacts |

A production run could process every event that passes source checks, paginate complete directories, and search more companies and contacts. Scale would require configurable budgets, bounded concurrency, delayed retries, and a durable job queue. The MVP demonstrates the necessary stage boundaries and company-level failure isolation, not high-volume production execution itself.

## 5. Reliability and next steps

SQLite stores structured stage inputs, outputs, timestamps, providers, profiles, and errors. One company, people search, evaluation, research call, or draft can fail without stopping unrelated work. Automated verification currently includes 57 passing backend and application tests, TypeScript checking, a successful Next.js production build, and a browser-level ICP workflow test.

The most valuable next data layer is an internal company and people knowledge base. Companies would be identified by a verified canonical root domain, while people would use a stable provider or LinkedIn identifier. Successful enrichment, evidence, contacts, and prior qualification decisions could then be reused across events and ICP runs instead of purchasing and recomputing the same information repeatedly. Each field should retain its source and retrieval date, with freshness rules that refresh stale company facts and employment data rather than assuming cached information never changes.

The immediate priorities are to add association member directories as sources, normalize corporate domains, reconcile field-level evidence from multiple providers, calibrate qualification and contact selection with sales-labelled examples, and move long-running work to durable execution. The central lesson is that every downstream action depends on the previous decision: stronger source evidence improves company selection, verified identity improves qualification, and careful contact evaluation prevents a polished message from reaching the wrong person.
