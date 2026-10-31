import type { Plugin } from 'vite'
import { getRuntimeConfig } from './config.js'
import { createApiRequestHandler } from './http/apiHandler.js'

export function aiRegexPlugin(): Plugin {
  return {
    name: 'renex-development-api',
    configureServer(server) {
      const handleApiRequest = createApiRequestHandler({
        config: getRuntimeConfig(),
      })

      server.middlewares.use((request, response, next) => {
        void handleApiRequest(request, response)
          .then((handled) => {
            if (!handled) {
              next()
            }
          })
          .catch(next)
      })
    },
  }
}
