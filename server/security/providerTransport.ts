import { request as requestHttp } from 'node:http'
import { request as requestHttps } from 'node:https'
import type { LookupAddress } from 'node:dns'
import type { LookupFunction } from 'node:net'
import type { AuthorizedDestination } from './outboundPolicy.js'
import { ApiError } from '../errors.js'

export type RawProviderResponse = {
  body: string
  status: number
}

export type CustomRequestImplementation = (
  destination: AuthorizedDestination,
  init: RequestInit,
  context: {
    maxResponseBytes: number
    signal: AbortSignal
  },
) => Promise<RawProviderResponse>

function responseTooLarge() {
  return new ApiError(
    'PROVIDER_RESPONSE_TOO_LARGE',
    502,
    'Provider response exceeded the configured size limit.',
  )
}

export function createPinnedLookup(
  addresses: readonly AuthorizedDestination['addresses'][number][],
): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options === 'object' && options.all) {
      const allCallback = callback as (
        error: NodeJS.ErrnoException | null,
        results: LookupAddress[],
      ) => void
      allCallback(null, [...addresses])
      return
    }

    const address = addresses[0]
    const singleCallback = callback as (
      error: NodeJS.ErrnoException | null,
      result: string,
      family: 4 | 6,
    ) => void
    singleCallback(null, address.address, address.family)
  }
}

export async function readLimitedFetchResponse(
  response: Response,
  maxResponseBytes: number,
  controller: AbortController,
) {
  const contentLength = Number(response.headers.get('content-length'))

  if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
    controller.abort()
    throw responseTooLarge()
  }

  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytesRead = 0

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        break
      }

      bytesRead += value.byteLength

      if (bytesRead > maxResponseBytes) {
        controller.abort()
        throw responseTooLarge()
      }

      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8')
}

export const requestCustomProvider: CustomRequestImplementation = (
  destination,
  init,
  { maxResponseBytes, signal },
) =>
  new Promise((resolve, reject) => {
    const requestFunction =
      destination.url.protocol === 'https:' ? requestHttps : requestHttp
    const pinnedLookup = createPinnedLookup(destination.addresses)
    const request = requestFunction(
      destination.url,
      {
        headers: Object.fromEntries(new Headers(init.headers).entries()),
        lookup: pinnedLookup,
        method: init.method,
        signal,
      },
      (response) => {
        const contentLength = Number(response.headers['content-length'])

        if (Number.isFinite(contentLength) && contentLength > maxResponseBytes) {
          response.destroy()
          reject(responseTooLarge())
          return
        }

        const chunks: Buffer[] = []
        let bytesRead = 0

        response.on('data', (chunk: Buffer) => {
          bytesRead += chunk.length

          if (bytesRead > maxResponseBytes) {
            response.destroy(responseTooLarge())
            return
          }

          chunks.push(chunk)
        })
        response.on('end', () =>
          resolve({
            body: Buffer.concat(chunks).toString('utf8'),
            status: response.statusCode ?? 502,
          }),
        )
        response.on('error', reject)
      },
    )

    request.on('error', reject)

    if (typeof init.body === 'string') {
      request.write(init.body)
    }

    request.end()
  })
