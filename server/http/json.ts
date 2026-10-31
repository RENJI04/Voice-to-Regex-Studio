import type { ServerResponse } from 'node:http'

export function setCommonHeaders(response: ServerResponse) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
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
