import type { ServerResponse } from 'node:http'

export function setCommonHeaders(response: ServerResponse) {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'; worker-src 'self' blob:",
  )
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Cache-Control', 'no-store')
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  includeBody = true,
) {
  if (response.writableEnded) {
    return
  }

  const body = JSON.stringify(payload)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(includeBody ? body : undefined)
}
