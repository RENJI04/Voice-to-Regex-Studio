import type { IncomingMessage } from 'node:http'
import { ApiError } from '../errors.js'

export function readJsonBody(request: IncomingMessage, maxBodyBytes: number) {
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
    let tooLarge = false

    request.on('data', (chunk: Buffer) => {
      bytesRead += chunk.length

      if (bytesRead > maxBodyBytes) {
        tooLarge = true
        return
      }

      chunks.push(chunk)
    })

    request.on('end', () => {
      if (tooLarge) {
        reject(
          new ApiError(
            'PAYLOAD_TOO_LARGE',
            413,
            `Request body must not exceed ${maxBodyBytes} bytes.`,
          ),
        )
        return
      }

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
      reject(new ApiError('INVALID_REQUEST', 400, 'Request was aborted.')),
    )
    request.on('error', () =>
      reject(
        new ApiError(
          'INVALID_REQUEST',
          400,
          'Request body could not be read.',
        ),
      ),
    )
  })
}
