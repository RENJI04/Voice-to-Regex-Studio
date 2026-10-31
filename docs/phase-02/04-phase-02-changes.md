# Phase 2 changes

## Production runtime

- Added a compiled native Node HTTP server and an explicit `npm start` command.
- Added built frontend delivery with SPA fallback from the same process.
- Added a provider-independent `GET /health` readiness endpoint.
- Added validated runtime settings for port, allowed origin, provider timeout,
  and request body size.

## Shared backend core

- Reduced `server/aiRegexPlugin.ts` to a Vite development adapter.
- Extracted routing, request bodies, validation, prompts, response parsing,
  regex checks, providers, services, configuration, and errors into separate
  modules used by both development and production.
- Retained the existing generation, explanation, and provider-test route names
  and successful response shapes.
- Retained the one-time retry for invalid provider JSON.

## Validation and failure handling

- Added explicit field and length checks for all public request payloads.
- Added a consistent `{ error: { code, message } }` response and compatible
  frontend parsing.
- Added bounded provider requests with aborts and distinct timeout errors.
- Disabled outbound redirects and stopped returning raw provider response
  bodies in errors.
- Added minimal safe request logs with no body or headers.
- Added exact-origin CORS behavior only when an allowed origin is configured.

## Provider adapters

- Preserved Anthropic Messages and OpenAI Chat Completions integrations.
- Isolated custom template rendering, authentication, URL handling, and
  response-path extraction in the custom provider adapter.
- Added HTTP(S)-only custom URL validation and embedded-credential rejection.

## Tests and documentation

- Added production HTTP tests with mocked outbound requests for all three
  provider adapters, route validation, timeout behavior, normalized failures,
  credential non-disclosure, CORS, retry behavior, and health checks.
- Added runtime configuration tests.
- Added Phase 2 architecture, contract, trust boundary, change, and
  verification documents.
- Updated the README and environment example for production operation.

Phase 2 did not add authentication, accounts, a database, rate limiting,
quotas, billing, shared provider secrets, destination allowlisting, or hardened
SSRF controls.
