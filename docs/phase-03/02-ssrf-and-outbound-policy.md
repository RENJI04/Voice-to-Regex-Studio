# SSRF and outbound destination policy

## Fixed providers

Anthropic and OpenAI adapters use fixed HTTPS URLs defined in source. They use
the shared timeout, response ceiling, safe status handling, and redirect-error
policy. Browser input cannot change their scheme, host, port, or path.

## Custom provider authorization

Custom URLs must be absolute HTTP(S) URLs without embedded credentials. Before
each request, Renex:

1. Applies the configured custom-provider mode and exact hostname allowlist.
2. Checks the effective port against the configured port list.
3. Normalizes literal addresses through the WHATWG URL parser, which also
   canonicalizes alternative numeric IPv4 forms.
4. Resolves all A and AAAA answers for hostnames within a bounded DNS deadline.
5. Rejects the destination if any answer is invalid or non-public.
6. Passes the complete approved address set to a native HTTP(S) transport whose
   lookup function returns only those addresses.

The address policy blocks loopback, private, carrier-grade NAT, link-local,
unspecified, multicast, documentation, benchmark, reserved IPv4 space, unique
local IPv6, link-local IPv6, multicast IPv6, IPv4-mapped private addresses,
Teredo, 6to4, and documentation IPv6. Cloud metadata addresses are covered by
the link-local rules.

## Modes and configuration

`RENEX_CUSTOM_PROVIDER_MODE` accepts:

- `public` (default): any hostname is eligible, but every resolved address and
  the destination port must pass policy.
- `allowlist`: the normalized hostname must exactly match one entry in
  `RENEX_CUSTOM_PROVIDER_HOSTS`, then it must also pass DNS/IP policy.
- `disabled`: every custom provider request is rejected.

`RENEX_CUSTOM_PROVIDER_HOSTS` is a comma-separated list of exact hostnames with
no scheme, port, wildcard, or path. `RENEX_CUSTOM_PROVIDER_PORTS` defaults to
`80,443` and accepts comma-separated ports from 1 through 65535.

## Redirects and DNS rebinding

Redirects remain disabled for all providers. A 3xx response is normalized as a
provider failure and its `Location` target is never requested.

Custom DNS answers are checked on every request and pinned into the socket
lookup, so the transport does not perform a second approval-bypassing DNS
lookup. The policy does not defend against host or network compromise, route
manipulation below Node, or a distributed deployment with inconsistent operator
configuration.

Node's system DNS operation cannot be cancelled after it has entered the OS
resolver. Renex stops awaiting it at the configured deadline and fails closed,
but the underlying resolver work may finish in the background.
