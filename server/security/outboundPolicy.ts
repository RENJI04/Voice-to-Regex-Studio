import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import type { OutboundPolicyConfig } from '../config.js'
import { ApiError } from '../errors.js'

export type ResolvedAddress = {
  address: string
  family: 4 | 6
}

export type DnsResolver = (hostname: string) => Promise<ResolvedAddress[]>

export type AuthorizedDestination = {
  addresses: readonly ResolvedAddress[]
  hostname: string
  url: URL
}

function parseIpv4(address: string) {
  const parts = address.split('.')

  if (parts.length !== 4) {
    return null
  }

  const bytes = parts.map((part) => Number(part))

  if (
    bytes.some(
      (byte, index) =>
        !Number.isInteger(byte) ||
        byte < 0 ||
        byte > 255 ||
        String(byte) !== parts[index],
    )
  ) {
    return null
  }

  return bytes
}

function parseIpv6(address: string) {
  if (address.includes('%')) {
    return null
  }

  let normalized = address.toLowerCase()
  const ipv4Start = normalized.lastIndexOf(':') + 1
  const ipv4Suffix = normalized.slice(ipv4Start)

  if (ipv4Suffix.includes('.')) {
    const ipv4 = parseIpv4(ipv4Suffix)

    if (!ipv4) {
      return null
    }

    normalized = `${normalized.slice(0, ipv4Start)}${(
      (ipv4[0] << 8) |
      ipv4[1]
    ).toString(16)}:${((ipv4[2] << 8) | ipv4[3]).toString(16)}`
  }

  const halves = normalized.split('::')

  if (halves.length > 2) {
    return null
  }

  const left = halves[0] ? halves[0].split(':') : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length

  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  ) {
    return null
  }

  const groups = [
    ...left,
    ...Array.from({ length: missing }, () => '0'),
    ...right,
  ]

  if (groups.length !== 8) {
    return null
  }

  const bytes: number[] = []

  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null
    }

    const value = Number.parseInt(group, 16)
    bytes.push(value >> 8, value & 0xff)
  }

  return bytes
}

function isPublicIpv4(bytes: readonly number[]) {
  const [first, second, third] = bytes

  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && third === 0) ||
    (first === 192 && second === 0 && third === 2) ||
    (first === 192 && second === 88 && third === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && third === 100) ||
    (first === 203 && second === 0 && third === 113) ||
    first >= 224
  )
}

function isPublicIpv6(bytes: readonly number[]) {
  const isMappedIpv4 =
    bytes.slice(0, 10).every((byte) => byte === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff

  if (isMappedIpv4) {
    return isPublicIpv4(bytes.slice(12))
  }

  const isGlobalUnicast = (bytes[0] & 0xe0) === 0x20

  if (!isGlobalUnicast) {
    return false
  }

  const isTeredo = bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0
  const isDocumentation =
    bytes[0] === 0x20 &&
    bytes[1] === 0x01 &&
    bytes[2] === 0x0d &&
    bytes[3] === 0xb8
  const isSixToFour = bytes[0] === 0x20 && bytes[1] === 0x02

  return !isTeredo && !isDocumentation && !isSixToFour
}

export function isPublicAddress(address: string) {
  const family = isIP(address)

  if (family === 4) {
    const bytes = parseIpv4(address)
    return Boolean(bytes && isPublicIpv4(bytes))
  }

  if (family === 6) {
    const bytes = parseIpv6(address)
    return Boolean(bytes && isPublicIpv6(bytes))
  }

  return false
}

export async function resolveAllAddresses(hostname: string) {
  const results = await lookup(hostname, { all: true, order: 'verbatim' })

  return results.map((result): ResolvedAddress => {
    if (result.family !== 4 && result.family !== 6) {
      throw new Error('DNS returned an unsupported address family.')
    }

    return {
      address: result.address,
      family: result.family,
    }
  })
}

function blocked(message: string) {
  return new ApiError('OUTBOUND_DESTINATION_BLOCKED', 403, message)
}

function normalizeHostname(hostname: string) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1).toLowerCase()
    : hostname.toLowerCase()
}

async function resolveWithTimeout(
  hostname: string,
  resolver: DnsResolver,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  let abortHandler: (() => void) | undefined

  try {
    const operations: Array<Promise<ResolvedAddress[]>> = [
      resolver(hostname),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new ApiError(
                'PROVIDER_TIMEOUT',
                504,
                'Provider destination resolution timed out.',
              ),
            ),
          timeoutMs,
        )
      }),
    ]

    if (signal) {
      operations.push(
        new Promise<never>((_resolve, reject) => {
          abortHandler = () =>
            reject(
              new ApiError(
                'PROVIDER_TIMEOUT',
                504,
                'Provider request timed out.',
              ),
            )

          if (signal.aborted) {
            abortHandler()
          } else {
            signal.addEventListener('abort', abortHandler, { once: true })
          }
        }),
      )
    }

    return await Promise.race(operations)
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    throw new ApiError(
      'PROVIDER_REQUEST_FAILED',
      502,
      'Provider destination could not be resolved.',
    )
  } finally {
    clearTimeout(timeout)

    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler)
    }
  }
}

export async function authorizeCustomDestination(
  rawUrl: string,
  policy: OutboundPolicyConfig,
  resolver: DnsResolver = resolveAllAddresses,
  signal?: AbortSignal,
): Promise<AuthorizedDestination> {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw blocked('Custom provider destination is invalid.')
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw blocked('Custom provider destination must use HTTP or HTTPS.')
  }

  if (url.username || url.password) {
    throw blocked('Custom provider destination must not contain credentials.')
  }

  if (policy.mode === 'disabled') {
    throw blocked('Custom providers are disabled by server policy.')
  }

  const hostname = normalizeHostname(url.hostname)
  const port = url.port
    ? Number(url.port)
    : url.protocol === 'https:'
      ? 443
      : 80

  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw blocked('Custom provider destination port is invalid.')
  }

  if (!policy.allowedPorts.includes(port)) {
    throw blocked('Custom provider destination port is not allowed.')
  }

  if (policy.mode === 'allowlist' && !policy.allowedHosts.includes(hostname)) {
    throw blocked('Custom provider hostname is not allowed.')
  }

  const literalFamily = isIP(hostname)
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await resolveWithTimeout(hostname, resolver, policy.dnsTimeoutMs, signal)

  if (addresses.length === 0) {
    throw blocked('Custom provider destination did not resolve to an address.')
  }

  if (
    addresses.some(
      ({ address, family }) =>
        isIP(address) !== family || !isPublicAddress(address),
    )
  ) {
    throw blocked('Custom provider destination is blocked by network policy.')
  }

  return { addresses, hostname, url }
}
