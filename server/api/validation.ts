import {
  DEFAULT_CUSTOM_REQUEST_TEMPLATE,
  DEFAULT_CUSTOM_RESPONSE_PATH,
  TARGET_FLAVOR_IDS,
  type AIProviderKind,
  type AIProviderSettings,
  type ExplainRegexRequest,
  type GenerateRegexRequest,
  type TargetFlavor,
  type TestProviderRequest,
} from '../../shared/ai.js'
import { ApiError } from '../errors.js'
import {
  normalizeTargetFlags,
  validateTargetPattern,
} from '../regex/validation.js'

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const PROTECTED_CUSTOM_HEADERS = new Set([
  'connection',
  'content-length',
  'content-type',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const PROVIDERS = new Set<AIProviderKind>(['anthropic', 'custom', 'openai'])
const TARGET_FLAVORS = new Set<string>(TARGET_FLAVOR_IDS)

function hasControlCharacter(value: string) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}

function asRecord(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('INVALID_REQUEST', 400, `${label} must be an object.`)
  }

  return value as Record<string, unknown>
}

function readString(
  record: Record<string, unknown>,
  key: string,
  options: {
    defaultValue?: string
    label?: string
    maxLength: number
    required?: boolean
    trim?: boolean
  },
) {
  const value = record[key]
  const label = options.label ?? key

  if (value === undefined && options.defaultValue !== undefined) {
    return options.defaultValue
  }

  if (typeof value !== 'string') {
    throw new ApiError('INVALID_REQUEST', 400, `${label} must be a string.`)
  }

  const output = options.trim ? value.trim() : value

  if (options.required && !output) {
    throw new ApiError('INVALID_REQUEST', 400, `${label} is required.`)
  }

  if (output.length > options.maxLength) {
    throw new ApiError(
      'INVALID_REQUEST',
      400,
      `${label} must be at most ${options.maxLength} characters.`,
    )
  }

  return output
}

function validateCustomUrl(value: string) {
  let url: URL

  try {
    url = new URL(value)
  } catch {
    throw new ApiError(
      'INVALID_REQUEST',
      400,
      'Custom endpoint URL must be an absolute HTTP(S) URL.',
    )
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ApiError(
      'INVALID_REQUEST',
      400,
      'Custom endpoint URL must use HTTP or HTTPS.',
    )
  }

  if (url.username || url.password) {
    throw new ApiError(
      'INVALID_REQUEST',
      400,
      'Custom endpoint URL must not contain embedded credentials.',
    )
  }

  return url.toString()
}

function validateCustomTemplate(template: string) {
  const rendered = template
    .replaceAll('"{{model}}"', JSON.stringify('model'))
    .replaceAll('"{{prompt}}"', JSON.stringify('prompt'))
    .replaceAll('"{{systemPrompt}}"', JSON.stringify('system'))
    .replaceAll('{{model}}', 'model')
    .replaceAll('{{prompt}}', 'prompt')
    .replaceAll('{{systemPrompt}}', 'system')

  try {
    JSON.parse(rendered)
  } catch {
    throw new ApiError(
      'INVALID_REQUEST',
      400,
      'Custom request template must render as valid JSON.',
    )
  }
}

export function validateProviderSettings(value: unknown): AIProviderSettings {
  const input = asRecord(value, 'aiConfig')
  const providerValue = input.provider

  if (typeof providerValue !== 'string' || !PROVIDERS.has(providerValue as AIProviderKind)) {
    throw new ApiError(
      'INVALID_PROVIDER',
      400,
      'Provider must be anthropic, openai, or custom.',
    )
  }

  const provider = providerValue as AIProviderKind
  const apiKey = readString(input, 'apiKey', {
    label: 'API key',
    maxLength: 16_384,
    required: true,
  })
  const model = readString(input, 'model', {
    label: 'Model',
    maxLength: 200,
    required: true,
    trim: true,
  })
  const customApiKeyHeader = readString(input, 'customApiKeyHeader', {
    defaultValue: 'Authorization',
    label: 'Custom API key header',
    maxLength: 200,
    trim: true,
  })
  const customApiKeyPrefix = readString(input, 'customApiKeyPrefix', {
    defaultValue: 'Bearer',
    label: 'Custom API key prefix',
    maxLength: 200,
    trim: true,
  })
  const customRequestTemplate = readString(input, 'customRequestTemplate', {
    defaultValue: DEFAULT_CUSTOM_REQUEST_TEMPLATE,
    label: 'Custom request template',
    maxLength: 16_384,
  })
  const customResponsePath = readString(input, 'customResponsePath', {
    defaultValue: DEFAULT_CUSTOM_RESPONSE_PATH,
    label: 'Custom response path',
    maxLength: 500,
    trim: true,
  })
  const customUrlValue = readString(input, 'customUrl', {
    defaultValue: '',
    label: 'Custom endpoint URL',
    maxLength: 2048,
    trim: true,
  })

  if (!HEADER_NAME_PATTERN.test(customApiKeyHeader)) {
    throw new ApiError(
      'INVALID_REQUEST',
      400,
      'Custom API key header is not a valid HTTP header name.',
    )
  }

  if (PROTECTED_CUSTOM_HEADERS.has(customApiKeyHeader.toLowerCase())) {
    throw new ApiError(
      'INVALID_REQUEST',
      400,
      'Custom API key header is reserved by the server.',
    )
  }

  if (hasControlCharacter(apiKey)) {
    throw new ApiError(
      'INVALID_REQUEST',
      400,
      'API key must not contain control characters.',
    )
  }

  if (hasControlCharacter(customApiKeyPrefix)) {
    throw new ApiError(
      'INVALID_REQUEST',
      400,
      'Custom API key prefix must not contain control characters.',
    )
  }

  let customUrl = customUrlValue

  if (provider === 'custom') {
    if (!customUrlValue) {
      throw new ApiError(
        'INVALID_REQUEST',
        400,
        'Custom endpoint URL is required.',
      )
    }

    if (!customResponsePath) {
      throw new ApiError(
        'INVALID_REQUEST',
        400,
        'Custom response path is required.',
      )
    }

    validateCustomTemplate(customRequestTemplate)
    customUrl = validateCustomUrl(customUrlValue)
  }

  return {
    apiKey,
    customApiKeyHeader,
    customApiKeyPrefix,
    customRequestTemplate,
    customResponsePath,
    customUrl,
    model,
    provider,
  }
}

function validateTargetFlavor(value: unknown): TargetFlavor {
  if (typeof value !== 'string' || !TARGET_FLAVORS.has(value)) {
    throw new ApiError(
      'UNSUPPORTED_TARGET_FLAVOR',
      400,
      'Target flavor must be javascript, python, pcre, or re2-go.',
    )
  }

  return value as TargetFlavor
}

function readSampleText(input: Record<string, unknown>) {
  return readString(input, 'sampleText', {
    defaultValue: '',
    label: 'Sample text',
    maxLength: 4000,
  })
}

export function validateGenerateRequest(value: unknown): GenerateRegexRequest {
  const input = asRecord(value, 'Request body')

  return {
    aiConfig: validateProviderSettings(input.aiConfig),
    description: readString(input, 'description', {
      label: 'Description',
      maxLength: 4000,
      required: true,
      trim: true,
    }),
    sampleText: readSampleText(input),
    targetFlavor: validateTargetFlavor(input.targetFlavor),
  }
}

export function validateExplainRequest(value: unknown): ExplainRegexRequest {
  const input = asRecord(value, 'Request body')
  const pattern = readString(input, 'pattern', {
    label: 'Pattern',
    maxLength: 10_000,
    required: true,
  })
  const targetFlavor = validateTargetFlavor(input.targetFlavor)
  const rawFlags = readString(input, 'flags', {
    defaultValue: '',
    label: 'Flags',
    maxLength: 32,
  })
  let flags: string

  try {
    flags = normalizeTargetFlags(rawFlags, targetFlavor)
  } catch (error) {
    throw new ApiError(
      'INVALID_FLAGS',
      400,
      error instanceof Error ? error.message : 'Flags are invalid.',
    )
  }

  try {
    validateTargetPattern(pattern, flags, targetFlavor)
  } catch (error) {
    throw new ApiError(
      'INVALID_PATTERN',
      400,
      error instanceof Error ? error.message : 'Pattern is invalid.',
    )
  }

  return {
    aiConfig: validateProviderSettings(input.aiConfig),
    flags,
    pattern,
    sampleText: readSampleText(input),
    targetFlavor,
  }
}

export function validateTestProviderRequest(value: unknown): TestProviderRequest {
  const input = asRecord(value, 'Request body')

  return {
    aiConfig: validateProviderSettings(input.aiConfig),
  }
}
