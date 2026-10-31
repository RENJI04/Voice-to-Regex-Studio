import { getRuntimeConfig } from './config.js'
import { createRenexServer } from './httpServer.js'

const config = getRuntimeConfig()
const server = createRenexServer({ config })

server.listen(config.port, '0.0.0.0', () => {
  console.log(
    JSON.stringify({
      event: 'server_started',
      port: config.port,
    }),
  )
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    server.close((error) => {
      if (error) {
        process.exitCode = 1
      }
    })
  })
}
