# Live sourcing prototypes

> THROWAWAY PROTOTYPES. These are learning tools, not the production implementation.

The sourcing flow is split into independent probes so each stage can be tested before the next one is built:

1. Event sourcing: ICP in, event candidates out
2. Company sourcing: selected event in, company candidates out
3. Company deep dive: selected company in, evidence out

Event sourcing exists so far.

## Setup

Install the dependencies:

```bash
npm install
```

Copy the example environment file and add your Tavily key:

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

## Known limitations

- Event search can return third-party participant-list vendors instead of the event's own website. The current prototype preserves the URL but does not yet verify that the event owns its domain.
