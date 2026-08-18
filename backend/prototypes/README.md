# Live sourcing prototypes

> THROWAWAY PROTOTYPES. These are learning tools, not the production implementation.

The sourcing flow is split into independent probes so each stage can be tested before the next one is built:

1. Event sourcing: ICP in, event candidates out
2. Company sourcing: selected event in, company candidates out
3. Company enrichment: selected company in, factual company profile out
4. Company qualification: enriched profile and ICP in, evidence-backed assessment out

All four stages are connected by a lean pipeline orchestrator. Qualification uses Gemini 3.7 Flash through the Vercel AI SDK.

## Run the connected pipeline

Pass the ICP as a command-line argument:

```bash
npm run pipeline -- \
  "Companies making durable large-format signage, vehicle wraps, architectural graphics, and protective graphic films"
```

The pipeline:

1. Discovers events and keeps those with a recognized company directory and a Tavily relevance score of at least `0.7`.
2. Tries the highest-scoring event first, falling back to the next qualifying event if its directory fails.
3. Sources companies from the first working directory.
4. Skips and records companies without a published website.
5. Enriches at most five companies with Apollo, reusing earlier successful artifacts when available.
6. Assesses each enriched company against the ICP with Gemini and validates the structured response.
7. Ranks companies by categorical fit and confidence.
8. Continues after individual enrichment or qualification failures and records them for inspection.

Event discovery is a required stage. A run fails when discovery fails, no event meets the threshold, or no qualifying event has a usable directory. Individual company failures do not fail the run.

## Setup

Install the dependencies:

```bash
npm install
```

Copy the example environment file and add the keys required by the stages you want to run:

```bash
cp .env.example .env
```

The connected pipeline requires `TAVILY_API_KEY`, `APOLLO_API_KEY` for uncached companies, and `GOOGLE_GENERATIVE_AI_API_KEY`.

Google's Gemini free tier may use submitted content to improve its products. Do not send confidential, personal, or otherwise sensitive data through the free tier.

## SQLite persistence

The lean SQLite model contains runs, immutable stage artifacts, and assembled company profiles. A run can represent a complete pipeline, an independently executed probe, or a cached demo. Flexible provider responses are stored as JSON artifacts inside SQLite instead of being forced into a fixed schema.

Each standalone stage command creates a `probe` run and records its input and output. Technical failures are recorded too, so a failed call can be inspected. Apollo enrichment reuses the latest successful artifact for a domain unless `--refresh` is passed. The raw Apollo response remains a stage artifact and is not treated as a normalized company profile.

Open the Next.js lead intelligence dashboard with:

```bash
npm run dashboard
```

Then visit [http://localhost:4173](http://localhost:4173). The dashboard stores multiple named ICPs in SQLite. Choose one from the pipeline target dropdown or use **Add ICP** to open the prefilled DuPont Tedlar form. Creating an ICP formats the supplied answers without web research or an LLM. Clicking **Run pipeline** starts the complete live pipeline with an immutable copy of the selected ICP. The dashboard polls while a run is active and presents ranked company, event, qualification rationale, evidence, size, and revenue data as it becomes available. Raw stage artifacts remain available in the collapsed developer trace. Set `PORT` to use another port.

Create and serve an optimized production build with `npm run build` followed by `npm start`. The dashboard uses the Next.js Node runtime because its SQLite driver is not compatible with the Edge runtime.

For terminal-based inspection, list all runs or inspect one run with:

```bash
npm run db:inspect
npm run db:inspect -- 1
```

## Test event sourcing

Pass the ICP as a command-line argument:

```bash
npm run event-sourcing -- \
  "Companies making durable large-format signage, vehicle wraps, architectural graphics, and protective graphic films"
```

The npm script loads `.env` into `process.env`, and the prototype reads `process.env.TAVILY_API_KEY`. It saves the response as a SQLite stage artifact, including:

- When the search ran
- The external ICP
- The exact Tavily query
- Tavily's request ID
- Up to three event candidates
- A public company-source URL when the result is an exhibitor, sponsor, speaker, or participant list
- The source summary and relevance score

Each execution remains available under its own probe run.

The prototype searches directly for participant pages on official event websites. It makes one Tavily request using `basic` search and caps the response at three results to limit credit usage. `company_source` is `null` when a result does not contain a recognizable participant list. No event is automatically selected. First inspect the saved results and explicitly pass an event with an exhibitor directory to company sourcing.

## Test company sourcing

Pass a selected event and its official exhibitor-directory URL as separate command-line arguments:

```bash
npm run company-sourcing -- \
  "MRO Europe 2026" \
  "https://exhibitor.mroeurope.aviationweek.com/eu26/public/Exhibitors.aspx?CatID=1000252"
```

This stage does not receive or evaluate the ICP. It fetches the official directory directly, extracts up to ten exhibitors, and preserves the directory URL as attendance evidence. When the directory links to exhibitor profiles, it also fetches those profiles and extracts the exhibitor's stated company website as `company_url`. It does not call Tavily, so rerunning it does not consume search credits.

`profile_url` identifies the exhibitor's event profile. `company_url` identifies the company's own website and should be used as the input to enrichment. If the directory does not publish a company website, `company_url` remains `null` rather than being guessed.

Results are saved as a SQLite stage artifact under a new probe run.

## Test company enrichment

Pass an official company URL directly:

```bash
npm run company-enrichment -- "https://www.abc-int.it"
```

The prototype derives the domain and sends the website and domain to Apollo. It does not load company-sourcing results, accept a company name, or fall back to name-based matching. Connecting a sourced company to this stage is the future orchestrator's responsibility.

The response is deliberately not normalized yet. Until real Apollo responses have been inspected, the result contains the request metadata and complete raw provider response. The ICP is not an input because this stage only collects facts.

The latest successful SQLite artifact for a domain is reused without calling Apollo again. To deliberately spend another credit and record a fresh artifact, pass `--refresh`:

```bash
npm run company-enrichment -- "https://www.abc-int.it" --refresh
```

Apollo charges one credit per organization enrichment. The script makes no request when `APOLLO_API_KEY` is missing or a cached result exists. The persisted provider response should be inspected before deciding which fields to normalize.

## Known limitations

- Event search can return third-party participant-list vendors instead of the event's own website. The current prototype preserves the URL but does not yet verify that the event owns its domain.
- Company extraction currently recognizes linked exhibitor profiles and HTML tables with company and booth columns. Other directory layouts will need additional extraction strategies.
- Plain-text exhibitor tables, such as the SUN 'n FUN directory, do not provide company websites. Resolving those companies would require a separate identity-resolution step or external API.
- Apollo fields can be absent, especially for small or private companies. Missing values remain `null`; the prototype does not infer them or fall back to another provider.
- Company enrichment does not yet search company websites or identify decision-makers.
- Qualification receives the assembled profile, including the raw Apollo response. That response has not yet been normalized into first-class evidence claims and source records.
- Free Gemini API quotas can change and may throttle a multi-company run. Qualification failures remain isolated to the affected company.
