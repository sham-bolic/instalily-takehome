# Instalily AI Case Study Write-up

_Draft for the final three-page submission_

## 1. Overview and architecture

I built a working lead-generation and outreach prototype for DuPont Tedlar's Graphics & Signage team. A user defines an Ideal Customer Profile (ICP), starts a run, and receives a ranked list of companies found through public industry-event data. For high-fit companies, the same run finds potential decision-makers, evaluates whether each person is genuinely relevant, and drafts evidence-grounded outreach only for worthwhile contacts. The dashboard shows the event, company, verified website, available size data, qualification rationale, people, selection reasoning, and editable messages.

The demonstration ICP is based on DuPont's first-party product pages and brochures. It targets manufacturers and converters that could incorporate a clear protective overlaminate into durable graphic media, vehicle wraps, architectural graphics, outdoor signage, and similar products.

```text
Editable ICP
  -> Discover events and extract participating companies
  -> Resolve company identities and enrich profiles
  -> Assess and rank company fit
  -> Search high-fit companies for decision-makers with Surfe
  -> Use Gemini to score each person's relevance
  -> Research a first-party company signal
  -> Draft, review, edit, and copy personalized outreach
```

AI performs bounded research, extraction, assessment, and drafting tasks. Regular application code controls stage order, validates outputs, applies thresholds, saves progress, and isolates failures. The prototype uses Next.js and TypeScript, Tavily for public-web research, Playwright for interactive event directories, Gemini for structured extraction and decisions, Apollo for company enrichment, Surfe for people search and LinkedIn URLs, and SQLite for ICPs, runs, profiles, and processing history.

## 2. Workflow, limitations, and improvements

### 1. ICP definition

The dashboard collects the offering, target companies, applications, fit signals, size, geography, exclusions, and a representative company. Each run saves an unchanging ICP copy, so later edits cannot alter historical results.

**Limit and next step:** Results depend on the rubric's clarity. Add versioned positive, negative, and borderline examples, then test changes against a sales-labelled company set.

### 2. Event discovery and company extraction

Tavily searches for upcoming events using ICP-derived terms and stores URLs, summaries, relevance scores, and recognized participant directories. Playwright renders JavaScript-based directories and embedded frames. Gemini extracts up to ten companies, but application code accepts only names, evidence, and links present on the rendered page. Events without usable company sources are skipped rather than guessed.

**Limit and next step:** Event sources can be noisy, gated, paginated, or protected by bot checks. Add more recorded directory strategies and process every event passing source checks with bounded concurrency. The one-event and ten-company limits currently control test cost, not production capacity.

### 3. Company identity and enrichment

Each company receives a neutral Tavily search for its official website. Deterministic checks compare names, domains, titles, and result text while rejecting social networks, event platforms, and data brokers. Apollo can perform domain or name lookup, but its result is accepted only when the domain or normalized organization name confirms the sourced company. Successful enrichment is cached by domain. Unresolved identities remain skipped, and missing size or revenue remains unknown.

**Limit and next step:** Smaller companies have weaker public and provider coverage, creating discoverability bias. Combine independent providers, preserve field-level sources and retrieval dates, and display conflicts rather than silently overwriting them.

### 4. Company qualification and ranking

Gemini receives only the saved ICP and assembled company profile. It returns schema-validated `high`, `medium`, or `low` fit and confidence, a rationale, and supporting facts. Application code ranks by fit and then evidence confidence, not company size alone. Missing information lowers confidence instead of automatically implying low fit.

**Limit and next step:** The model cannot recover unsourced facts and may vary on borderline cases. Improve the evidence and criterion examples first, then measure prompt and model changes against a labelled evaluation set.

### 5. Stakeholder identification

Only `high`-fit companies proceed to Surfe. The search uses the verified company domain and looks for VP, Director, or Head contacts in Product Development, Innovation, R&D, Coatings, and Protective Solutions. It returns up to ten people with title, department, seniority, employer domain, and LinkedIn URL. The dashboard distinguishes matches, zero results, provider errors, and unsearched companies.

**Limit and next step:** A broad title match does not prove that someone should receive outreach, and provider coverage varies. Make role families configurable by ICP and compare Surfe with Sales Navigator, Clay, or another source. Enrich email only after selection to avoid unnecessary credits and personal-data handling.

### 6. Contact evaluation

Gemini evaluates all Surfe candidates for a company together using the ICP, company qualification rationale, title, seniority, and department. It assigns a 0-100 relevance score, confidence, and specific rationale based on whether the person's business area likely influences, evaluates, develops, or qualifies relevant products or materials. Seniority alone is explicitly insufficient.

Application code verifies that Gemini returned every supplied LinkedIn URL exactly once, rejects invented or duplicate people, sorts by score, and applies a fixed threshold of 70. Only selected contacts continue. If evaluation fails, nobody at that company receives a message.

**Limit and next step:** Titles remain imperfect proxies for responsibility, and 70 is a product policy rather than a calibrated conversion score. Use sales review to label candidate quality and tune the threshold.

### 7. Evidence-grounded outreach

For a company with selected contacts, Tavily performs one reusable search for first-party product, application, or strategy evidence. Gemini drafts a three- or four-sentence note from the person's role, company qualification, at most two validated company facts, and one claim from a versioned set of DuPont product claims. It must include a factual reason for writing, a cautious role connection, one Tedlar benefit, and a low-pressure question. It cannot invent responsibilities, pains, budgets, current materials, or results, and it cannot ask for a meeting.

Application code rejects unknown evidence IDs, unknown product claims, or an employer-domain mismatch. When first-party evidence is unavailable, drafting can safely fall back to role and qualification context with lower confidence. The dashboard explains why the person and company were selected and provides an editable, copyable message. It does not send automatically.

**Limit and next step:** Add sales feedback on message usefulness and track which evidence and angles lead to replies. Sending should remain a separate reviewed action with CRM, consent, and suppression-list controls.

### 8. Reliability and scale

SQLite stores stage inputs, structured outputs, timestamps, providers, and errors. One failed company, people search, evaluation, research call, or draft does not stop the others. Completed event discovery can be reused after failure, and another discovered event can start a downstream run without repeating discovery.

**Limit and next step:** In-process execution fits an MVP, not high-volume parallel work. Production should estimate provider spend before starting, use bounded concurrency and delayed retries, support targeted stage retry, and move long work to a durable job system.

## 3. Implementation results and lessons

The latest saved live Graphics & Signage run completed in about 61 seconds:

| Stage | Observed result |
| --- | ---: |
| Public event candidates discovered | 28 |
| Candidates with a usable company source | 8 |
| Event used for sourcing | PRINTING United Expo |
| Companies extracted | 10 |
| Company identities resolved and assessed | 8 |
| Identities safely left unresolved | 2 |
| High-fit / low-fit companies | 1 / 7 |
| High-fit companies sent to Surfe | 1 |
| Potential decision-makers returned | 2 |
| Contacts selected by Gemini | 2 |
| Personalized messages drafted | 2 |

Agfa Corporation was the high-fit company. Surfe returned Andy Clifton, Head of Innovation, and Bart Verlinden, Head of R&D, with LinkedIn profile URLs. A linked outreach run then evaluated both people together, researched Agfa once, and drafted two messages in about 3.5 seconds. Gemini scored Bart 85 and Andy 75, both with high confidence and above the 70-point threshold. Bart ranked higher because R&D is more directly connected to product development and material evaluation than a general innovation function.

Both drafts used a first-party Agfa source describing its inkjet printing technologies and industrial applications, then connected that evidence to DuPont's approved claim that Tedlar Clear Protection film protects outdoor graphics against UV exposure and fading. Each draft cited the exact company evidence and product claim it used, carried high confidence with no warnings, and remained editable rather than being sent automatically.

The first outreach attempt also demonstrated the safety boundary: both drafts were blocked because Surfe reported `agfa.com` while the saved company profile used `careers.agfa.com`. The run completed with two inspectable draft failures rather than sending uncertain output. After the employer check was updated to recognize a verified parent/subdomain relationship, the 3.5-second rerun produced both drafts successfully.

The live output also exposed useful precision gaps. Identity resolution retained `careers.agfa.com` instead of normalizing to Agfa's main domain, so outreach research favored career pages rather than stronger product pages. Gemini's role rationale also inferred material-selection responsibility from an R&D title more strongly than the evidence supported. These are concrete next steps: normalize domains to the appropriate company root, rank product pages above career pages, and validate that role rationales distinguish title-based likelihood from confirmed responsibility.

The seven low-fit results were also useful. PRINTING United included apparel suppliers, software vendors, equipment distributors, and substrate manufacturers that shared event relevance but lacked the ICP's ability to incorporate a protective overlaminate. The pipeline retained those assessments rather than confusing attendance or size with product fit.

Earlier runs exposed a company identity problem: event directories often publish names without websites, while name-only provider matches can be ambiguous. Adding public-web identity verification changed the outcome from skipping all ten companies to safely resolving most of them. The lesson is to preserve evidence, expose failure, avoid guesses, and turn live edge cases into regression tests.

The stage boundaries support more events, companies, and people, but the current bounds are cost controls. Higher scale requires multi-event orchestration, bounded concurrency, durable execution, and provider budgets. Automated verification currently includes 63 passing backend and application tests covering the pipeline through contact selection and drafting, plus TypeScript checking, a successful Next.js production build, and a browser-level ICP workflow test.

## 4. Improvement priorities

1. Improve event sources and company identity coverage.
2. Preserve and reconcile field-level evidence from multiple providers.
3. Normalize company domains and prioritize product evidence over career pages.
4. Calibrate company, contact, and rationale quality with sales-labelled examples.
5. Add reviewed CRM sending, suppression controls, and post-selection contact enrichment.
6. Add durable execution, bounded concurrency, provider budgets, and targeted retry.

The central lesson is that each downstream action depends on the previous decision. Better event evidence improves company selection; verified identity improves qualification; and careful contact evaluation prevents a polished message from reaching the wrong person.
