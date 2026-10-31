import { createServer } from 'node:http'
import type { RuntimeConfig } from './config.js'
import { createApiRequestHandler, type SafeLogger } from './http/apiHandler.js'
import { sendJson, setCommonHeaders } from './http/json.js'
import { serveStaticFiles } from './http/staticFiles.js'
import type {
  CustomRequestImplementation,
  DnsResolver,
  FetchImplementation,
} from './providers/index.js'

export function createRenexServer({
  config,
  customRequestImplementation,
  dnsResolver,
  fetchImplementation,
  logger,
}: {
  config: RuntimeConfig
  customRequestImplementation?: CustomRequestImplementation
  dnsResolver?: DnsResolver
  fetchImplementation?: FetchImplementation
  logger?: SafeLogger
}) {
  const handleApiRequest = createApiRequestHandler({
    config,
    customRequestImplementation,
    dnsResolver,
    fetchImplementation,
    logger,
  })

  return createServer({ requestTimeout: config.requestBodyTimeoutMs }, async (request, response) => {
    try {
      if (await handleApiRequest(request, response)) {
        return
      }

      await serveStaticFiles(request, response, config.staticDir)
    } catch {
      if (!response.writableEnded && !response.headersSent) {
        setCommonHeaders(response)
        sendJson(response, 500, {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'The server could not complete this request.',
          },
        })
      } else if (!response.writableEnded) {
        response.destroy()
      }
    }
  })
}
