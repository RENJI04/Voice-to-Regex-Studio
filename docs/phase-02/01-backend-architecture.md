# Phase 2 backend architecture

## Decision

Phase 2 uses the native Node.js HTTP server with a thin router. Renex has three
API operations and a health check, so a framework would add dependency and
deployment overhead without simplifying the current boundary. The server is
compiled from TypeScript to `dist-server/`; the Vite frontend is built to
`dist/`.

The production process serves both the built frontend and the API. This keeps
the preferred deployment topology same-origin:

```text
Browser
  -> Renex web origin
     -> static frontend files
     -> /api/*
        -> Renex service layer
           -> Anthropic, OpenAI, or a configured custom provider
```

The production backend does not depend on Vite. During local development, the
Vite plugin delegates API requests to the same HTTP handler and service modules
used by the production server.

## Module boundaries

- `server/index.ts` loads runtime configuration and starts the process.
- `server/httpServer.ts` composes API and static-file handling.
- `server/http/` owns routing, body parsing, JSON responses, headers, and
  static frontend delivery.
- `server/api/validation.ts` validates and normalizes every public request.
- `server/services/aiService.ts` coordinates generation, explanation, and
  provider connection tests.
- `server/providers/index.ts` isolates Anthropic, OpenAI, and custom HTTP
  behavior.
- `server/ai/` owns prompts, provider JSON parsing, response validation, and
  the single retry after invalid model output.
- `server/regex/validation.ts` owns target-specific flags and pattern checks.
- `server/errors.ts` normalizes failures into the public API error model.
- `shared/ai.ts` contains route names and browser/server contract types.
- `server/aiRegexPlugin.ts` is only the Vite development adapter.

## Request flow

1. The HTTP layer selects a known route and enforces the method.
2. The body reader requires JSON and enforces the configured byte limit.
3. Route-specific validation checks every accepted field.
4. The service creates one provider adapter and invokes the requested action.
5. The provider adapter applies a bounded timeout and rejects redirects.
6. Generation and explanation responses are parsed and validated. Invalid AI
   output is retried once with a stricter JSON-only instruction.
7. The HTTP layer returns the successful contract or a normalized error.

## Runtime configuration

| Variable | Default | Constraint | Purpose |
| --- | ---: | --- | --- |
| `RENEX_PORT` | `3000` | integer 1-65535 | Production listen port |
| `PORT` | `3000` | integer 1-65535 | Fallback platform port when `RENEX_PORT` is absent |
| `RENEX_ALLOWED_ORIGIN` | unset | exact HTTP(S) origin | Optional separate-frontend origin |
| `RENEX_PROVIDER_TIMEOUT_MS` | `15000` | integer 100-120000 | Outbound provider deadline |
| `RENEX_MAX_BODY_BYTES` | `65536` | integer 1024-1048576 | Maximum API request body |

Invalid values fail during process startup. Runtime configuration contains no
provider credentials.

## Deployment topologies

The supported default is one Node process behind one HTTPS origin. Run the
build, then `npm start`; the process serves `dist/` and `/api/*` together.

A separately hosted frontend can call the backend by absolute URL only after
the frontend client and deployment routing are configured for that topology.
Set `RENEX_ALLOWED_ORIGIN` to the frontend's exact origin. The API returns no
wildcard CORS header. Same-origin deployment requires no CORS configuration.
