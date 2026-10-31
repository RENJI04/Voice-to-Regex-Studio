import type {
  ExplainRegexResponse,
  GenerateRegexResponse,
  RegexSuggestion,
  TargetFlavor,
} from '../../shared/ai.js'
import { ApiError } from '../errors.js'
import { validateTargetPattern } from '../regex/validation.js'
import type { AIProvider } from '../providers/index.js'

function parseProviderJson(text: string): unknown {
  const trimmed = text.trim()
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(withoutFence)
  } catch {
    const start = withoutFence.indexOf('{')
    const end = withoutFence.lastIndexOf('}')

    if (start >= 0 && end > start) {
      return JSON.parse(withoutFence.slice(start, end + 1))
    }

    throw new Error('Provider output was not parseable JSON.')
  }
}

export function validateGenerateResult(
  value: unknown,
  targetFlavor: TargetFlavor,
): GenerateRegexResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('Provider output was not an object.')
  }

  const result = value as Record<string, unknown>

  if (result.needsClarification === true) {
    if (typeof result.question !== 'string' || !result.question.trim()) {
      throw new Error('Provider returned an invalid clarification response.')
    }

    return {
      needsClarification: true,
      question: result.question.trim(),
    }
  }

  if (
    result.needsClarification !== false ||
    typeof result.pattern !== 'string' ||
    typeof result.flags !== 'string' ||
    typeof result.explanation !== 'string' ||
    !Array.isArray(result.warnings) ||
    !result.warnings.every((warning) => typeof warning === 'string')
  ) {
    throw new Error('Provider output did not match the generation schema.')
  }

  const flags = validateTargetPattern(result.pattern, result.flags, targetFlavor)
  const rawSuggestions = result.suggestions ?? []

  if (!Array.isArray(rawSuggestions)) {
    throw new Error('Provider returned an invalid suggestions array.')
  }

  const suggestions = rawSuggestions.map((suggestion): RegexSuggestion => {
    if (!suggestion || typeof suggestion !== 'object') {
      throw new Error('Provider returned an invalid suggestion.')
    }

    const candidate = suggestion as Record<string, unknown>

    if (
      typeof candidate.title !== 'string' ||
      !candidate.title.trim() ||
      typeof candidate.description !== 'string' ||
      !candidate.description.trim() ||
      typeof candidate.request !== 'string' ||
      !candidate.request.trim()
    ) {
      throw new Error('Provider returned an invalid suggestion.')
    }

    return {
      title: candidate.title.trim(),
      description: candidate.description.trim(),
      request: candidate.request.trim(),
    }
  })

  return {
    needsClarification: false,
    pattern: result.pattern,
    flags,
    explanation: result.explanation,
    warnings: result.warnings,
    suggestions,
  }
}

export function validateExplainResult(
  value: unknown,
  pattern: string,
): ExplainRegexResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('Provider output was not an object.')
  }

  const result = value as Record<string, unknown>

  if (
    typeof result.summary !== 'string' ||
    !Array.isArray(result.annotations) ||
    !Array.isArray(result.warnings) ||
    !result.warnings.every((warning) => typeof warning === 'string')
  ) {
    throw new Error('Provider output did not match the explanation schema.')
  }

  const annotations = result.annotations.map((annotation) => {
    if (!annotation || typeof annotation !== 'object') {
      throw new Error('Provider returned an invalid annotation.')
    }

    const candidate = annotation as Record<string, unknown>

    if (
      typeof candidate.token !== 'string' ||
      !candidate.token ||
      typeof candidate.position !== 'number' ||
      !Number.isInteger(candidate.position) ||
      candidate.position < 0 ||
      typeof candidate.meaning !== 'string' ||
      !candidate.meaning.trim()
    ) {
      throw new Error('Provider returned an invalid annotation.')
    }

    const end = candidate.position + candidate.token.length

    if (pattern.slice(candidate.position, end) !== candidate.token) {
      throw new Error('Provider returned an annotation at an invalid position.')
    }

    return {
      token: candidate.token,
      position: candidate.position,
      meaning: candidate.meaning.trim(),
    }
  })

  return {
    summary: result.summary.trim(),
    annotations: annotations.sort((a, b) => a.position - b.position),
    warnings: result.warnings,
  }
}

export async function generateValidatedJson<T>({
  prompt,
  provider,
  systemPrompt,
  validate,
}: {
  prompt: string
  provider: AIProvider
  systemPrompt: string
  validate: (value: unknown) => T
}) {
  const firstResponse = await provider.generate(prompt, systemPrompt)

  try {
    return validate(parseProviderJson(firstResponse.text))
  } catch {
    const retrySystemPrompt = `${systemPrompt}

The previous response could not be parsed. Return ONLY valid JSON that matches the requested schema exactly. Do not include markdown, prose, comments, or trailing text.`
    const retryPrompt = `${prompt}

Retry now. Return ONLY valid JSON.`
    const secondResponse = await provider.generate(retryPrompt, retrySystemPrompt)

    try {
      return validate(parseProviderJson(secondResponse.text))
    } catch {
      throw new ApiError(
        'PROVIDER_RESPONSE_INVALID',
        502,
        'Provider response failed validation after one retry.',
      )
    }
  }
}
