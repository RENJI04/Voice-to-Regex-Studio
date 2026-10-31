import { createServer } from 'node:http'
import type { RuntimeConfig } from './config.js'
import { createApiRequestHandler, type SafeLogger } from './http/apiHandler.js'
import { serveStaticFiles } from './http/staticFiles.js'
import type { FetchImplementation } from './providers/index.js'

export function createRenexServer({
  config,
  fetchImplementation,
  logger,
}: {
  config: RuntimeConfig
  fetchImplementation?: FetchImplementation
  logger?: SafeLogger
}) {
  const handleApiRequest = createApiRequestHandler({
    config,
    fetchImplementation,
    logger,
  })

  return createServer(async (request, response) => {
    try {
      if (await handleApiRequest(request, response)) {
        return
      }

      await serveStaticFiles(request, response, config.staticDir)
    } catch {
      if (!response.writableEnded) {
        response.statusCode = 500
        response.setHeader('Content-Type', 'application/json; charset=utf-8')
        response.end(
          JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              message: 'The server could not complete this request.',
            },
          }),
        )
      }
    }
  })
}
