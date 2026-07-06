# Voice-to-Regex Studio

A browser-based studio for turning natural language into regular expressions, testing matches live, and explaining existing regex patterns in plain English.

## Why This Exists

Regex is powerful, but the workflow is usually fragmented: ask an AI for a pattern, paste it into a tester, adjust flags, then separately decode what the pattern does. Voice-to-Regex Studio brings those steps into one deterministic sandbox with provider-agnostic AI generation, token-level explanations, voice input, history, and edge-case fixture checks.

## Screenshot

Add a screenshot or GIF here before publishing the repository.

```md
![Voice-to-Regex Studio screenshot](docs/screenshot.png)
```

## Features

- Live regex sandbox with debounced matching, match highlighting, match counts, and capture group inspection.
- ReDoS-aware evaluation path that runs regex matching in a Web Worker with a timeout.
- Provider-agnostic AI generation through Anthropic, OpenAI Chat Completions, or a custom endpoint adapter.
- Shared structured JSON parsing and retry logic for provider responses.
- Regex-to-English explainer with token-level annotations and interactive hover highlighting.
- Web Speech API voice input for natural-language prompt entry, with unsupported-browser fallback.
- JavaScript, Python `re`, PCRE, and RE2/Go target flavor selection.
- Local pattern history and shareable URL parameters.
- Dark and light theme support using semantic CSS tokens.
- Curated edge-case fixture audit and an internal regression runner for prompt behavior checks.

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Anthropic API, OpenAI Chat Completions, or custom HTTP AI endpoint
- Web Speech API
- Web Workers
- Oxlint

## Setup

```bash
git clone https://github.com/RENJI04/Voice-to-Regex-Studio.git
cd Voice-to-Regex-Studio
npm install
cp .env.example .env
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

### Environment Variables

No build-time API key is required for local development. Users enter their own provider API key in the app settings panel. The key is stored in browser local storage and is sent only to the selected provider through the local Vite passthrough route.

`.env.example` is included to document this behavior and provide a place for deployment-specific optional values.

## Usage

1. Pick a target flavor: JavaScript, Python `re`, PCRE, or RE2/Go.
2. Type a regex directly into the sandbox, or describe what you want to match in the natural-language panel.
3. Choose an AI provider in **AI settings**, enter your API key and model, then test the connection.
4. Generate a regex. The generated pattern and flags are automatically loaded into the live sandbox.
5. Review highlighted matches, match counts, capture groups, warnings, proactive suggestions, and fixture audit findings.
6. Paste or keep an existing regex in the sandbox and click **Explain regex** for a token-by-token breakdown.
7. Use voice input on supported browsers to dictate the natural-language request.
8. Save useful patterns to local history or share the current pattern through URL parameters.

## Scripts

```bash
npm run dev              # Start the Vite dev server
npm run build            # Type-check and build for production
npm run preview          # Preview the production build locally
npm run lint             # Run Oxlint
npm run typecheck        # Run TypeScript project checks
npm run test             # Run the internal regression suite
npm run test:regression  # Run fixture-based prompt behavior checks
```

## Project Structure

```text
server/                 Vite dev middleware and AI provider adapters
scripts/                Internal maintenance and regression scripts
src/
  fixtures/             Curated regex edge-case fixtures
  lib/                  Shared client-side logic
  App.tsx               Main application shell and UI panels
  regexWorker.ts        Worker-based regex evaluation
  index.css             Tailwind plus semantic theme tokens
```

The current API passthrough is implemented as Vite development middleware. For a hosted production deployment, add a thin backend or serverless route that exposes the same `/api/generate-regex`, `/api/explain-regex`, and `/api/test-provider` contracts without committing shared API keys.

## Project Status

Built:

- Phase 1: core scaffold and live regex sandbox.
- Phase 2: provider-agnostic natural-language regex generation.
- Phase 3: structured regex explanation with token annotations.
- Phase 4: voice input.
- Phase 5: target regex flavors, history, shareable URL state, and proactive suggestions.
- Phase 6: polish, theme support, copy actions, shortcuts, async states, and worker timeout guard.
- Section A: fixture audit and internal regression suite.

Planned:

- Confidence and reasoning surfacing.
- Shareable explain-regex cards and PNG export.
- Onboarding walkthrough and example prompts.
- Rate limiting and cost controls for shared-key deployments.
- Failure analytics and internal debug review views.

## Security Notes

- Do not commit real provider keys. Keep `.env` files local.
- API keys entered in the UI are stored in browser local storage for convenience.
- For production or team deployments, prefer a backend route with per-session rate limiting and server-side secret management.
- Regex evaluation in the browser is guarded with a worker timeout, but generated patterns should still be reviewed against real data before production use.

## Contributing

Issues and pull requests are welcome. Please keep changes focused, run `npm run build`, `npm run lint`, and `npm run test:regression` before opening a PR, and avoid committing provider credentials or real user data.

## License

MIT. See [LICENSE](LICENSE).
