# Phase 1 current-state audit

## Repository baseline

The existing Voice-to-Regex Studio repository is a single-package React 19 and
TypeScript application built by Vite. It has no production backend, database,
authentication layer, or user account model. The baseline package contains 25
tracked files and uses npm with a lockfile.

The main application behavior was concentrated in `src/App.tsx`: UI panels,
browser persistence, provider request functions, speech recognition, URL
sharing, worker orchestration, and regex state. Regex evaluation itself runs in
`src/regexWorker.ts`. Fixture heuristics live in `src/lib/fixtureAudit.ts`, and
the command-line regression runner lives in `scripts/run-regression-suite.mjs`.

## Implemented capabilities

The audited source implements:

- natural-language generation and regex explanation through Anthropic, OpenAI,
  or a custom HTTP endpoint;
- a provider connection test;
- JavaScript, Python `re`, PCRE, and RE2/Go target selection;
- live browser evaluation, highlighted matches, zero-width handling, capture
  groups, debouncing, a 500-match cap, and a 350 ms worker timeout;
- Web Speech API input with typed-input fallback;
- browser-local AI settings, theme, and a 12-entry pattern history;
- share URLs carrying pattern, flags, flavor, and description;
- light and dark themes;
- fixture auditing after AI generation or explanation; and
- five command-line prompt regression cases against 11 curated fixtures.

The fixture audit and worker timeout provide useful development feedback. They
do not constitute a complete ReDoS or regex security analyzer.

## AI and API-key flow

The AI settings object contains the selected provider, model, API key, and
custom endpoint configuration. Before Phase 1 it was persisted as JSON under
`voice-to-regex-studio:ai-settings` in browser `localStorage`.

Generation, explanation, and connection-test requests serialize the complete AI
settings object into a same-origin request. This means the provider key leaves
browser storage during every AI operation. The receiving routes are registered
by the Vite development plugin in `server/aiRegexPlugin.ts`:

- `POST /api/generate-regex`
- `POST /api/explain-regex`
- `POST /api/test-provider`

The middleware reads the key and forwards it in the appropriate upstream
provider header. The custom provider adapter fetches the browser-supplied URL
with a configurable credential header. No production backend implementation of
these routes exists in the repository.

## Existing validation and safety behavior

The development middleware limits request bodies to 64 KiB, normalizes provider
configuration, validates supported target flags, validates AI response shapes,
retries malformed provider JSON once, and applies engine-specific checks. It
uses native JavaScript compilation, Python `re.compile`, structural PCRE checks,
and a set of RE2 incompatibility checks.

The source does not implement production authentication, authorization, rate
limiting, quotas, server-managed shared secrets, logging redaction, audit logs,
provider allowlisting, SSRF protection, DNS/IP filtering, redirect controls, or
durable data storage.

## Persistence and compatibility

The baseline uses these browser keys:

- `voice-to-regex-studio:ai-settings`
- `voice-to-regex-studio:pattern-history`
- `voice-to-regex-studio:theme`

History and AI settings are normalized when read. Invalid JSON falls back to
safe defaults. Share URLs are parsed on initial mount and override the current
pattern-related state when corresponding parameters are present.

## Technical debt relevant to later phases

- The three API routes exist only inside the Vite development process.
- Provider credentials are browser-managed and included in development API
  requests.
- Arbitrary custom endpoint fetching needs a production trust policy and SSRF
  defenses.
- `src/App.tsx` remains a large UI composition file even after Phase 1 extracts
  contracts, persistence, and HTTP calls.
- Browser storage has no schema version or explicit migration journal.
- Frontend behavior has no automated browser end-to-end suite.
- The regression suite covers five baseline generation behaviors but does not
  exercise live provider calls, speech recognition, history, sharing, or theme
  persistence.
- PCRE and RE2 checks are structural subsets rather than execution in their
  native engines.
- Provider errors can contain upstream response bodies and need a production
  redaction policy.

These items are documented for later phases and are not silently treated as
implemented controls.
