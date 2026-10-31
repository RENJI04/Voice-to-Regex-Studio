# Phase 3 threat model

## Scope and architecture

This model covers the public Node HTTP process, its three AI API routes, the
browser-supplied BYOK provider configuration, and outbound requests to
Anthropic, OpenAI, or a custom provider. The browser regex worker has no server
network authority and is outside the outbound policy boundary.

```text
Browser (untrusted input and BYOK key)
  -> Renex HTTP boundary
     -> validation, body deadline, client-IP policy, rate limiter
     -> AI service and provider adapter
        -> fixed Anthropic/OpenAI destination
        -> custom destination policy, DNS validation, pinned socket
```

## Assets

- Provider credentials submitted with a request.
- Backend network access and the ability to reach external destinations.
- Service availability, memory, sockets, and provider quota.
- User regex descriptions, patterns, samples, and provider configuration.

## Attackers

- An anonymous internet client able to send arbitrary HTTP requests.
- A malicious user who supplies a valid BYOK key and custom endpoint.
- A compromised browser origin or injected script acting with the user's key.
- A malicious custom endpoint controlling DNS answers, response timing, size,
  status, and content.

## Trust boundaries

1. HTTP input is untrusted until body and field validation complete.
2. Forwarding headers are untrusted unless the operator explicitly enables the
   trusted-proxy model and restricts direct access to that proxy.
3. Provider credentials are transient secrets. They cross the backend boundary
   only to the selected provider and are excluded from logs and errors.
4. DNS data is untrusted. Every returned address must pass the public-network
   policy, and the custom transport pins connection lookup to that approved set.
5. Provider responses are untrusted and subject to time, byte, JSON, and schema
   limits before reaching the browser.

## Threats, controls, and residual risk

| Threat | Phase 3 control | Residual risk and future work |
| --- | --- | --- |
| SSRF to loopback, private, link-local, metadata, multicast, unspecified, or reserved addresses | URL parsing, all-address DNS resolution, public IPv4/IPv6 classification, IPv4-mapped IPv6 handling, allowed ports, and pinned lookup | Network-layer route manipulation below the Node process remains an infrastructure concern |
| DNS rebinding | All A/AAAA answers are checked immediately before a request and the native custom transport uses only that set | DNS validation is per request and is not shared across replicas; operators should still prefer exact allowlists |
| Redirect abuse | All provider redirects are rejected; custom transport never follows 3xx responses | Providers requiring redirects must expose a stable final endpoint |
| Secret or log leakage | Closed structured log events exclude bodies and headers; error normalization discards upstream bodies and exceptions; tests inject recognizable secrets | A compromised process or host remains able to inspect memory |
| Resource exhaustion | Request byte and field limits, inbound deadline, provider deadline, response byte ceiling, fixed-window rate limit, and bounded client map | Single-instance in-memory limits reset on restart and do not coordinate across replicas |
| Header injection | HTTP token validation, control-character rejection, and a protected-header denylist | The one permitted custom auth header still sends user-selected credentials to the approved destination |
| Rate-limit bypass | Direct socket IP by default; explicit one-proxy mode uses the rightmost forwarded address and ignores spoofed values to its left | Multi-replica deployments need a distributed limiter; trusted proxy mode requires exactly one sanitizing/appending proxy plus network-level direct-access prevention |
| CORS abuse | Same-origin default and one exact optional allowed origin; no wildcard | CORS is not authentication and does not stop non-browser clients |
| Browser compromise | Provider keys are never server-persisted and backend operations remain bounded | BYOK keys remain in browser localStorage for compatibility and can be read by compromised same-origin script |

## Explicit non-goals

Phase 3 does not add authentication, authorization, users, sessions, databases,
account quotas, billing, a credential vault, distributed rate limiting, a WAF,
CDN abuse controls, or user-level abuse scoring.
