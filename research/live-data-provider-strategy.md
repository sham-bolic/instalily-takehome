# Live-data provider strategy

## Decision

Use **Tavily as the MVP's primary public-web provider** for Event Source discovery, event-site traversal, page extraction, and public company research. Keep provider calls behind narrow interfaces so another search or extraction provider can replace it.

Use the fallback chain below:

1. Tavily Search to discover event, exhibitor, association, and company pages.
2. Tavily Map and Extract or Crawl for relevant event and company sites.
3. A basic direct HTTP/HTML extractor for accessible static pages.
4. Firecrawl as an optional, manually enabled fallback for JavaScript-heavy or difficult pages.
5. Persisted raw sources and structured results from a known-good DuPont Tedlar run as the final demo fallback.

For company enrichment, use public company and event evidence through Tavily in the core MVP. Add an enrichment-provider adapter with **Apollo Organization Enrichment** as the first optional implementation if credentials are available. Do not make Apollo, People Data Labs, LinkedIn, or Clay access a condition of the core demo.

## Why

- Tavily combines search results with URLs, content, relevance scores, and usage metadata. Its Map endpoint discovers site URLs, and its Crawl and Extract endpoints return page content. This covers the core event-to-company workflow with one credential and one billing model.[^tavily-search][^tavily-map][^tavily-extract][^tavily-crawl]
- Tavily includes 1,000 free monthly credits. Basic Search costs one credit, and every five successful basic extractions costs one credit. Pay-as-you-go is listed at $0.008 per credit, leaving substantial room under the case study's $200 budget.[^tavily-pricing]
- Tavily says failed URL extractions are not charged. This is useful when public event sites vary significantly in quality.[^tavily-pricing]
- Firecrawl supports search, scraping, crawling, mapping, browser interaction, and structured extraction, making it a useful escape hatch. It is not the default because it uses subscription plans, charges when processed pages return errors such as 403 or 404, and adds four credits per page for JSON extraction or enhanced mode.[^firecrawl-billing][^firecrawl-extract]
- Apollo Organization Enrichment can match by domain, LinkedIn URL, name, or website and may return industry, revenue, employee count, funding, location, and hierarchy data. Its official pricing documentation lists organization enrichment at one credit per company.[^apollo-enrichment][^apollo-pricing]
- People Data Labs is a viable second enrichment adapter: it supports one-to-one company matching, charges per successful match, exposes a match-likelihood score, and has a free-tier rate limit of ten requests per minute. Its exact plan cost was not available in the reviewed endpoint documentation, so it is not the first MVP choice.[^pdl-enrichment]

## Guardrails for the plan

- Store every fetched URL, retrieval time, provider, provider request ID when available, and raw content hash.
- Keep LLM extraction separate from retrieval. Validate structured output against schemas and retain claim-to-source links.
- Apply hard per-run limits for searches, crawled pages, enrichment calls, retries, and estimated spend.
- Cache by provider, normalized request, and freshness window. Never present cached data as fresh.
- Treat provider failure as a partial run, not permission to invent missing facts.
- Before the demo, execute and pin one complete DuPont Tedlar run, then verify the dashboard can load it without network access.

## Sources

[^tavily-search]: [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
[^tavily-map]: [Tavily Map API](https://docs.tavily.com/documentation/api-reference/endpoint/map)
[^tavily-extract]: [Tavily Extract API](https://docs.tavily.com/documentation/api-reference/endpoint/extract)
[^tavily-crawl]: [Tavily Crawl API](https://docs.tavily.com/documentation/api-reference/endpoint/crawl)
[^tavily-pricing]: [Tavily credits and pricing](https://docs.tavily.com/documentation/api-credits)
[^firecrawl-billing]: [Firecrawl billing](https://docs.firecrawl.dev/billing)
[^firecrawl-extract]: [Firecrawl Extract API](https://docs.firecrawl.dev/api-reference/endpoint/extract)
[^apollo-enrichment]: [Apollo Organization Enrichment](https://docs.apollo.io/docs/organization-enrichment)
[^apollo-pricing]: [Apollo API pricing and credits](https://docs.apollo.io/docs/api-pricing)
[^pdl-enrichment]: [People Data Labs Company Enrichment API](https://docs.peopledatalabs.com/docs/reference-company-enrichment-api)
