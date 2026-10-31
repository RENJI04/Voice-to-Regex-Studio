import type { IncomingMessage, ServerResponse } from 'node:http'
import { API_ROUTES } from '../../shared/ai.js'
import {
  validateExplainRequest,
  validateGenerateRequest,
  validateTestProviderRequest,
} from '../api/validation.js'
import type { RuntimeConfig } from '../config.js'
import {
  ApiError,
  normalizeApiError,
  toErrorResponse,
} from '../errors.js'
import { createAiService } from '../services/aiService.js'
import type {
  CustomRequestImplementation,
  DnsResolver,
  FetchImplementation,
} from '../providers/index.js'
import { getClientIp } from '../security/clientIp.js'
import { FixedWindowRateLimiter } from '../security/rateLimiter.js'
import { readJsonBody } from './body.js'
import { sendJson, setCommonHeaders } from './json.js'

type LogEvent = {
  code?: string
  durationMs: number
  method: string
  path: string
  statusCode: number
}

export type SafeLogger = (event: LogEvent) => void

function defaultLogger(event: LogEvent) {
  console.log(JSON.stringify({ event: 'http_request', ...event }))
}

const API_PATHS = new Set<string>(Object.values(API_ROUTES))
const LOGGABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'POST'])

function getLoggedMethod(method: string | undefined) {
  return method && LOGGABLE_METHODS.has(method) ? method : 'OTHER'
}

export function createApiRequestHandler({
  config,
  customRequestImplementation,
  dnsResolver,
  fetchImplementation = fetch,
  logger = defaultLogger,
  rateLimiter = new FixedWindowRateLimiter(config.rateLimit),
}: {
  config: RuntimeConfig
  customRequestImplementation?: CustomRequestImplementation
  dnsResolver?: DnsResolver
  fetchImplementation?: FetchImplementation
  logger?: SafeLogger
  rateLimiter?: FixedWindowRateLimiter
}) {
  const service = createAiService({
    customRequestImplementation,
    dnsResolver,
    fetchImplementation,
    maxProviderResponseBytes: config.maxProviderResponseBytes,
    outboundPolicy: config.outboundPolicy,
    providerTimeoutMs: config.providerTimeoutMs,
  })

  return async function handleApiRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ) {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const path = url.pathname
    const isKnownPath = path === '/health' || API_PATHS.has(path)
    const isApiNamespace = path.startsWith('/api/')
    const loggedPath = isKnownPath ? path : '/api/*'

    if (!isKnownPath && !isApiNamespace) {
      return false
    }

    const startedAt = performance.now()
    let errorCode: string | undefined
    setCommonHeaders(response)

    try {
      const origin = request.headers.origin

      if (config.allowedOrigin && origin) {
        if (origin !== config.allowedOrigin) {
          throw new ApiError(
            'ORIGIN_NOT_ALLOWED',
            403,
            'Request origin is not allowed.',
          )
        }

        response.setHeader('Access-Control-Allow-Origin', config.allowedOrigin)
        response.setHeader('Vary', 'Origin')
      }

      if (!isKnownPath) {
        throw new ApiError('NOT_FOUND', 404, 'API route was not found.')
      }

      if (path === '/health') {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.setHeader('Allow', 'GET, HEAD')
          throw new ApiError(
            'METHOD_NOT_ALLOWED',
            405,
            'Method not allowed.',
          )
        }

        sendJson(response, 200, { status: 'ok' }, request.method !== 'HEAD')
        return true
      }

      if (request.method === 'OPTIONS') {
        response.statusCode = 204
        response.setHeader('Allow', 'POST, OPTIONS')
        response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
        response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
        response.end()
        return true
      }

      const rateLimit = rateLimiter.consume(
        getClientIp(request, config.trustProxy),
      )

      if (!rateLimit.allowed) {
        response.setHeader('Retry-After', rateLimit.retryAfterSeconds)
        throw new ApiError(
          'RATE_LIMITED',
          429,
          'API rate limit exceeded. Try again later.',
        )
      }

      if (request.method !== 'POST') {
        response.setHeader('Allow', 'POST, OPTIONS')
        throw new ApiError(
          'METHOD_NOT_ALLOWED',
          405,
          'Method not allowed.',
        )
      }

      const body = await readJsonBody(
        request,
        config.maxBodyBytes,
        config.requestBodyTimeoutMs,
      )

      switch (path) {
        case API_ROUTES.generateRegex:
          sendJson(
            response,
            200,
            await service.generateRegex(validateGenerateRequest(body)),
          )
          break
        case API_ROUTES.explainRegex:
          sendJson(
            response,
            200,
            await service.explainRegex(validateExplainRequest(body)),
          )
          break
        case API_ROUTES.testProvider:
          sendJson(
            response,
            200,
            await service.testProvider(validateTestProviderRequest(body)),
          )
          break
      }

      return true
    } catch (error) {
      const apiError = normalizeApiError(error)
      errorCode = apiError.code
      sendJson(response, apiError.statusCode, toErrorResponse(apiError))
      return true
    } finally {
      logger({
        code: errorCode,
        durationMs: Math.round(performance.now() - startedAt),
        method: getLoggedMethod(request.method),
        path: loggedPath,
        statusCode: response.statusCode,
      })
    }
  }
}
