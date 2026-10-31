# Phase 2 API contract

All API request bodies use `Content-Type: application/json`. The default body
limit is 65,536 bytes. Unknown `/api/*` paths and unsupported methods return the
same structured error format as validation and provider failures.

## Error shape

```json
{
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Description is required."
  }
}
```

The browser client accepts this Phase 2 shape and the Phase 1 string error
shape for compatibility. Errors omit provider response bodies, authorization
headers, credentials, stack traces, and filesystem paths.

## `POST /api/generate-regex`

Request:

```json
{
  "aiConfig": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "submitted-at-request-time",
    "customUrl": "",
    "customRequestTemplate": "...",
    "customResponsePath": "choices.0.message.content",
    "customApiKeyHeader": "Authorization",
    "customApiKeyPrefix": "Bearer"
  },
  "description": "Match an ISO date",
  "sampleText": "2026-10-30",
  "targetFlavor": "javascript"
}
```

`provider` is `anthropic`, `openai`, or `custom`. `targetFlavor` is
`javascript`, `python`, `pcre`, or `re2-go`. Description is required; sample
text can be empty. The successful response remains the Phase 1 generation
shape, including clarification responses and the optional provider, model, and
target metadata used by the frontend.

## `POST /api/explain-regex`

Request:

```json
{
  "aiConfig": { "provider": "openai", "model": "gpt-4o-mini", "apiKey": "..." },
  "pattern": "\\d+",
  "flags": "g",
  "sampleText": "123",
  "targetFlavor": "javascript"
}
```

The abbreviated `aiConfig` above represents the same complete settings object
as the generation route. Pattern is required. Flags and the pattern are
validated for the selected target before a provider is contacted. The success
response keeps the existing summary, annotations, warnings, and metadata
shape.

## `POST /api/test-provider`

Request:

```json
{
  "aiConfig": { "provider": "openai", "model": "gpt-4o-mini", "apiKey": "..." }
}
```

The complete settings object is required. A successful provider response
returns:

```json
{
  "ok": true,
  "provider": "openai",
  "model": "gpt-4o-mini"
}
```

## `GET /health`

Returns `{"status":"ok"}` with status 200. `HEAD /health` returns the same
status and headers without a body. This check confirms that the process can
serve requests and never contacts an AI provider.

## Validated limits

- Description and sample text: at most 4,000 characters each.
- Pattern: at most 10,000 characters.
- Flags: at most 32 characters and valid for the selected target.
- Model: required, trimmed, at most 200 characters.
- API key: required string, at most 16,384 characters.
- Custom endpoint URL: at most 2,048 characters.
- Custom request template: at most 16,384 characters and valid JSON after
  placeholder substitution.
- Custom response path: at most 500 characters.
- Custom auth header and prefix: at most 200 characters each; header names use
  HTTP token syntax and prefixes cannot contain line breaks.

Provider output may be plain JSON, JSON in a Markdown fence, or text containing
one JSON object. Generation and explanation outputs are schema-checked. One
retry is made when parsing or validation fails; a second invalid output returns
`PROVIDER_RESPONSE_INVALID` with status 502.
