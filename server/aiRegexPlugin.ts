import { spawnSync } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'

const GENERATE_REGEX_PATH = '/api/generate-regex'
const EXPLAIN_REGEX_PATH = '/api/explain-regex'
const TEST_PROVIDER_PATH = '/api/test-provider'
const MAX_BODY_BYTES = 64 * 1024
const DEFAULT_CUSTOM_REQUEST_TEMPLATE = `{
  "model": "{{model}}",
  "messages": [
    { "role": "system", "content": "{{systemPrompt}}" },
    { "role": "user", "content": "{{prompt}}" }
  ]
}`
const DEFAULT_CUSTOM_RESPONSE_PATH = 'choices.0.message.content'
const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-5',
  custom: 'gpt-4o-mini',
  openai: 'gpt-4o-mini',
} as const
const TARGET_FLAVORS = {
  javascript: {
    label: 'JavaScript',
    promptName: 'JavaScript RegExp',
    allowedFlags: 'dgimsuvy',
    validation: 'native JavaScript RegExp',
  },
  python: {
    label: 'Python / re',
    promptName: 'Python re',
    allowedFlags: 'imsxau',
    validation: 'Python re.compile',
  },
  pcre: {
    label: 'PCRE',
    promptName: 'PCRE-compatible regular expression',
    allowedFlags: 'imsxuUADJ',
    validation: 'PCRE flag and structural checks',
  },
  're2-go': {
    label: 'RE2 / Go',
    promptName: 'RE2 syntax for Go regexp',
    allowedFlags: 'imsU',
    validation: 'RE2 compatibility checks',
  },
} as const

type TargetFlavor = keyof typeof TARGET_FLAVORS
type AIProviderKind = keyof typeof DEFAULT_MODELS

interface AIProvider {
  generate(prompt: string, systemPrompt: string): Promise<{ text: string }>
}

type AIProviderConfig = {
  apiKey: string
  customApiKeyHeader: string
  customApiKeyPrefix: string
  customRequestTemplate: string
  customResponsePath: string
  customUrl: string
  model: string
  provider: AIProviderKind
}

const GENERATE_SYSTEM_PROMPT = `You generate regular expressions from natural language for a requested target flavor.

Return only valid JSON. Do not wrap the JSON in markdown. Do not include comments.

When the request is clear enough, return exactly this shape:
{
  "needsClarification": false,
  "pattern": "string without surrounding slashes",
  "flags": "string of target-flavor flags",
  "explanation": "plain English explanation",
  "warnings": ["array of short caveats, empty when none"],
  "suggestions": [
    {
      "title": "short suggestion title",
      "description": "one sentence describing an edge case or improvement",
      "request": "natural language modification the user can apply"
    }
  ]
}

When the request is ambiguous enough that guessing would likely create the wrong pattern, return exactly this shape:
{
  "needsClarification": true,
  "question": "one concise clarifying question"
}

Rules:
- Target only the requested regex flavor.
- Use only the allowed flags listed in the user message for that flavor.
- Do not include leading or trailing slash delimiters in "pattern".
- Prefer readable, bounded patterns over clever or catastrophic ones.
- Ask a clarifying question when case sensitivity, boundaries, separators, date format, locale, or what should be excluded is material and unspecified.
- If a reasonable default is obvious, proceed and put the assumption in "warnings".
- Include 1 to 3 proactive suggestions for likely edge cases or useful refinements. Use an empty suggestions array only when there is genuinely nothing useful to suggest.
- For RE2 / Go, avoid lookaround, backreferences, conditionals, recursion, and other unsupported backtracking-engine features. If modes are needed in Go code, prefer inline modifiers in the pattern and explain that in warnings.`

const EXPLAIN_SYSTEM_PROMPT = `You explain regular expressions in plain English for a requested target flavor.

Return only valid JSON. Do not wrap the JSON in markdown. Do not include comments.

Return exactly this shape:
{
  "summary": "one or two sentence plain English summary",
  "annotations": [
    {
      "token": "exact substring from the raw pattern",
      "position": 0,
      "meaning": "plain English meaning of this token"
    }
  ],
  "warnings": ["array of short caveats, empty when none"]
}

Rules:
- Target only the requested regex flavor.
- "position" is the zero-based UTF-16 character offset in the raw pattern string.
- Each "token" must exactly equal pattern.slice(position, position + token.length).
- Annotate meaningful regex tokens and grouped constructs. It is acceptable for simple literal runs to be a single annotation.
- Annotations must be non-overlapping.
- Keep meanings concise and useful for a developer reading the regex.
- Include warnings for syntax that is easy to misunderstand, overly broad matching, or flags that materially change behavior.`

type GenerateRegexRequest = {
  aiConfig?: unknown
  description?: unknown
  sampleText?: unknown
  targetFlavor?: unknown
}

type ExplainRegexRequest = {
  aiConfig?: unknown
  pattern?: unknown
  flags?: unknown
  sampleText?: unknown
  targetFlavor?: unknown
}

type TestProviderRequest = {
  aiConfig?: unknown
}

type RegexSuggestion = {
  title: string
  description: string
  request: string
}

type GenerateRegexSuccess = {
  needsClarification: false
  pattern: string
  flags: string
  explanation: string
  warnings: string[]
  suggestions: RegexSuggestion[]
}

type GenerateRegexClarification = {
  needsClarification: true
  question: string
}

type GenerateRegexResult = GenerateRegexSuccess | GenerateRegexClarification

type RegexAnnotation = {
  token: string
  position: number
  meaning: string
}

type ExplainRegexResult = {
  summary: string
  annotations: RegexAnnotation[]
  warnings: string[]
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify(payload))
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = ''

    request.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8')

      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'))
        request.destroy()
      }
    })

    request.on('end', () => resolve(body))
    request.on('error', reject)
  })
}

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

    throw new Error('AI provider did not return parseable JSON.')
  }
}

function normalizeString(value: unknown, fallback = '') {
  return typeof value === 'string' ? value : fallback
}

function normalizeAIProviderConfig(value: unknown): AIProviderConfig {
  const input =
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const provider =
    input.provider === 'openai' ||
    input.provider === 'custom' ||
    input.provider === 'anthropic'
      ? input.provider
      : 'anthropic'

  return {
    apiKey: normalizeString(input.apiKey),
    customApiKeyHeader: normalizeString(input.customApiKeyHeader, 'Authorization'),
    customApiKeyPrefix: normalizeString(input.customApiKeyPrefix, 'Bearer'),
    customRequestTemplate: normalizeString(
      input.customRequestTemplate,
      DEFAULT_CUSTOM_REQUEST_TEMPLATE,
    ),
    customResponsePath: normalizeString(
      input.customResponsePath,
      DEFAULT_CUSTOM_RESPONSE_PATH,
    ),
    customUrl: normalizeString(input.customUrl),
    model: normalizeString(input.model, DEFAULT_MODELS[provider]),
    provider,
  }
}

function assertConfiguredProvider(config: AIProviderConfig) {
  if (!config.apiKey.trim()) {
    throw new Error('API key is required for the selected provider.')
  }

  if (config.provider === 'custom' && !config.customUrl.trim()) {
    throw new Error('Custom endpoint URL is required.')
  }
}

function extractResponseText(value: unknown, path: string) {
  if (!path || path === '$') {
    if (typeof value === 'string') {
      return value
    }

    return JSON.stringify(value)
  }

  const current = path.split('.').reduce<unknown>((cursor, segment) => {
    if (cursor === null || cursor === undefined) {
      return undefined
    }

    if (Array.isArray(cursor)) {
      const index = Number.parseInt(segment, 10)
      return Number.isNaN(index) ? undefined : cursor[index]
    }

    if (typeof cursor === 'object') {
      return (cursor as Record<string, unknown>)[segment]
    }

    return undefined
  }, value)

  if (typeof current !== 'string') {
    throw new Error(`Custom response path "${path}" did not resolve to text.`)
  }

  return current
}

function renderRequestTemplate(
  template: string,
  values: { model: string; prompt: string; systemPrompt: string },
) {
  return template
    .replaceAll('"{{model}}"', JSON.stringify(values.model))
    .replaceAll('"{{prompt}}"', JSON.stringify(values.prompt))
    .replaceAll('"{{systemPrompt}}"', JSON.stringify(values.systemPrompt))
    .replaceAll('{{model}}', values.model)
    .replaceAll('{{prompt}}', values.prompt)
    .replaceAll('{{systemPrompt}}', values.systemPrompt)
}

async function parseProviderResponse(response: Response) {
  const rawText = await response.text()

  if (!response.ok) {
    throw new Error(rawText || `Provider request failed with ${response.status}.`)
  }

  try {
    return JSON.parse(rawText) as unknown
  } catch {
    return rawText
  }
}

class AnthropicProvider implements AIProvider {
  private readonly config: AIProviderConfig

  constructor(config: AIProviderConfig) {
    this.config = config
  }

  async generate(prompt: string, systemPrompt: string) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      body: JSON.stringify({
        max_tokens: 1200,
        messages: [{ content: prompt, role: 'user' }],
        model: this.config.model,
        system: systemPrompt,
      }),
      headers: {
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'x-api-key': this.config.apiKey,
      },
      method: 'POST',
    })
    const payload = await parseProviderResponse(response)
    const content = (payload as { content?: Array<{ text?: string; type?: string }> })
      .content

    if (!Array.isArray(content)) {
      throw new Error('Anthropic response did not include content blocks.')
    }

    return {
      text: content
        .filter((block) => block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n'),
    }
  }
}

class OpenAIProvider implements AIProvider {
  private readonly config: AIProviderConfig

  constructor(config: AIProviderConfig) {
    this.config = config
  }

  async generate(prompt: string, systemPrompt: string) {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      body: JSON.stringify({
        messages: [
          { content: systemPrompt, role: 'system' },
          { content: prompt, role: 'user' },
        ],
        model: this.config.model,
      }),
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      method: 'POST',
    })
    const payload = await parseProviderResponse(response)
    const text = extractResponseText(payload, 'choices.0.message.content')

    return { text }
  }
}

class CustomEndpointProvider implements AIProvider {
  private readonly config: AIProviderConfig

  constructor(config: AIProviderConfig) {
    this.config = config
  }

  async generate(prompt: string, systemPrompt: string) {
    const renderedBody = renderRequestTemplate(this.config.customRequestTemplate, {
      model: this.config.model,
      prompt,
      systemPrompt,
    })
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    }

    if (this.config.apiKey.trim()) {
      headers[this.config.customApiKeyHeader || 'Authorization'] = this.config
        .customApiKeyPrefix
        ? `${this.config.customApiKeyPrefix} ${this.config.apiKey}`
        : this.config.apiKey
    }

    let body: unknown

    try {
      body = JSON.parse(renderedBody)
    } catch {
      throw new Error('Custom request template did not render as valid JSON.')
    }

    const response = await fetch(this.config.customUrl, {
      body: JSON.stringify(body),
      headers,
      method: 'POST',
    })
    const payload = await parseProviderResponse(response)

    return {
      text: extractResponseText(payload, this.config.customResponsePath),
    }
  }
}

function createAIProvider(config: AIProviderConfig): AIProvider {
  assertConfiguredProvider(config)

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config)
    case 'openai':
      return new OpenAIProvider(config)
    case 'custom':
      return new CustomEndpointProvider(config)
  }
}

function normalizeTargetFlavor(value: unknown): TargetFlavor {
  if (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(TARGET_FLAVORS, value)
  ) {
    return value as TargetFlavor
  }

  return 'javascript'
}

function normalizeTargetFlags(flags: string, targetFlavor: TargetFlavor) {
  const normalizedFlags = flags.replace(/\s/g, '')
  const seen = new Set<string>()
  const allowedFlags = TARGET_FLAVORS[targetFlavor].allowedFlags

  for (const flag of normalizedFlags) {
    if (!allowedFlags.includes(flag)) {
      throw new Error(
        `Unsupported ${TARGET_FLAVORS[targetFlavor].label} flag "${flag}".`,
      )
    }

    if (seen.has(flag)) {
      throw new Error(`Duplicate flag "${flag}" is not allowed.`)
    }

    seen.add(flag)
  }

  return normalizedFlags
}

function validateBalancedRegexShape(pattern: string) {
  let escaped = false
  let inCharacterClass = false
  const stack: number[] = []

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (character === '\\') {
      escaped = true
      continue
    }

    if (character === '[' && !inCharacterClass) {
      inCharacterClass = true
      continue
    }

    if (character === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }

    if (inCharacterClass) {
      continue
    }

    if (character === '(') {
      stack.push(index)
      continue
    }

    if (character === ')') {
      if (stack.length === 0) {
        throw new Error(`Unmatched closing parenthesis at index ${index}.`)
      }

      stack.pop()
    }
  }

  if (escaped) {
    throw new Error('Pattern ends with a dangling escape.')
  }

  if (inCharacterClass) {
    throw new Error('Pattern has an unterminated character class.')
  }

  if (stack.length > 0) {
    throw new Error(`Unmatched opening parenthesis at index ${stack[0]}.`)
  }
}

function validatePythonPattern(pattern: string, flags: string) {
  const script = `
import json
import re
import sys

payload = json.loads(sys.stdin.read())
flag_map = {
    "i": re.IGNORECASE,
    "m": re.MULTILINE,
    "s": re.DOTALL,
    "x": re.VERBOSE,
    "a": re.ASCII,
    "u": re.UNICODE,
}
compiled_flags = 0
for flag in payload["flags"]:
    compiled_flags |= flag_map[flag]
re.compile(payload["pattern"], compiled_flags)
`

  const result = spawnSync('python', ['-c', script], {
    encoding: 'utf8',
    input: JSON.stringify({ pattern, flags }),
    timeout: 3000,
  })

  if (result.error) {
    throw new Error(`Python validation failed: ${result.error.message}`)
  }

  if (result.status !== 0) {
    const details = (result.stderr || result.stdout).trim()
    throw new Error(details || 'Python re.compile rejected this pattern.')
  }
}

function validateRe2Pattern(pattern: string) {
  validateBalancedRegexShape(pattern)

  const unsupportedChecks = [
    { pattern: /\\[1-9]/, message: 'RE2 does not support backreferences.' },
    { pattern: /\(\?<?[=!]/, message: 'RE2 does not support lookaround.' },
    { pattern: /\\k<[^>]+>/, message: 'RE2 does not support named backreferences.' },
    { pattern: /\(\?>/, message: 'RE2 does not support atomic groups.' },
    { pattern: /\(\?R\)/, message: 'RE2 does not support recursive patterns.' },
    { pattern: /[*+?}]\+/, message: 'RE2 does not support possessive quantifiers.' },
  ]

  const failure = unsupportedChecks.find((check) => check.pattern.test(pattern))

  if (failure) {
    throw new Error(failure.message)
  }
}

function validateTargetPattern(
  pattern: string,
  flags: string,
  targetFlavor: TargetFlavor,
) {
  const normalizedFlags = normalizeTargetFlags(flags, targetFlavor)

  switch (targetFlavor) {
    case 'javascript':
      new RegExp(pattern, normalizedFlags)
      break
    case 'python':
      validatePythonPattern(pattern, normalizedFlags)
      break
    case 'pcre':
      validateBalancedRegexShape(pattern)
      break
    case 're2-go':
      validateRe2Pattern(pattern)
      break
  }

  return normalizedFlags
}

function validateGenerateResult(
  value: unknown,
  targetFlavor: TargetFlavor,
): GenerateRegexResult {
  if (!value || typeof value !== 'object') {
    throw new Error('AI provider returned a non-object response.')
  }

  const result = value as Record<string, unknown>

  if (result.needsClarification === true) {
    if (typeof result.question !== 'string' || !result.question.trim()) {
      throw new Error('AI provider returned an invalid clarification response.')
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
    throw new Error('AI provider returned JSON that does not match the expected schema.')
  }

  const flags = validateTargetPattern(result.pattern, result.flags, targetFlavor)
  const rawSuggestions = result.suggestions ?? []

  if (!Array.isArray(rawSuggestions)) {
    throw new Error('AI provider returned an invalid suggestions array.')
  }

  const suggestions = rawSuggestions.map((suggestion) => {
    if (!suggestion || typeof suggestion !== 'object') {
      throw new Error('AI provider returned an invalid suggestion.')
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
      throw new Error('AI provider returned an invalid suggestion.')
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

function validateExplainResult(
  value: unknown,
  pattern: string,
): ExplainRegexResult {
  if (!value || typeof value !== 'object') {
    throw new Error('AI provider returned a non-object response.')
  }

  const result = value as Record<string, unknown>

  if (
    typeof result.summary !== 'string' ||
    !Array.isArray(result.annotations) ||
    !Array.isArray(result.warnings) ||
    !result.warnings.every((warning) => typeof warning === 'string')
  ) {
    throw new Error('AI provider returned JSON that does not match the expected schema.')
  }

  const annotations = result.annotations.map((annotation) => {
    if (!annotation || typeof annotation !== 'object') {
      throw new Error('AI provider returned an invalid annotation.')
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
      throw new Error('AI provider returned an invalid annotation.')
    }

    const end = candidate.position + candidate.token.length

    if (pattern.slice(candidate.position, end) !== candidate.token) {
      throw new Error(
        'AI provider returned an annotation whose token does not match its position.',
      )
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

async function generateValidatedJson<T>({
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
  } catch (firstError) {
    const retrySystemPrompt = `${systemPrompt}

The previous response could not be parsed. Return ONLY valid JSON that matches the requested schema exactly. Do not include markdown, prose, comments, or trailing text.`
    const retryPrompt = `${prompt}

Retry now. Return ONLY valid JSON.`
    const secondResponse = await provider.generate(retryPrompt, retrySystemPrompt)

    try {
      return validate(parseProviderJson(secondResponse.text))
    } catch (secondError) {
      const message =
        secondError instanceof Error
          ? secondError.message
          : 'Provider response did not match the expected JSON schema.'
      const firstMessage =
        firstError instanceof Error ? ` First parse error: ${firstError.message}` : ''

      throw new Error(
        `Provider response failed JSON validation after one retry. ${message}${firstMessage}`,
      )
    }
  }
}

function createGeneratePrompt(
  description: string,
  sampleText: string,
  targetFlavor: TargetFlavor,
) {
  const flavor = TARGET_FLAVORS[targetFlavor]

  return `Natural language request:
${description}

Target flavor:
${flavor.label} (${flavor.promptName})

Allowed flags:
${flavor.allowedFlags || '(none)'}

Validation mode:
${flavor.validation}

Sample text the user is testing against:
${sampleText || '(none provided)'}

Generate the response JSON now.`
}

function createExplainPrompt(
  pattern: string,
  flags: string,
  sampleText: string,
  targetFlavor: TargetFlavor,
) {
  const flavor = TARGET_FLAVORS[targetFlavor]

  return `Regex pattern:
${pattern}

Target flavor:
${flavor.label} (${flavor.promptName})

Flags:
${flags || '(none)'}

Sample text the user is testing against:
${sampleText || '(none provided)'}

Explain the regex with token-level annotations now.`
}

export function aiRegexPlugin(): Plugin {
  return {
    name: 'voice-to-regex-api',
    configureServer(server) {
      server.middlewares.use(GENERATE_REGEX_PATH, async (request, response) => {
        if (request.method === 'OPTIONS') {
          response.statusCode = 204
          response.end()
          return
        }

        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Method not allowed.' })
          return
        }

        let payload: GenerateRegexRequest

        try {
          payload = JSON.parse(await readBody(request)) as GenerateRegexRequest
        } catch (error) {
          sendJson(response, 400, {
            error:
              error instanceof Error ? error.message : 'Request body must be JSON.',
          })
          return
        }

        if (
          typeof payload.description !== 'string' ||
          !payload.description.trim()
        ) {
          sendJson(response, 400, { error: 'Description is required.' })
          return
        }

        const description = payload.description.trim()
        const targetFlavor = normalizeTargetFlavor(payload.targetFlavor)
        const aiConfig = normalizeAIProviderConfig(payload.aiConfig)
        const sampleText =
          typeof payload.sampleText === 'string' ? payload.sampleText.slice(0, 4000) : ''

        try {
          const provider = createAIProvider(aiConfig)
          const result = await generateValidatedJson({
            prompt: createGeneratePrompt(description, sampleText, targetFlavor),
            provider,
            systemPrompt: GENERATE_SYSTEM_PROMPT,
            validate: (value) => validateGenerateResult(value, targetFlavor),
          })

          sendJson(response, 200, {
            ...result,
            model: aiConfig.model,
            provider: aiConfig.provider,
            targetFlavor,
          })
        } catch (error) {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : 'AI provider failed to generate a regex.',
          })
        }
      })

      server.middlewares.use(EXPLAIN_REGEX_PATH, async (request, response) => {
        if (request.method === 'OPTIONS') {
          response.statusCode = 204
          response.end()
          return
        }

        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Method not allowed.' })
          return
        }

        let payload: ExplainRegexRequest

        try {
          payload = JSON.parse(await readBody(request)) as ExplainRegexRequest
        } catch (error) {
          sendJson(response, 400, {
            error:
              error instanceof Error ? error.message : 'Request body must be JSON.',
          })
          return
        }

        if (typeof payload.pattern !== 'string' || !payload.pattern.trim()) {
          sendJson(response, 400, { error: 'Pattern is required.' })
          return
        }

        const pattern = payload.pattern
        const targetFlavor = normalizeTargetFlavor(payload.targetFlavor)
        const aiConfig = normalizeAIProviderConfig(payload.aiConfig)
        let flags = ''

        try {
          flags = normalizeTargetFlags(
            typeof payload.flags === 'string' ? payload.flags : '',
            targetFlavor,
          )
        } catch (error) {
          sendJson(response, 400, {
            error:
              error instanceof Error
                ? error.message
                : 'Flags are not valid for the selected target flavor.',
          })
          return
        }

        try {
          validateTargetPattern(pattern, flags, targetFlavor)
        } catch (error) {
          sendJson(response, 400, {
            error:
              error instanceof Error
                ? error.message
                : 'Pattern must be valid for the selected target flavor.',
          })
          return
        }

        const sampleText =
          typeof payload.sampleText === 'string' ? payload.sampleText.slice(0, 4000) : ''

        try {
          const provider = createAIProvider(aiConfig)
          const result = await generateValidatedJson({
            prompt: createExplainPrompt(pattern, flags, sampleText, targetFlavor),
            provider,
            systemPrompt: EXPLAIN_SYSTEM_PROMPT,
            validate: (value) => validateExplainResult(value, pattern),
          })

          sendJson(response, 200, {
            ...result,
            model: aiConfig.model,
            provider: aiConfig.provider,
            targetFlavor,
          })
        } catch (error) {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : 'AI provider failed to explain this regex.',
          })
        }
      })

      server.middlewares.use(TEST_PROVIDER_PATH, async (request, response) => {
        if (request.method === 'OPTIONS') {
          response.statusCode = 204
          response.end()
          return
        }

        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'Method not allowed.' })
          return
        }

        let payload: TestProviderRequest

        try {
          payload = JSON.parse(await readBody(request)) as TestProviderRequest
        } catch (error) {
          sendJson(response, 400, {
            error:
              error instanceof Error ? error.message : 'Request body must be JSON.',
          })
          return
        }

        try {
          const aiConfig = normalizeAIProviderConfig(payload.aiConfig)
          const provider = createAIProvider(aiConfig)
          const result = await provider.generate(
            'Reply with the word OK only.',
            'You are testing whether this AI provider connection works.',
          )

          if (!result.text.trim()) {
            throw new Error('Provider returned an empty response.')
          }

          sendJson(response, 200, {
            model: aiConfig.model,
            ok: true,
            provider: aiConfig.provider,
          })
        } catch (error) {
          sendJson(response, 500, {
            error:
              error instanceof Error
                ? error.message
                : 'AI provider connection test failed.',
          })
        }
      })
    },
  }
}
