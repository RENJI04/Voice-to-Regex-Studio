import type { ApiErrorCode, ApiErrorResponse } from '../shared/ai.js'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly statusCode: number

  constructor(code: ApiErrorCode, statusCode: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.statusCode = statusCode
  }
}

export function normalizeApiError(error: unknown) {
  if (error instanceof ApiError) {
    return error
  }

  return new ApiError(
    'INTERNAL_ERROR',
    500,
    'The server could not complete this request.',
  )
}

export function toErrorResponse(error: ApiError): ApiErrorResponse {
  return {
    error: {
      code: error.code,
      message: error.message,
    },
  }
}
