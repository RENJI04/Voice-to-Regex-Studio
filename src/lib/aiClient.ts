import {
  API_ROUTES,
  type AIProviderSettings,
  type ExplainRegexResponse,
  type GenerateRegexResponse,
  type TargetFlavor,
} from '../../shared/ai'

async function readJsonResponse<T extends object>(
  response: Response,
  fallbackError: string,
) {
  const payload = (await response.json()) as T | { error?: string }

  if (!response.ok) {
    throw new Error(
      'error' in payload && payload.error ? payload.error : fallbackError,
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
  const payload = (await response.json()) as { error?: string; ok?: boolean }

  if (!response.ok || !payload.ok) {
    throw new Error(payload.error ?? 'Provider connection test failed.')
  }
}
