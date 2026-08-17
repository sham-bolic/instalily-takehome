# Gemini model selection for ICP qualification

Reviewed: 2026-08-17

## Decision

Use **Gemini 3.7 Flash** (`gemini-3.7-flash`) as the default model for ICP qualification.

Keep **Gemini 3.5 Flash-Lite** (`gemini-3.5-flash-lite`) as the throughput and cost fallback.

## Why Gemini 3.7 Flash

The qualification step is not simple extraction. It must connect company evidence to five ICP criteria, distinguish missing evidence from negative evidence, produce concise rationales, and estimate confidence. That makes reasoning quality more important than minimum latency.

Gemini 3.7 Flash is Google's latest stable Flash model and is described as its most capable Flash model for agentic workflows and multimodal reasoning.[^models][^flash-37] It supports structured outputs and thinking, which match the existing Vercel AI SDK implementation's schema-constrained assessment.[^flash-37]

It is available with free input and output tokens on the Gemini API free tier.[^pricing] The paid standard price, if the project later exceeds free access, is currently listed as $0.75 per million input tokens and $3.75 per million output tokens through December 31, 2026.[^pricing]

The model ID is stable rather than preview or `latest`. Google recommends specific stable model names for most production applications because they usually do not change unexpectedly.[^models]

## Shortlist

| Model | Strength | Fit for this task | Decision |
| --- | --- | --- | --- |
| `gemini-3.7-flash` | Google's most capable stable Flash model, with structured output and configurable thinking | Best balance for nuanced evidence-based judgment | **Default** |
| `gemini-3.5-flash-lite` | Low latency and high throughput for simple processing and extraction | Good fallback if free-tier capacity or latency becomes a problem, but qualification is more nuanced than its primary use case | Fallback |
| `gemini-2.5-flash` | Stable price-performance model for high-volume tasks requiring thinking | Technically suitable, but now an older Flash generation | Do not select for new work |
| `gemini-2.5-flash-lite` | Explicitly designed for classification and simple extraction | The current implementation's default, but optimized more for speed and budget than judgment quality | Replace as default |
| `gemini-2.5-pro` | Deep reasoning over complex datasets and documents | More capability than this bounded five-criterion assessment needs | Do not use |

All shortlisted models support structured outputs.[^flash-37][^flash-lite-35][^flash-25][^flash-lite-25][^pro-25]

## Free-tier constraints

- Free-tier input and output tokens are free, but model access and request limits are restricted.[^pricing]
- Google applies limits per project across requests per minute, input tokens per minute, and requests per day. Google directs developers to AI Studio for the active limits because they can vary by model, tier, and account.[^rates]
- Content submitted through the free tier may be used to improve Google's products. Paid-tier content is not used for that purpose.[^pricing]
- Therefore, only send the public company evidence already collected by this prototype. Do not send confidential customer data, private CRM notes, or personal information through the free tier.

## Rollout recommendation

1. Change the default from `gemini-2.5-flash-lite` to `gemini-3.7-flash`.
2. Keep `GEMINI_MODEL` as an environment override so no qualifier code changes are needed to compare models.
3. Build a small fixed evaluation set with clear high-, medium-, low-, and insufficient-evidence companies.
4. Compare 3.7 Flash and 3.5 Flash-Lite on criterion accuracy, unsupported evidence citations, confidence calibration, latency, and retry rate.
5. Use 3.5 Flash-Lite only if it produces comparable decisions and the 3.7 Flash quota or latency is materially worse.

The application should continue calculating the final numeric score itself. The model should only assess evidence-backed criteria and confidence, as the current architecture does.

## Sources

[^models]: [Google Gemini API model catalog](https://ai.google.dev/gemini-api/docs/models)
[^flash-37]: [Gemini 3.7 Flash model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash)
[^flash-lite-35]: [Gemini 3.5 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite)
[^flash-25]: [Gemini 2.5 Flash model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash)
[^flash-lite-25]: [Gemini 2.5 Flash-Lite model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-lite)
[^pro-25]: [Gemini 2.5 Pro model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-2.5-pro)
[^pricing]: [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing)
[^rates]: [Google Gemini API rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)
