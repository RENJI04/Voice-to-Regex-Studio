# Voice-to-Regex Studio

Voice-to-Regex Studio is a React and TypeScript app for generating regular expressions from typed or spoken natural language, testing them against sample text, and explaining existing patterns. It is built for developers and analysts who need a faster regex workflow without splitting work across a chat window, a tester, and reference docs.

## Features

- Live regex sandbox with debounced evaluation, match highlighting, match counts, and capture group inspection.
- Web Worker-based regex evaluation with a timeout guard for runaway patterns.
- Provider-agnostic AI generation through Anthropic, OpenAI Chat Completions, or a configurable custom endpoint.
- Shared JSON parsing and validation for AI responses, including a retry path for malformed provider output.
- Regex-to-English explainer with token-level annotations and interactive highlighting.
- Web Speech API support for voice input, with text input fallback when speech recognition is unavailable.
- Target flavor selection for JavaScript, Python `re`, PCRE, and RE2/Go.
- Local pattern history, copy actions, and shareable URL state.
- Dark and light themes using semantic CSS variables.
- Curated fixture audit plus an internal regression runner for prompt behavior checks.

## Tech Stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Web Workers
- Web Speech API
- Oxlint
- Anthropic, OpenAI, or custom HTTP AI provider

## Setup

```bash
git clone https://github.com/RENJI04/Voice-to-Regex-Studio.git
cd Voice-to-Regex-Studio
npm install
npm run dev
```

Vite prints the local development URL after startup.

No build-time API key is required. Provider credentials are entered in the app settings panel and are stored in browser local storage. Do not commit real provider keys to `.env` files or documentation.

## Usage

1. Choose a regex target flavor: JavaScript, Python `re`, PCRE, or RE2/Go.
2. Enter a regex directly in the sandbox, or describe the pattern you want in natural language.
3. In **AI settings**, select Anthropic, OpenAI, or a custom endpoint, then enter your API key and model.
4. Generate a pattern and review the live matches, capture groups, warnings, suggestions, and fixture audit results.
5. Paste an existing regex and use **Explain regex** to inspect token-level behavior.
6. Save useful patterns to local history or share the current state through URL parameters.

## Commands

```bash
npm run dev              # Start the Vite dev server
npm run build            # Type-check and build for production
npm run preview          # Preview the production build
npm run lint             # Run Oxlint
npm run typecheck        # Run TypeScript project checks
npm run test             # Run the regression suite
npm run test:regression  # Run fixture-based prompt behavior checks
```

## Project Structure

```text
server/                 Vite development middleware and AI provider adapters
scripts/                Internal maintenance and regression scripts
src/
  fixtures/             Curated regex edge-case fixtures
  lib/                  Shared client-side logic
  App.tsx               Main application shell and UI panels
  index.css             Tailwind plus theme variables
  regexWorker.ts        Worker-based regex evaluation
```

The current AI passthrough is implemented as Vite development middleware. A production deployment should provide equivalent backend or serverless routes for `/api/generate-regex`, `/api/explain-regex`, and `/api/test-provider`, with rate limiting and server-side secret management if shared provider keys are used.

## Status

Built:

- Live regex sandbox with match highlighting and capture group inspection.
- Provider-agnostic natural-language regex generation.
- Regex explanation with token-level annotations.
- Voice input for generation prompts.
- Target flavor selection, local history, shareable URL state, and proactive suggestions.
- Dark/light themes, copy actions, keyboard shortcuts, and worker timeout guard.
- Curated fixture audit and internal regression suite.

Planned:

- Confidence and reasoning surfacing for generated patterns.
- Shareable explanation cards with image export.
- First-run onboarding and example prompt shortcuts.
- Rate limiting and usage reporting for shared-key deployments.
- Failure analytics for low-confidence, parsing, and user-corrected generations.

## Security Notes

- Never commit real provider API keys, tokens, or credentials.
- `.env.example` intentionally contains no real secrets.
- Keys entered in the UI are stored locally in the browser.
- Generated regex patterns should be reviewed against real data before production use.

## Contributing

Issues and pull requests are welcome. Keep changes focused and run the validation commands before opening a PR:

```bash
npm run build
npm run lint
npm run test
```

## License

MIT. See [LICENSE](LICENSE).
