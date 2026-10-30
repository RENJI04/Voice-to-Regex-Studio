# Phase 1 changes

## Product identity

- Renamed the package and user-facing product to **Renex**.
- Added the **AI-Powered Regex IDE** tagline to the application header.
- Updated the browser title, application-name metadata, page description, bug
  report template, default sample text, and Vite development plugin name.
- Kept the GitHub repository URL unchanged; the repository is still named
  `Voice-to-Regex-Studio`.

## Branding assets

- Added `public/brand/README.md` with reserved paths for the primary logo,
  standalone icon, light/dark logo variants, and favicon.
- Retained the existing text lockup and favicon placeholder because no official
  Renex image asset was supplied. No replacement artwork was fabricated.

## Architecture boundaries

- Added `shared/ai.ts` for route names, provider defaults, target identifiers,
  provider settings, and browser/server response contracts.
- Added `src/config/app.ts` for product identity and compatibility storage keys.
- Added `src/lib/aiClient.ts` for all browser calls to the development API.
- Added `src/lib/persistence.ts` for AI settings, theme, and pattern-history
  persistence and normalization.
- Updated both TypeScript projects to include the shared contract module.
- Updated the Vite middleware and frontend to consume shared route and provider
  constants instead of duplicating them.
- Initialized persisted state directly from storage, then retained the existing
  write effects. URL sharing and all existing UI behavior remain in the main
  application component.

## Storage compatibility

Phase 1 deliberately does not rename the three existing browser storage keys.
The values remain centralized in `src/config/app.ts` with their original
`voice-to-regex-studio:*` namespace. Existing AI settings, including the API
key, history entries, and theme therefore remain available without copying or
deleting browser data.

No destructive migration runs. A future versioned namespace change should read
the legacy keys, validate their contents, write the new keys, and keep a defined
rollback window.

## Documentation and security accuracy

- Rewrote the README around Renex and separated implemented behavior from
  roadmap work.
- Documented that the AI key is stored in `localStorage`, sent in the full
  provider configuration to same-origin development routes, received by Vite
  middleware, and forwarded upstream.
- Documented that the built static frontend has no production implementation of
  the three API routes.
- Listed authentication, authorization, server-managed secrets, rate limiting,
  quotas, SSRF defenses, provider allowlisting, redirect controls, request
  timeouts, monitoring, and logging redaction as future production work.

## Files modified

- `.github/ISSUE_TEMPLATE/bug_report.yml`
- `README.md`
- `index.html`
- `package.json`
- `package-lock.json`
- `server/aiRegexPlugin.ts`
- `src/App.tsx`
- `src/main.tsx`
- `tsconfig.app.json`
- `tsconfig.node.json`

## Files created

- `docs/phase-01/01-current-state-audit.md`
- `docs/phase-01/02-phase-01-changes.md`
- `docs/phase-01/03-renex-roadmap.md`
- `docs/phase-01/04-phase-01-verification.md`
- `public/brand/README.md`
- `shared/ai.ts`
- `src/config/app.ts`
- `src/lib/aiClient.ts`
- `src/lib/persistence.ts`
