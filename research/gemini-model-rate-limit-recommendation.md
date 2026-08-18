# Gemini model recommendation for high-volume pipeline testing

Date: 2026-08-18

## Recommendation

Use `gemini-3.5-flash-lite` for company-directory extraction and company qualification. For repeatable, high-volume testing, enable Gemini API paid Tier 1 rather than designing around the free tier's requests-per-day allowance.

This model matches the pipeline's work well: Google describes it as a stable, generally available model optimized for high-throughput, low-cost execution, simple data extraction, and structured outputs. The current code needs structured extraction and bounded classification rather than complex coding or long-horizon reasoning.[^model]

At standard paid pricing, Gemini 3.5 Flash-Lite costs $0.30 per million input tokens and $2.50 per million output tokens. Batch and Flex inference cost $0.15 per million input tokens and $1.25 per million output tokens.[^pricing]

## Why an exact public request ceiling is not listed here

Google's current public rate-limit documentation no longer publishes a fixed RPM/RPD table by model. It says limits depend on model, usage tier, and account status, and directs users to the authenticated Google AI Studio rate-limit page for the project's active limits. Google also says specified limits are not guaranteed and actual capacity can vary.[^limits]

Therefore, an exact free-tier RPD number copied from a blog or an older quota table would not be reliable for this project. Check the active project-specific ceiling at:

<https://aistudio.google.com/rate-limit?timeRange=last-28-days>

Rate limits apply per Google Cloud project, not per API key, and daily quotas reset at midnight Pacific time.[^limits]

## Why paid Tier 1 is the robust testing option

Google positions the free tier for developers and small projects and the paid tier for production applications requiring higher volume. Paid Tier 1 becomes available after linking an active billing account. The billing documentation lists a $250 billing-tier cap for Tier 1, while model usage is still charged by tokens.[^limits][^pricing]

For this pipeline, the low token prices of Flash-Lite make a budget cap more useful than a small hard daily request allowance. A daily request limit can halt a run regardless of how small each request is, while token billing lets many lightweight extraction and classification calls complete.

## Alternatives

- `gemini-3.1-flash-lite`: also stable and explicitly intended for high-volume structured extraction and classification. It is slightly cheaper on paid standard inference at $0.25 per million text input tokens and $1.50 per million output tokens, but 3.5 Flash-Lite is the newer high-throughput model.[^model-31][^pricing]
- `gemini-2.5-flash-lite`: suitable for high-volume classification and extraction, but it is an older model with a January 2025 knowledge cutoff. The pipeline does not depend on model knowledge, but there is little reason to choose it over the newer stable Flash-Lite models unless its project-specific free quota is materially higher.[^model-25]
- `gemini-3.7-flash`: unnecessarily capable and quota-constrained for these bounded tasks. Keep it only as an optional fallback for assessments that fail validation on Flash-Lite.

## Implementation direction

Make the model configurable instead of hardcoding it in two files:

```text
GOOGLE_GENERATIVE_AI_MODEL=gemini-3.5-flash-lite
```

Use that setting for both company sourcing and qualification. If quality testing shows directory extraction needs a stronger model, split the setting by stage and keep qualification on Flash-Lite.

[^limits]: Google, [Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits), updated 2026-08-13.
[^pricing]: Google, [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing), accessed 2026-08-18.
[^model]: Google, [Gemini 3.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite), updated 2026-07-30.
[^model-31]: Google, [Gemini 3.1 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), updated 2026-07-21.
[^model-25]: Google, [Gemini 2.5 Flash-Lite](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite), updated 2026-06-23.
