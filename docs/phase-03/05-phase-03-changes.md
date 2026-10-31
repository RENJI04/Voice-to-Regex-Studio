# Phase 3 changes

## Outbound network boundary

- Added public IPv4/IPv6 classification including mapped addresses and special
  ranges.
- Added all-record DNS validation with a bounded resolution deadline.
- Added a native custom-provider transport with approved-address pinning.
- Added custom-provider disabled, public, and exact-allowlist modes.
- Added configurable destination ports while retaining redirect rejection.

## Resource and abuse controls

- Added a separate configurable provider-response byte ceiling for fixed and
  custom providers.
- Added a full inbound-body deadline in the shared handler and production
  server.
- Added a bounded fixed-window API rate limiter with `Retry-After` responses.
- Added direct and explicitly trusted-proxy client-IP modes.
- Retained and tested existing request field and body limits.

## Headers, errors, and secrets

- Added CSP, framing, permissions, referrer, opener, and content-type headers.
- Added protected custom-header and control-character rejection.
- Added stable destination-blocked, request-timeout, rate-limit, and
  response-too-large error codes.
- Verified that provider keys, authorization values, upstream bodies, stack
  traces, and internal exceptions do not enter logs or client responses.

## Scope boundary

Phase 3 did not add login, signup, sessions, users, OAuth, databases, account
quotas, billing, persistent distributed limits, a shared credential vault, WAF
or CDN controls, or account-level abuse scoring.
