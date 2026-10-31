export const API_ROUTES = {
  explainRegex: '/api/explain-regex',
  generateRegex: '/api/generate-regex',
  testProvider: '/api/test-provider',
} as const

export const DEFAULT_CUSTOM_REQUEST_TEMPLATE = `{
  "model": "{{model}}",
  "messages": [
    { "role": "system", "content": "{{systemPrompt}}" },
    { "role": "user", "content": "{{prompt}}" }
  ]
}`

export const DEFAULT_CUSTOM_RESPONSE_PATH = 'choices.0.message.content'

export const DEFAULT_PROVIDER_MODELS = {
  anthropic: 'claude-sonnet-5',
  custom: 'gpt-4o-mini',
  openai: 'gpt-4o-mini',
} as const

export const TARGET_FLAVOR_IDS = [
  'javascript',
  'python',
  'pcre',
  're2-go',
] as const

export type TargetFlavor = (typeof TARGET_FLAVOR_IDS)[number]
export type AIProviderKind = keyof typeof DEFAULT_PROVIDER_MODELS

export type AIProviderSettings = {
  apiKey: string
  customApiKeyHeader: string
  customApiKeyPrefix: string
  customRequestTemplate: string
  customResponsePath: string
  customUrl: string
  model: string
  provider: AIProviderKind
}

export type GenerateRegexRequest = {
  aiConfig: AIProviderSettings
  description: string
  sampleText: string
  targetFlavor: TargetFlavor
}

export type ExplainRegexRequest = {
  aiConfig: AIProviderSettings
  pattern: string
  flags: string
  sampleText: string
  targetFlavor: TargetFlavor
}

export type TestProviderRequest = {
  aiConfig: AIProviderSettings
}

export type ApiErrorCode =
  | 'INTERNAL_ERROR'
  | 'INVALID_FLAGS'
  | 'INVALID_JSON'
  | 'INVALID_PATTERN'
  | 'INVALID_PROVIDER'
  | 'INVALID_REQUEST'
  | 'METHOD_NOT_ALLOWED'
  | 'NOT_FOUND'
  | 'ORIGIN_NOT_ALLOWED'
  | 'PAYLOAD_TOO_LARGE'
  | 'PROVIDER_REQUEST_FAILED'
  | 'PROVIDER_RESPONSE_INVALID'
  | 'PROVIDER_TIMEOUT'
  | 'SERVICE_UNAVAILABLE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'UNSUPPORTED_TARGET_FLAVOR'

export type ApiErrorResponse = {
  error: {
    code: ApiErrorCode
    message: string
  }
}

export type RegexSuggestion = {
  title: string
  description: string
  request: string
}

export type GenerateRegexSuccess = {
  needsClarification: false
  pattern: string
  flags: string
  explanation: string
  warnings: string[]
  suggestions: RegexSuggestion[]
  targetFlavor?: TargetFlavor
  model?: string
  provider?: AIProviderKind
}

export type GenerateRegexClarification = {
  needsClarification: true
  question: string
  targetFlavor?: TargetFlavor
  model?: string
  provider?: AIProviderKind
}

export type GenerateRegexResponse =
  | GenerateRegexSuccess
  | GenerateRegexClarification

export type RegexAnnotation = {
  token: string
  position: number
  meaning: string
}

export type ExplainRegexResponse = {
  summary: string
  annotations: RegexAnnotation[]
  warnings: string[]
  targetFlavor?: TargetFlavor
  model?: string
  provider?: AIProviderKind
}
