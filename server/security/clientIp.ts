import type { IncomingMessage } from 'node:http'
import { isIP } from 'node:net'

function normalizeIp(value: string | undefined) {
  const candidate = value?.trim()

  if (!candidate) {
    return null
  }

  if (candidate.toLowerCase().startsWith('::ffff:')) {
    const ipv4 = candidate.slice(7)

    if (isIP(ipv4) === 4) {
      return ipv4
    }
  }

  return isIP(candidate) ? candidate.toLowerCase() : null
}

export function getClientIp(request: IncomingMessage, trustProxy: boolean) {
  if (trustProxy) {
    const forwarded = request.headers['x-forwarded-for']
    const value = Array.isArray(forwarded) ? forwarded.at(-1) : forwarded
    const nearestForwardedIp = value?.split(',').at(-1)
    const normalizedForwardedIp = normalizeIp(nearestForwardedIp)

    if (normalizedForwardedIp) {
      return normalizedForwardedIp
    }
  }

  return normalizeIp(request.socket.remoteAddress) ?? 'unknown'
}
