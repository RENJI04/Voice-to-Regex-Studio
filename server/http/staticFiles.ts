import { readFile, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { extname, resolve, sep } from 'node:path'
import { ApiError, toErrorResponse } from '../errors.js'
import { sendJson, setCommonHeaders } from './json.js'

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
}

async function isFile(path: string) {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

export async function serveStaticFiles(
  request: IncomingMessage,
  response: ServerResponse,
  staticDir: string,
) {
  setCommonHeaders(response)

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    sendJson(
      response,
      405,
      toErrorResponse(
        new ApiError('METHOD_NOT_ALLOWED', 405, 'Method not allowed.'),
      ),
    )
    return
  }

  const url = new URL(request.url ?? '/', 'http://localhost')
  let decodedPath: string

  try {
    decodedPath = decodeURIComponent(url.pathname)
  } catch {
    sendJson(
      response,
      400,
      toErrorResponse(new ApiError('INVALID_REQUEST', 400, 'Invalid URL path.')),
    )
    return
  }

  const requestedPath = decodedPath === '/' ? '/index.html' : decodedPath
  const candidate = resolve(staticDir, `.${requestedPath}`)
  const staticRoot = resolve(staticDir)

  if (candidate !== staticRoot && !candidate.startsWith(`${staticRoot}${sep}`)) {
    sendJson(
      response,
      404,
      toErrorResponse(new ApiError('NOT_FOUND', 404, 'Resource not found.')),
    )
    return
  }

  let filePath = candidate

  if (!(await isFile(filePath))) {
    if (extname(decodedPath)) {
      sendJson(
        response,
        404,
        toErrorResponse(new ApiError('NOT_FOUND', 404, 'Resource not found.')),
      )
      return
    }

    filePath = resolve(staticDir, 'index.html')
  }

  if (!(await isFile(filePath))) {
    sendJson(
      response,
      503,
      toErrorResponse(
        new ApiError(
          'SERVICE_UNAVAILABLE',
          503,
          'Frontend build output is unavailable.',
        ),
      ),
    )
    return
  }

  const body = await readFile(filePath)
  response.statusCode = 200
  response.setHeader(
    'Content-Type',
    CONTENT_TYPES[extname(filePath)] ?? 'application/octet-stream',
  )
  response.setHeader('Content-Length', body.length)
  response.setHeader(
    'Cache-Control',
    requestedPath.startsWith('/assets/')
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  )
  response.end(request.method === 'HEAD' ? undefined : body)
}
