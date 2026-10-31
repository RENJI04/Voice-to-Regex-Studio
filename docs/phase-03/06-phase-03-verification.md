# Phase 3 verification

## Reproducible commands

```bash
npm ci
npm run typecheck
npm run lint
npm run test
npm run test:backend
npm run test:security
npm run build
git diff --check
```

## Security coverage

The deterministic security suite uses injected DNS and provider transports plus
local ephemeral HTTP servers. It does not contact external providers. Coverage
includes special IPv4/IPv6 ranges, mapped addresses, numeric URL forms, all-DNS
answer rejection, public answers, DNS timeouts, disabled and allowlist modes,
ports, embedded credentials, address pinning, redirects, response boundaries,
slow oversized streams, native transport limits, rate windows and memory bounds,
health bypass, proxy spoofing, trusted proxy behavior, exact-origin CORS, secret
non-disclosure, security headers, custom header restrictions, prompt limits, and
inbound body timeouts.

## Recorded result

- `npm ci`: passed; 106 packages installed from the committed lockfile.
- `npm run typecheck`: passed.
- `npm run lint`: passed with no findings.
- `npm run test`: passed; 5 prompt cases against 11 fixtures and 81 backend
  tests.
- `npm run test:backend`: passed independently; 81 tests.
- `npm run test:security`: passed independently; 44 tests.
- `npm run build`: passed; the frontend and production backend were built.
- `git diff --check`: passed.

No real provider credential or external provider request was used.

## Production smoke checks

After `npm run build`, start the compiled server with `npm start`. Verify the
built root, `GET` and `HEAD /health`, structured missing-key errors for all three
AI endpoints, response security headers, and an intentionally blocked custom
loopback destination. Do not use live provider keys for this verification.

The final compiled server was started with
`RENEX_PORT=4185 RENEX_RATE_LIMIT=8 npm start`. `GET /` and `GET /health`
returned 200, `HEAD /health` returned 200 without a body, and the root response
included the documented production security headers. Safe missing-key requests
to all three AI endpoints returned structured 400 errors. Custom requests
targeting `127.0.0.1` and `10.0.0.1` returned
`OUTBOUND_DESTINATION_BLOCKED` with status 403 before any outbound connection.
After eight API requests from the same client, the ninth returned 429 with a
`Retry-After: 60` header while `/health` remained available. Captured request
logs contained normalized metadata only and did not contain the synthetic API
key marker used by the blocked custom-provider checks.
