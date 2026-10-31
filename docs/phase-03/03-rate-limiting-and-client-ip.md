# Rate limiting and client IP

## Fixed-window limiter

Every non-OPTIONS request in the `/api/*` namespace consumes one request from a
fixed-window client bucket. `/health` and static frontend delivery are outside
the limiter. Exceeding the limit returns HTTP 429 with code `RATE_LIMITED` and a
whole-second `Retry-After` header.

Defaults:

- 60 API requests per 60,000 ms;
- at most 10,000 client buckets in memory.

Expired buckets are pruned in insertion order. When the map is full and no
expired bucket can be removed, a new client is rejected rather than expanding
memory. State resets when the process restarts and is local to one process.
Multi-process or multi-replica deployments require a future distributed
limiter for a coordinated global limit.

## Direct deployment

`RENEX_TRUST_PROXY` defaults to `false`. Renex uses the direct socket address
and ignores `X-Forwarded-For`, preventing clients from selecting new rate-limit
keys by spoofing that header.

## Reverse proxy deployment

When `RENEX_TRUST_PROXY=true`, Renex uses the rightmost valid address in
`X-Forwarded-For`. This is intentionally an exactly-one-trusted-proxy model. The
proxy must remove untrusted forwarding state or append the connection source as
the rightmost value, and network policy must prevent clients from reaching
Renex directly. Client-supplied values to the left are ignored for rate-limit
identity. Enabling the setting without those deployment guarantees makes the
header spoofable. Arbitrary trusted proxy chains are not supported in Phase 3.

IPv4-mapped IPv6 socket addresses are normalized to IPv4 before use as keys.
Invalid or absent forwarding values fall back to the direct socket address.

## Configuration

| Variable | Default | Meaning |
| --- | ---: | --- |
| `RENEX_RATE_LIMIT` | `60` | Requests per client in one window |
| `RENEX_RATE_LIMIT_WINDOW_MS` | `60000` | Fixed window duration |
| `RENEX_RATE_LIMIT_MAX_CLIENTS` | `10000` | Maximum in-memory client buckets |
| `RENEX_TRUST_PROXY` | `false` | Explicitly trust the nearest forwarding proxy |
