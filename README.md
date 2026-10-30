# Renex

**AI-Powered Regex IDE**

Renex is an AI-powered regex development platform for generation, testing,
explanation, debugging, security analysis, optimization, and cross-engine
conversion. This repository is evolving incrementally from Voice-to-Regex
Studio; the current release provides the working foundation described below.

## Implemented today

- Natural-language regex generation through Anthropic, OpenAI Chat
  Completions, or a configurable custom HTTP endpoint.
- Regex-to-English explanations with token-level annotations.
- JavaScript, Python `re`, PCRE, and RE2/Go target selection, with
  target-specific prompt and flag validation.
- A debounced browser regex sandbox with match highlighting, match counts,
  capture groups, and zero-width match handling.
- Web Worker evaluation with a 350 ms timeout and a 500-match display limit.
  The timeout is a browser-safety guard, not a complete ReDoS analyzer.
- Web Speech API input with text input fallback.
- Browser-local pattern history, shareable URL state, copy actions, and
  light/dark themes.
- A curated fixture audit and command-line regression suite. These are useful
  heuristics and regression checks, not a production security scanner.

Renex does not yet include a production backend, accounts, a database,
collaboration, a complete regex security engine, optimization, or cross-engine
conversion. Those capabilities remain roadmap work.

## Development setup

Requirements:

- Node.js 24 is used by the current development environment.
- npm with the committed `package-lock.json`.
- Python on `PATH` for server-side validation of generated Python `re`
  patterns.

```bash
git clone https://github.com/RENJI04/Voice-to-Regex-Studio.git
cd Voice-to-Regex-Studio
npm install
npm run dev
```

Vite prints the local development URL after startup. No build-time API key is
required.

## Commands

```bash
npm run dev              # Start Vite and the development API middleware
npm run typecheck        # Run strict TypeScript project checks
npm run lint             # Run Oxlint
npm run test             # Run the fixture-based regression suite
npm run test:regression  # Run the regression suite directly
npm run build            # Type-check and build the static frontend bundle
npm run preview          # Preview the static production build
```

## Development architecture

The browser application is a React 19 and TypeScript frontend built with Vite.
Regex evaluation runs in `src/regexWorker.ts`. Curated fixture auditing lives in
`src/lib/fixtureAudit.ts`. Shared AI route names, provider settings, and response
types live in `shared/ai.ts`; browser API calls and persistence are separated in
`src/lib/aiClient.ts` and `src/lib/persistence.ts`.

During `npm run dev`, `server/aiRegexPlugin.ts` registers these same-origin Vite
development middleware routes:

- `POST /api/generate-regex`
- `POST /api/explain-regex`
- `POST /api/test-provider`

The middleware validates request shapes and AI JSON responses, then calls the
selected upstream provider. These routes exist only in the Vite development
server. `npm run build` produces a static frontend and does not create a
production implementation of them.

## Provider credentials and browser storage

Users enter provider settings in the AI settings panel. The complete settings
object, including the API key, is persisted in browser `localStorage`. When the
user generates, explains, or tests a provider connection, the frontend sends
that complete provider configuration to the application's same-origin
development API. The Vite middleware receives the key and forwards it to the
configured upstream provider. The key is therefore not exclusively
browser-local during AI requests.

Phase 1 preserves these existing storage keys so current browser data remains
available after the Renex rebrand:

- `voice-to-regex-studio:ai-settings`
- `voice-to-regex-studio:pattern-history`
- `voice-to-regex-studio:theme`

Do not place real provider keys in `.env` files, source code, documentation,
issue reports, or commits.

## Current security boundary

The development middleware limits request-body size and validates several
provider and regex response shapes. It does not provide production
authentication, authorization, rate limiting, quotas, audit logging, log
redaction, shared server-managed provider secrets, or durable user data.

Custom provider URLs are supplied by the browser and fetched by the development
middleware. The current implementation does not provide production-grade SSRF
protection, destination allowlisting, DNS/IP validation, or redirect controls.
Use custom endpoints only in a trusted development environment.

A production backend must implement the API routes and add server-side secret
management, authentication, authorization, rate limiting, quotas, provider
allowlisting, SSRF defenses, redirect and network controls, request timeouts,
logging redaction, monitoring, and abuse controls. These are future
architecture requirements; they are not implemented in this phase.

## Branding assets

The application currently renders an accessible text lockup for **Renex** and
**AI-Powered Regex IDE**. Official image assets have not been supplied, so this
repository does not fabricate a logo. See [`public/brand/README.md`](public/brand/README.md)
for the exact paths reserved for the primary logo, icon, favicon, and future
light/dark variants. The existing `public/favicon.svg` remains a placeholder
until an official Renex favicon is provided.

## Project structure

```text
docs/phase-01/           Phase 1 audit, changes, roadmap, and verification
public/brand/            Reserved locations for official Renex brand assets
scripts/                 Regression and maintenance scripts
server/                  Vite development middleware and provider adapters
shared/                  Browser/server AI contracts and shared constants
src/config/              Product identity and compatibility configuration
src/fixtures/            Curated regex edge-case fixtures
src/lib/                 API client, persistence, and fixture audit modules
src/App.tsx              Main application shell and UI panels
src/index.css            Theme tokens and application styles
src/regexWorker.ts       Isolated browser regex evaluation
```

## Roadmap

The high-level 20-phase roadmap is documented in
[`docs/phase-01/03-renex-roadmap.md`](docs/phase-01/03-renex-roadmap.md). Phase 1
establishes the Renex identity and architecture foundation. Production backend
work begins in Phase 2.

## Contributing

Keep changes focused and run the full validation set before opening a pull
request:

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run build
```

## License

MIT. See [LICENSE](LICENSE).
