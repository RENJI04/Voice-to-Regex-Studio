# Renex

**AI-Powered Regex IDE**

Renex is an AI-powered regex development platform for generation, testing, and
explanation across JavaScript, Python `re`, PCRE, and RE2/Go targets. Phase 3
adds a tested network and abuse-control boundary to the deployable backend.

## Implemented today

- Natural-language regex generation through Anthropic, OpenAI Chat
  Completions, or a configurable custom HTTP endpoint.
- Regex-to-English explanations with token-level annotations.
- Explicit API validation, structured errors, bounded provider requests, and a
  provider-independent health endpoint.
- DNS-aware SSRF controls with public-address enforcement and pinned custom
  provider connections.
- Bounded provider responses, API rate limiting, explicit proxy trust, safe
  custom headers, and production response security headers.
- A native Node production server that serves the built frontend and the three
  same-origin AI API routes.
- A debounced browser regex sandbox with Web Worker evaluation, match
  highlighting, capture groups, and zero-width match handling.
- Browser-local pattern history, shareable URL state, Web Speech input, copy
  actions, and light/dark themes.
- A curated fixture regression suite and production backend tests with mocked
  provider traffic.

Renex does not yet include authentication, accounts, a database, persistent or
distributed quotas, distributed rate limiting, shared server-managed
credentials, billing, or an enterprise observability stack.

## Requirements

- Node.js 24 (the version used by the current development environment).
- npm with the committed `package-lock.json`.
- Python on `PATH` for server-side validation of Python `re` patterns.

## Development

```bash
git clone https://github.com/RENJI04/Voice-to-Regex-Studio.git
cd Voice-to-Regex-Studio
npm ci
npm run dev
```

Vite serves the frontend and delegates `/api/*` to the same core handler used
by production. No build-time API key is required.

## Production

```bash
npm ci
npm run build
npm start
```

The build produces the frontend in `dist/` and the Node backend in
`dist-server/`. `npm start` listens on port 3000 by default and serves both.
Static hosting alone does not provide the AI routes.

Optional runtime settings are documented in `.env.example`:

- `RENEX_PORT` (or platform fallback `PORT`)
- `RENEX_ALLOWED_ORIGIN`
- `RENEX_PROVIDER_TIMEOUT_MS`
- `RENEX_MAX_BODY_BYTES`
- `RENEX_REQUEST_BODY_TIMEOUT_MS`
- `RENEX_MAX_PROVIDER_RESPONSE_BYTES`
- `RENEX_DNS_TIMEOUT_MS`
- `RENEX_CUSTOM_PROVIDER_MODE`
- `RENEX_CUSTOM_PROVIDER_HOSTS`
- `RENEX_CUSTOM_PROVIDER_PORTS`
- `RENEX_RATE_LIMIT`
- `RENEX_RATE_LIMIT_WINDOW_MS`
- `RENEX_RATE_LIMIT_MAX_CLIENTS`
- `RENEX_TRUST_PROXY`

The preferred production topology is browser to Renex web origin to `/api/*`
to the selected AI provider. A separately hosted frontend requires its exact
origin in `RENEX_ALLOWED_ORIGIN`; wildcard CORS is not enabled.

## Commands

```bash
npm run dev              # Vite frontend plus shared development API adapter
npm run typecheck        # Strict TypeScript project checks
npm run lint             # Oxlint
npm run test             # Regression suite plus backend tests
npm run test:regression  # Curated regex regression suite
npm run test:backend     # Production HTTP and provider adapter tests
npm run test:security    # Dedicated Phase 3 security controls
npm run build            # Build frontend and production backend
npm start                # Run the compiled production backend
npm run preview          # Preview only the static frontend build
```

## API and architecture

The production API preserves these frontend routes:

- `POST /api/generate-regex`
- `POST /api/explain-regex`
- `POST /api/test-provider`
- `GET /health`

The browser application is React 19 and TypeScript. Shared route names and
contracts live in `shared/ai.ts`. The production entry point is
`server/index.ts`; routing, validation, provider adapters, AI logic, and error
normalization are separate server modules. `server/aiRegexPlugin.ts` is a thin
Vite adapter over the shared API handler.

See the Phase 2 documents for the detailed
[architecture](docs/phase-02/01-backend-architecture.md),
[API contract](docs/phase-02/02-api-contract.md), and
[trust boundaries](docs/phase-02/03-trust-boundaries.md).
Phase 3 security behavior and residual risk are documented in the
[threat model](docs/phase-03/01-threat-model.md) and
[outbound policy](docs/phase-03/02-ssrf-and-outbound-policy.md).

## Provider credentials and browser storage

Renex retains the bring-your-own-key flow. Users enter provider settings in the
browser; the frontend sends the complete configuration to the same-origin
backend for each AI operation, and the backend forwards the key to the selected
provider. The backend receives the key during request processing. It does not
persist it, log request bodies or authorization headers, write it to disk, or
include it in error responses.

The frontend continues to persist provider settings, including the API key, in
browser localStorage. Phase 2 preserves the legacy compatibility keys:

- `voice-to-regex-studio:ai-settings`
- `voice-to-regex-studio:pattern-history`
- `voice-to-regex-studio:theme`

Do not place real provider keys in `.env` files, source code, documentation,
issue reports, or commits.

## Security boundary

API bodies default to 64 KiB with a 10-second full-body deadline. Provider
requests default to a 15-second deadline and a 1 MiB response ceiling. Custom
destinations are resolved before connection; every A and AAAA result must be a
public address, and the production transport pins socket lookup to the approved
set. Redirects are rejected. Operators can disable custom providers or require
an exact hostname allowlist and configure allowed destination ports.

AI API routes use a bounded, fixed-window in-memory rate limiter. Direct client
addresses are used unless `RENEX_TRUST_PROXY=true`; forwarding headers are
ignored by default. Trusted-proxy mode supports exactly one trusted reverse
proxy that appends the real source address as the rightmost XFF value and blocks
direct backend access; it is not arbitrary proxy-chain trust. The limiter resets
on restart and does not coordinate across replicas. Authentication,
authorization, distributed limits and quotas, a shared credential vault,
WAF/CDN controls, account abuse scoring, and enterprise observability remain
deferred.

## Project structure

```text
docs/phase-01/           Phase 1 audit, roadmap, and verification
docs/phase-02/           Backend architecture, contracts, and verification
docs/phase-03/           Threat model, security policy, and verification
public/brand/            Reserved official Renex brand asset locations
scripts/                 Regression and maintenance scripts
server/                  Shared development and production backend
shared/                  Browser/server AI contracts and constants
src/                     React application and browser regex worker
tests/backend/           Production backend tests with mocked providers
```

The long-term roadmap remains in
[`docs/phase-01/03-renex-roadmap.md`](docs/phase-01/03-renex-roadmap.md).

## Contributing

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

## License

MIT. See [LICENSE](LICENSE).
