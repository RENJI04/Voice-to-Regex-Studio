import {
  API_ROUTES,
  type ApiErrorResponse,
  type AIProviderSettings,
  type ExplainRegexResponse,
  type GenerateRegexResponse,
  type TargetFlavor,
} from '../../shared/ai'

type LegacyApiErrorResponse = { error?: string }

function getErrorMessage(
  payload: ApiErrorResponse | LegacyApiErrorResponse,
  fallbackError: string,
) {
  if (typeof payload.error === 'string' && payload.error) {
    return payload.error
  }

  if (
    payload.error &&
    typeof payload.error === 'object' &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message
  }

  return fallbackError
}

async function readJsonResponse<T extends object>(
  response: Response,
  fallbackError: string,
) {
  const payload = (await response.json()) as
    | T
    | ApiErrorResponse
    | LegacyApiErrorResponse

  if (!response.ok) {
    throw new Error(
      'error' in payload
        ? getErrorMessage(payload as ApiErrorResponse | LegacyApiErrorResponse, fallbackError)
        : fallbackError,
    )
  }

  return payload as T
}

export async function generateRegexFromDescription(
  aiSettings: AIProviderSettings,
  description: string,
  sampleText: string,
  targetFlavor: TargetFlavor,
) {
  const response = await fetch(API_ROUTES.generateRegex, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      aiConfig: aiSettings,
      description,
      sampleText,
      targetFlavor,
    }),
  })

  return readJsonResponse<GenerateRegexResponse>(
    response,
    'Regex generation request failed.',
  )
}

export async function explainRegexPattern(
  aiSettings: AIProviderSettings,
  pattern: string,
  flags: string,
  sampleText: string,
  targetFlavor: TargetFlavor,
) {
  const response = await fetch(API_ROUTES.explainRegex, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      aiConfig: aiSettings,
      pattern,
      flags,
      sampleText,
      targetFlavor,
    }),
  })

  return readJsonResponse<ExplainRegexResponse>(
    response,
    'Regex explanation request failed.',
  )
}

export async function testAIProviderConnection(
  aiSettings: AIProviderSettings,
) {
  const response = await fetch(API_ROUTES.testProvider, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      aiConfig: aiSettings,
    }),
  })
  const payload = (await response.json()) as
    | { ok?: boolean }
    | ApiErrorResponse
    | LegacyApiErrorResponse

  if (!response.ok || !('ok' in payload && payload.ok)) {
    throw new Error(
      'error' in payload
        ? getErrorMessage(
            payload as ApiErrorResponse | LegacyApiErrorResponse,
            'Provider connection test failed.',
          )
        : 'Provider connection test failed.',
    )
  }
}
