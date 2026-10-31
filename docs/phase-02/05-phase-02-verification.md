# Phase 2 verification

## Reproducible checks

Run from the repository root:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
npm run test:backend
```

`npm run test` includes both the existing fixture regression suite and the new
backend suite. The explicit backend command is retained so the production API
checks can be run independently.

## Backend coverage

The automated tests use an ephemeral local production server and mocked
outbound `fetch` implementations. They cover health and HEAD behavior, method
rejection, unknown routes, content type, invalid JSON, body limits, required
fields, flags, patterns, provider and target validation, timeout aborts, failure
normalization, credential non-disclosure, the OpenAI/Anthropic/custom adapters,
custom URL schemes, explanation annotations, provider output retry behavior,
provider connection tests, exact-origin CORS, and runtime configuration.

No live provider credential is used. Passing mocked tests confirms request and
response integration at the adapter boundary; it does not confirm the current
availability or model support of an external provider account.

## Recorded Phase 2 result

The final clean validation completed with Node.js 24 and the committed
lockfile:

- `npm ci`: passed; 106 packages installed.
- `npm run typecheck`: passed.
- `npm run lint`: passed with no warnings.
- `npm run test`: passed; 5 prompt behavior cases against 11 fixtures and 33
  backend tests.
- `npm run build`: passed; Vite frontend and TypeScript backend outputs built.
- `npm run test:backend`: passed independently; 33 tests.

No live provider credential or external provider request was used.

## Manual production checks

After `npm run build`, start the compiled server:

```bash
RENEX_PORT=3000 npm start
```

The compiled server was started with `RENEX_PORT=4179 npm start`. Direct HTTP
requests confirmed:

- `GET /` returned the built Renex HTML with status 200.
- `GET /health` returned `{"status":"ok"}` with status 200.
- Missing-key requests to `/api/generate-regex`, `/api/explain-regex`, and
  `/api/test-provider` each returned a structured `INVALID_REQUEST` response
  with status 400 and did not contact a provider.
- Structured request logs contained method, path, status, duration, and error
  code only.
