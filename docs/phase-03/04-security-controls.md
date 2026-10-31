# Phase 3 security controls

## Resource bounds

- API bodies default to 65,536 bytes and must complete within 10 seconds.
- Description and sample text remain capped at 4,000 characters, patterns at
  10,000, flags at 32, models at 200, custom URLs at 2,048, custom templates at
  16,384, response paths at 500, and custom header names/prefixes at 200.
- API keys remain request-scoped strings and are capped at 16,384 characters.
- Provider requests default to a 15-second end-to-end timeout covering DNS,
  connection, response headers, and full body consumption.
- Provider response bodies default to a 1,048,576-byte ceiling. Declared and
  streamed over-limit bodies are terminated with
  `PROVIDER_RESPONSE_TOO_LARGE`.

## Custom auth headers

Header names must use HTTP token syntax. API keys and prefixes cannot contain
control characters. Renex rejects `Host`, `Content-Length`, `Content-Type`,
`Connection`, `Transfer-Encoding`, `Proxy-Authorization`, and the remaining
hop-by-hop or proxy control headers. The server always owns request framing and
JSON content type.

## Logging and errors

The logger accepts a closed event containing normalized method, normalized
route path, status, duration, and optional error code. Unknown methods are
logged as `OTHER` and unknown API paths as `/api/*`, so user-selected request
line text cannot carry secrets into logs. The logger never receives headers,
bodies, provider keys, or client exception objects.
Provider response bodies and thrown exceptions are discarded at the provider
boundary. Client errors contain stable codes and safe messages without stack
traces, DNS answers, authorization values, or filesystem paths.

New Phase 3 errors include:

- `OUTBOUND_DESTINATION_BLOCKED` (403)
- `REQUEST_TIMEOUT` (408)
- `RATE_LIMITED` (429)
- `PROVIDER_RESPONSE_TOO_LARGE` (502)

Successful generation, explanation, and provider-test responses are unchanged.
The frontend retains support for both structured and legacy string errors.

## Response headers

API and production static responses include:

- `Content-Security-Policy` with same-origin scripts, styles, connections, and
  workers; no objects, base URL changes, or framing;
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: no-referrer`;
- `Permissions-Policy` denying camera and geolocation while allowing same-origin
  microphone access for speech input;
- `X-Frame-Options: DENY`; and
- `Cross-Origin-Opener-Policy: same-origin`.

HSTS is left to the TLS-terminating deployment because local and direct HTTP
development remain supported.

## CORS

Same-origin remains the default. When `RENEX_ALLOWED_ORIGIN` is set, only that
exact HTTP(S) origin receives an allow-origin response. Wildcards and wildcard
credentials are never emitted. Preflight allows only POST and `Content-Type`.

## Runtime settings

| Variable | Default |
| --- | ---: |
| `RENEX_MAX_BODY_BYTES` | `65536` |
| `RENEX_REQUEST_BODY_TIMEOUT_MS` | `10000` |
| `RENEX_PROVIDER_TIMEOUT_MS` | `15000` |
| `RENEX_MAX_PROVIDER_RESPONSE_BYTES` | `1048576` |
| `RENEX_DNS_TIMEOUT_MS` | `3000` |
| `RENEX_CUSTOM_PROVIDER_MODE` | `public` |
| `RENEX_CUSTOM_PROVIDER_HOSTS` | empty |
| `RENEX_CUSTOM_PROVIDER_PORTS` | `80,443` |
| `RENEX_RATE_LIMIT` | `60` |
| `RENEX_RATE_LIMIT_WINDOW_MS` | `60000` |
| `RENEX_RATE_LIMIT_MAX_CLIENTS` | `10000` |
| `RENEX_TRUST_PROXY` | `false` |
