# Phase 2 trust boundaries

## Credential flow

Renex keeps the existing bring-your-own-key flow:

```text
Browser localStorage
  -> same-origin Renex backend request
     -> selected AI provider
```

The backend receives the provider key while it processes each AI request. It
does not persist the key, write it to disk, include it in structured request
logs, or return it in error responses. Request logging contains only method,
path, status, duration, and an optional error code.

The frontend continues to persist provider settings, including the key, under
the legacy `voice-to-regex-studio:ai-settings` localStorage key. Phase 2 does
not rename compatibility keys or convert BYOK into shared server-managed
credentials.

## Outbound provider boundary

All provider adapters use the shared outbound request helper. Its default
deadline is 15 seconds and can be adjusted with
`RENEX_PROVIDER_TIMEOUT_MS`. Expiration aborts the fetch and returns
`PROVIDER_TIMEOUT` with status 504. Other network failures and non-success HTTP
responses return `PROVIDER_REQUEST_FAILED` with status 502.

Redirect handling is `redirect: "error"` for Anthropic, OpenAI, and custom
providers. Provider response bodies are never copied into error messages.

## Custom endpoint boundary

Custom endpoints are handled only by the custom provider adapter. Phase 2:

- requires an absolute `http:` or `https:` URL;
- rejects embedded URL credentials;
- rejects invalid auth header names and auth prefixes containing line breaks;
- verifies that the request template produces valid JSON;
- requires a response extraction path;
- rejects every outbound redirect; and
- applies the same timeout and safe error normalization as built-in providers.

This is a defined boundary, not complete SSRF prevention. A custom URL can
still name loopback, private, link-local, or otherwise sensitive destinations,
and DNS rebinding is not blocked. Custom endpoints should only be enabled for
trusted users in Phase 2 deployments.

## Deferred security infrastructure

Phase 3 remains responsible for authentication, authorization, rate limiting,
quotas, provider or destination allowlisting, private-network and DNS/IP
controls, hardened SSRF defenses, shared server-managed credentials, durable
audit facilities, and a production observability stack. Accounts, databases,
billing, and SaaS functionality are also outside Phase 2.
