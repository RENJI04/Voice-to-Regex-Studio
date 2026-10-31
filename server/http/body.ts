import type { IncomingMessage } from 'node:http'
import { ApiError } from '../errors.js'

export function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number,
  timeoutMs: number,
) {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim()

  if (contentType !== 'application/json') {
    throw new ApiError(
      'UNSUPPORTED_MEDIA_TYPE',
      415,
      'Content-Type must be application/json.',
    )
  }

  const contentLength = Number(request.headers['content-length'])

  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    throw new ApiError(
      'PAYLOAD_TOO_LARGE',
      413,
      `Request body must not exceed ${maxBodyBytes} bytes.`,
    )
  }

  return new Promise<unknown>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytesRead = 0
    let settled = false
    const timeout = setTimeout(() => {
      fail(
        new ApiError(
          'REQUEST_TIMEOUT',
          408,
          `Request body was not received within ${timeoutMs}ms.`,
        ),
      )
      request.resume()
    }, timeoutMs)

    function cleanup() {
      clearTimeout(timeout)
    }

    function fail(error: ApiError) {
      if (settled) {
        return
      }

      settled = true
      cleanup()
      reject(error)
    }

    request.on('data', (chunk: Buffer) => {
      if (settled) {
        return
      }

      bytesRead += chunk.length

      if (bytesRead > maxBodyBytes) {
        fail(
          new ApiError(
            'PAYLOAD_TOO_LARGE',
            413,
            `Request body must not exceed ${maxBodyBytes} bytes.`,
          ),
        )
        request.resume()
        return
      }

      chunks.push(chunk)
    })

    request.on('end', () => {
      if (settled) {
        return
      }

      settled = true
      cleanup()

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      } catch {
        reject(
          new ApiError(
            'INVALID_JSON',
            400,
            'Request body must contain valid JSON.',
          ),
        )
      }
    })
    request.on('aborted', () =>
      fail(new ApiError('INVALID_REQUEST', 400, 'Request was aborted.')),
    )
    request.on('error', () =>
      fail(
        new ApiError(
          'INVALID_REQUEST',
          400,
          'Request body could not be read.',
        ),
      ),
    )
  })
}
