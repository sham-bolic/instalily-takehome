# Live sourcing prototypes

> THROWAWAY PROTOTYPES. These are learning tools, not the production implementation.

The sourcing flow is split into independent probes so each stage can be tested before the next one is built:

1. Event sourcing: ICP in, event candidates out
2. Company sourcing: selected event in, company candidates out
3. Company enrichment: selected company in, factual company profile out

All three stages now exist. Qualification against an ICP remains a separate future stage.

## Setup

Install the dependencies:

```bash
npm install
```

Copy the example environment file and add the key required by the stage you want to run:

```bash
cp .env.example .env
```

## Test event sourcing

Pass the ICP as a command-line argument:

```bash
npm run event-sourcing -- \
  "Companies making durable large-format signage, vehicle wraps, architectural graphics, and protective graphic films"
```

The npm script loads `.env` into `process.env`, and the prototype reads `process.env.TAVILY_API_KEY`. It saves the response to `backend/prototypes/results/event-sourcing.json`, including:

- When the search ran
- The external ICP
- The exact Tavily query
- Tavily's request ID
- Up to three event candidates
- A public company-source URL when the result is an exhibitor, sponsor, speaker, or participant list
- The source summary and relevance score

Each run replaces the previous result file, so later prototypes can use it without calling Tavily again.

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

Results are saved to `backend/prototypes/results/company-sourcing.json`. Each run replaces the previous company result file.

## Test company enrichment

Pass an official company URL directly:

```bash
npm run company-enrichment -- "https://www.abc-int.it"
```

The prototype derives the domain and sends the website and domain to Apollo. It does not load company-sourcing results, accept a company name, or fall back to name-based matching. Connecting a sourced company to this stage is the future orchestrator's responsibility.

The response is deliberately not normalized yet. Until real Apollo responses have been inspected, the result contains the request metadata and complete raw provider response. The ICP is not an input because this stage only collects facts.

Each result is saved separately under `backend/prototypes/results/company-enrichment/<domain>.json`. A saved result is reused without calling Apollo again. To deliberately spend another credit and replace it, pass `--refresh`:

```bash
npm run company-enrichment -- "https://www.abc-int.it" --refresh
```

Apollo charges one credit per organization enrichment. The script makes no request when `APOLLO_API_KEY` is missing or a cached result exists. The persisted provider response should be inspected before deciding which fields to normalize.

## Known limitations

- Event search can return third-party participant-list vendors instead of the event's own website. The current prototype preserves the URL but does not yet verify that the event owns its domain.
- Company extraction currently recognizes linked exhibitor profiles and HTML tables with company and booth columns. Other directory layouts will need additional extraction strategies.
- Plain-text exhibitor tables, such as the SUN 'n FUN directory, do not provide company websites. Resolving those companies would require a separate identity-resolution step or external API.
- Apollo fields can be absent, especially for small or private companies. Missing values remain `null`; the prototype does not infer them or fall back to another provider.
- Company enrichment does not yet search company websites, qualify companies against an ICP, or identify decision-makers.
