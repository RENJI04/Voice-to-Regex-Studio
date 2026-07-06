import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  auditPatternAgainstFixtures,
  type FixtureAuditReport,
} from './lib/fixtureAudit'

const DEFAULT_PATTERN = String.raw`\b(?<word>[A-Z][a-z]+)\b`
const DEFAULT_FLAGS = 'gm'
const DEFAULT_SAMPLE = `Voice-to-Regex Studio turns ideas into testable patterns.

Alice booked Room 42 on Monday.
Bob booked Room 17 on Friday.
No capitalized name here: widget-123.`
const DEFAULT_DESCRIPTION =
  'Match capitalized first names, and capture the name as "word".'

const AI_SETTINGS_STORAGE_KEY = 'voice-to-regex-studio:ai-settings'
const THEME_STORAGE_KEY = 'voice-to-regex-studio:theme'
const DEFAULT_CUSTOM_REQUEST_TEMPLATE = `{
  "model": "{{model}}",
  "messages": [
    { "role": "system", "content": "{{systemPrompt}}" },
    { "role": "user", "content": "{{prompt}}" }
  ]
}`
const DEFAULT_CUSTOM_RESPONSE_PATH = 'choices.0.message.content'
const DEFAULT_PROVIDER_MODELS = {
  anthropic: 'claude-sonnet-5',
  custom: 'gpt-4o-mini',
  openai: 'gpt-4o-mini',
} as const
const DEFAULT_TARGET_FLAVOR = 'javascript'
const HISTORY_STORAGE_KEY = 'voice-to-regex-studio:pattern-history'
const MAX_HISTORY_ENTRIES = 12
const MAX_RENDERED_MATCHES = 500
const REGEX_EVALUATION_TIMEOUT_MS = 350
const TARGET_FLAVORS = {
  javascript: {
    label: 'JavaScript',
    flagHelp: 'd g i m s u v y',
    previewHelp: 'Live preview uses native JavaScript RegExp.',
    supportedFlags: new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']),
  },
  python: {
    label: 'Python / re',
    flagHelp: 'i m s x a u',
    previewHelp:
      'Generation is validated with Python re. Browser preview runs only JS-compatible syntax.',
    supportedFlags: new Set(['i', 'm', 's', 'x', 'a', 'u']),
  },
  pcre: {
    label: 'PCRE',
    flagHelp: 'i m s x u U A D J',
    previewHelp:
      'Generation uses PCRE prompt rules and structural checks. Browser preview runs only JS-compatible syntax.',
    supportedFlags: new Set(['i', 'm', 's', 'x', 'u', 'U', 'A', 'D', 'J']),
  },
  're2-go': {
    label: 'RE2 / Go',
    flagHelp: 'i m s U',
    previewHelp:
      'Generation avoids RE2-unsupported constructs. Browser preview runs only JS-compatible syntax.',
    supportedFlags: new Set(['i', 'm', 's', 'U']),
  },
} as const
const TARGET_FLAVOR_OPTIONS = Object.entries(TARGET_FLAVORS).map(
  ([value, config]) => ({
    value: value as TargetFlavor,
    label: config.label,
  }),
)
const JS_PREVIEW_FLAGS = new Set(['d', 'i', 'm', 's', 'u', 'v', 'y'])

type TargetFlavor = keyof typeof TARGET_FLAVORS
type AIProviderKind = keyof typeof DEFAULT_PROVIDER_MODELS
type ThemeMode = 'dark' | 'light'

type AIProviderSettings = {
  apiKey: string
  customApiKeyHeader: string
  customApiKeyPrefix: string
  customRequestTemplate: string
  customResponsePath: string
  customUrl: string
  model: string
  provider: AIProviderKind
}

type RegexMatch = {
  id: string
  index: number
  end: number
  text: string
  groups: Array<string | undefined>
  namedGroups: Record<string, string | undefined>
  isZeroWidth: boolean
}

type EvaluationState = {
  error: string | null
  isEvaluating: boolean
  matches: RegexMatch[]
  effectiveFlags: string
  previewWarning: string | null
  timedOut: boolean
  truncated: boolean
}

type PreparedRegexEvaluation =
  | {
      state: EvaluationState
      type: 'empty' | 'error'
    }
  | {
      effectiveFlags: string
      previewFlags: string
      previewWarning: string | null
      type: 'ready'
    }

type RegexWorkerResponse =
  | {
      matches: RegexMatch[]
      truncated: boolean
      type: 'success'
    }
  | {
      error: string
      type: 'error'
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
  targetFlavor?: TargetFlavor
  model?: string
  provider?: AIProviderKind
}

type GenerateRegexClarification = {
  needsClarification: true
  question: string
  targetFlavor?: TargetFlavor
  model?: string
  provider?: AIProviderKind
}

type GenerateRegexResponse = GenerateRegexSuccess | GenerateRegexClarification

type RegexAnnotation = {
  token: string
  position: number
  meaning: string
}

type ExplainRegexResponse = {
  summary: string
  annotations: RegexAnnotation[]
  warnings: string[]
  targetFlavor?: TargetFlavor
  model?: string
  provider?: AIProviderKind
}

type HistoryEntry = {
  id: string
  pattern: string
  flags: string
  targetFlavor: TargetFlavor
  description: string
  explanation?: string
  sampleText?: string
  createdAt: number
}

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition

type BrowserSpeechRecognitionAlternative = {
  transcript: string
}

type BrowserSpeechRecognitionResult = {
  isFinal: boolean
  length: number
  [index: number]: BrowserSpeechRecognitionAlternative | undefined
}

type BrowserSpeechRecognitionResultList = {
  length: number
  [index: number]: BrowserSpeechRecognitionResult | undefined
}

type BrowserSpeechRecognitionEvent = {
  resultIndex: number
  results: BrowserSpeechRecognitionResultList
}

type BrowserSpeechRecognitionErrorEvent = {
  error?: string
  message?: string
}

type BrowserSpeechRecognition = {
  continuous: boolean
  interimResults: boolean
  lang: string
  abort: () => void
  start: () => void
  stop: () => void
  onend: (() => void) | null
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null
  onstart: (() => void) | null
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

function useDebouncedValue<T>(value: T, delayMs = 180) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delayMs)

    return () => window.clearTimeout(timer)
  }, [delayMs, value])

  return debouncedValue
}

function normalizeFlags(rawFlags: string, targetFlavor: TargetFlavor) {
  const flags = rawFlags.replace(/\s/g, '')
  const seen = new Set<string>()
  const supportedFlags = TARGET_FLAVORS[targetFlavor].supportedFlags

  for (const flag of flags) {
    if (!supportedFlags.has(flag)) {
      return {
        error: `Unsupported ${TARGET_FLAVORS[targetFlavor].label} flag "${flag}".`,
        flags,
        previewFlags: flags,
        previewWarning: null,
      }
    }

    if (seen.has(flag)) {
      return {
        error: `Duplicate flag "${flag}" is not allowed.`,
        flags,
        previewFlags: flags,
        previewWarning: null,
      }
    }

    seen.add(flag)
  }

  if (targetFlavor === 'javascript') {
    return {
      error: null,
      flags: seen.has('g') ? flags : `${flags}g`,
      previewFlags: seen.has('g') ? flags : `${flags}g`,
      previewWarning: null,
    }
  }

  const previewFlags = [...seen]
    .filter((flag) => JS_PREVIEW_FLAGS.has(flag))
    .join('')
  const ignoredFlags = [...seen].filter((flag) => !JS_PREVIEW_FLAGS.has(flag))

  return {
    error: null,
    flags,
    previewFlags: previewFlags.includes('g') ? previewFlags : `${previewFlags}g`,
    previewWarning:
      ignoredFlags.length > 0
        ? `Browser preview ignores non-JavaScript flags: ${ignoredFlags.join(', ')}.`
        : TARGET_FLAVORS[targetFlavor].previewHelp,
  }
}

function createEvaluationState(
  overrides: Partial<EvaluationState> = {},
): EvaluationState {
  return {
    error: null,
    isEvaluating: false,
    matches: [],
    effectiveFlags: '',
    previewWarning: null,
    timedOut: false,
    truncated: false,
    ...overrides,
  }
}

function prepareRegexEvaluation(
  pattern: string,
  flagsInput: string,
  targetFlavor: TargetFlavor,
): PreparedRegexEvaluation {
  if (!pattern.trim()) {
    return {
      state: createEvaluationState(),
      type: 'empty',
    }
  }

  const normalizedFlags = normalizeFlags(flagsInput, targetFlavor)

  if (normalizedFlags.error) {
    return {
      state: createEvaluationState({
        error: normalizedFlags.error,
        effectiveFlags: normalizedFlags.flags,
        previewWarning: normalizedFlags.previewWarning,
      }),
      type: 'error',
    }
  }

  return {
    effectiveFlags: normalizedFlags.flags,
    previewFlags: normalizedFlags.previewFlags,
    previewWarning: normalizedFlags.previewWarning,
    type: 'ready',
  }
}

function startRegexWorkerEvaluation({
  flags,
  pattern,
  sampleText,
  timeoutMs,
}: {
  flags: string
  pattern: string
  sampleText: string
  timeoutMs: number
}) {
  const worker = new Worker(new URL('./regexWorker.ts', import.meta.url), {
    type: 'module',
  })
  let settled = false
  let timeout: number | undefined

  const promise = new Promise<RegexWorkerResponse>((resolve) => {
    const settle = (response: RegexWorkerResponse) => {
      if (settled) {
        return
      }

      settled = true
      window.clearTimeout(timeout)
      worker.terminate()
      resolve(response)
    }

    timeout = window.setTimeout(() => {
      settle({
        error: `Regex evaluation timed out after ${timeoutMs}ms. This pattern may be vulnerable to ReDoS on the current sample text.`,
        type: 'error',
      })
    }, timeoutMs)

    worker.onmessage = (event: MessageEvent<RegexWorkerResponse>) => {
      settle(event.data)
    }

    worker.onerror = () => {
      settle({
        error: 'Regex worker failed while evaluating this pattern.',
        type: 'error',
      })
    }

    worker.postMessage({
      flags,
      maxMatches: MAX_RENDERED_MATCHES,
      pattern,
      sampleText,
    })
  })

  return {
    cancel: () => {
      if (settled) {
        return
      }

      settled = true
      window.clearTimeout(timeout)
      worker.terminate()
    },
    promise,
  }
}

function formatValue(value: string | undefined) {
  if (value === undefined) {
    return 'unmatched'
  }

  if (value === '') {
    return 'empty string'
  }

  return value
}

function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function appendTranscript(base: string, transcript: string) {
  const normalizedTranscript = transcript.trim()

  if (!normalizedTranscript) {
    return base
  }

  const normalizedBase = base.trimEnd()

  return normalizedBase
    ? `${normalizedBase} ${normalizedTranscript}`
    : normalizedTranscript
}

function formatSpeechError(error?: string) {
  switch (error) {
    case 'audio-capture':
      return 'No microphone was found. Connect a microphone or keep typing.'
    case 'network':
      return 'Speech recognition hit a network error. Try again or keep typing.'
    case 'no-speech':
      return 'No speech was detected. Try again or keep typing.'
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was blocked. Allow mic access in the browser or keep typing.'
    default:
      return 'Voice input stopped unexpectedly. You can keep typing instead.'
  }
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }

  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
}

function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY)

  if (savedTheme === 'dark' || savedTheme === 'light') {
    return savedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

function getDefaultAISettings(
  provider: AIProviderKind = 'anthropic',
): AIProviderSettings {
  return {
    apiKey: '',
    customApiKeyHeader: 'Authorization',
    customApiKeyPrefix: 'Bearer',
    customRequestTemplate: DEFAULT_CUSTOM_REQUEST_TEMPLATE,
    customResponsePath: DEFAULT_CUSTOM_RESPONSE_PATH,
    customUrl: '',
    model: DEFAULT_PROVIDER_MODELS[provider],
    provider,
  }
}

function isAIProvider(value: unknown): value is AIProviderKind {
  return value === 'anthropic' || value === 'openai' || value === 'custom'
}

function normalizeAISettings(value: unknown): AIProviderSettings {
  if (!value || typeof value !== 'object') {
    return getDefaultAISettings()
  }

  const candidate = value as Record<string, unknown>
  const provider = isAIProvider(candidate.provider) ? candidate.provider : 'anthropic'
  const defaults = getDefaultAISettings(provider)

  return {
    apiKey:
      typeof candidate.apiKey === 'string' ? candidate.apiKey : defaults.apiKey,
    customApiKeyHeader:
      typeof candidate.customApiKeyHeader === 'string'
        ? candidate.customApiKeyHeader
        : defaults.customApiKeyHeader,
    customApiKeyPrefix:
      typeof candidate.customApiKeyPrefix === 'string'
        ? candidate.customApiKeyPrefix
        : defaults.customApiKeyPrefix,
    customRequestTemplate:
      typeof candidate.customRequestTemplate === 'string'
        ? candidate.customRequestTemplate
        : defaults.customRequestTemplate,
    customResponsePath:
      typeof candidate.customResponsePath === 'string'
        ? candidate.customResponsePath
        : defaults.customResponsePath,
    customUrl:
      typeof candidate.customUrl === 'string'
        ? candidate.customUrl
        : defaults.customUrl,
    model:
      typeof candidate.model === 'string' && candidate.model.trim()
        ? candidate.model
        : defaults.model,
    provider,
  }
}

function readAISettings() {
  if (typeof localStorage === 'undefined') {
    return getDefaultAISettings()
  }

  try {
    return normalizeAISettings(
      JSON.parse(localStorage.getItem(AI_SETTINGS_STORAGE_KEY) ?? 'null'),
    )
  } catch {
    return getDefaultAISettings()
  }
}

function writeAISettings(settings: AIProviderSettings) {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.setItem(AI_SETTINGS_STORAGE_KEY, JSON.stringify(settings))
}

function isTargetFlavor(value: string | null): value is TargetFlavor {
  return value !== null && Object.prototype.hasOwnProperty.call(TARGET_FLAVORS, value)
}

function getHistoryEntryId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function readPatternHistory() {
  if (typeof localStorage === 'undefined') {
    return []
  }

  try {
    const rawHistory = localStorage.getItem(HISTORY_STORAGE_KEY)
    const parsedHistory = rawHistory ? (JSON.parse(rawHistory) as unknown) : []

    if (!Array.isArray(parsedHistory)) {
      return []
    }

    return parsedHistory
      .filter((entry): entry is HistoryEntry => {
        if (!entry || typeof entry !== 'object') {
          return false
        }

        const candidate = entry as Record<string, unknown>

        return (
          typeof candidate.id === 'string' &&
          typeof candidate.pattern === 'string' &&
          typeof candidate.flags === 'string' &&
          typeof candidate.description === 'string' &&
          typeof candidate.createdAt === 'number' &&
          typeof candidate.targetFlavor === 'string' &&
          isTargetFlavor(candidate.targetFlavor)
        )
      })
      .slice(0, MAX_HISTORY_ENTRIES)
  } catch {
    return []
  }
}

function writePatternHistory(entries: HistoryEntry[]) {
  if (typeof localStorage === 'undefined') {
    return
  }

  localStorage.setItem(
    HISTORY_STORAGE_KEY,
    JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)),
  )
}

function createHistoryEntry({
  description,
  explanation,
  flags,
  pattern,
  sampleText,
  targetFlavor,
}: Omit<HistoryEntry, 'createdAt' | 'id'>) {
  return {
    id: getHistoryEntryId(),
    pattern,
    flags,
    targetFlavor,
    description,
    explanation,
    sampleText,
    createdAt: Date.now(),
  }
}

async function generateRegexFromDescription(
  aiSettings: AIProviderSettings,
  description: string,
  sampleText: string,
  targetFlavor: TargetFlavor,
) {
  const response = await fetch('/api/generate-regex', {
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

  const payload = (await response.json()) as
    | GenerateRegexResponse
    | { error?: string }

  if (!response.ok) {
    throw new Error(
      'error' in payload && payload.error
        ? payload.error
        : 'Regex generation request failed.',
    )
  }

  return payload as GenerateRegexResponse
}

async function explainRegexPattern(
  aiSettings: AIProviderSettings,
  pattern: string,
  flags: string,
  sampleText: string,
  targetFlavor: TargetFlavor,
) {
  const response = await fetch('/api/explain-regex', {
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

  const payload = (await response.json()) as
    | ExplainRegexResponse
    | { error?: string }

  if (!response.ok) {
    throw new Error(
      'error' in payload && payload.error
        ? payload.error
        : 'Regex explanation request failed.',
    )
  }

  return payload as ExplainRegexResponse
}

async function testAIProviderConnection(aiSettings: AIProviderSettings) {
  const response = await fetch('/api/test-provider', {
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

function HighlightedSample({
  matches,
  sampleText,
}: {
  matches: RegexMatch[]
  sampleText: string
}) {
  if (!sampleText) {
    return <span className="text-stone-500">Sample text is empty.</span>
  }

  if (matches.length === 0) {
    return <span>{sampleText}</span>
  }

  const pieces: ReactNode[] = []
  let cursor = 0

  matches.forEach((match, index) => {
    if (match.index > cursor) {
      pieces.push(
        <span key={`text-${index}`}>{sampleText.slice(cursor, match.index)}</span>,
      )
    }

    if (match.isZeroWidth) {
      pieces.push(
        <span
          aria-label={`Zero-width match at index ${match.index}`}
          className="zero-width-match"
          key={`match-${match.id}`}
          title={`Zero-width match at index ${match.index}`}
        />,
      )
    } else {
      pieces.push(
        <mark
          className="match-highlight"
          key={`match-${match.id}`}
          title={`Match ${index + 1}: index ${match.index}-${match.end}`}
        >
          {sampleText.slice(match.index, match.end)}
        </mark>,
      )
    }

    cursor = Math.max(cursor, match.end)
  })

  if (cursor < sampleText.length) {
    pieces.push(<span key="text-tail">{sampleText.slice(cursor)}</span>)
  }

  return pieces
}

function EmptyState({
  description,
  title,
}: {
  description: string
  title: string
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true" />
      <div>
        <p className="empty-state__title">{title}</p>
        <p className="empty-state__description">{description}</p>
      </div>
    </div>
  )
}

function AISettingsPanel({
  error,
  isTesting,
  onSettingsChange,
  onTestConnection,
  settings,
  status,
}: {
  error: string | null
  isTesting: boolean
  onSettingsChange: (settings: AIProviderSettings) => void
  onTestConnection: () => void
  settings: AIProviderSettings
  status: string | null
}) {
  function updateSettings(patch: Partial<AIProviderSettings>) {
    onSettingsChange({
      ...settings,
      ...patch,
    })
  }

  function handleProviderChange(provider: AIProviderKind) {
    onSettingsChange({
      ...settings,
      model:
        settings.provider === provider
          ? settings.model
          : DEFAULT_PROVIDER_MODELS[provider],
      provider,
    })
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-indigo-700">
            AI settings
          </p>
          <h2 className="mt-1 text-lg font-semibold text-stone-950">
            Provider routing
          </h2>
        </div>
        <span className="w-fit rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-600">
          {settings.provider}
        </span>
      </div>

      <div className="grid gap-3">
        <label className="block">
          <span className="text-sm font-medium text-stone-700">Provider</span>
          <select
            className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 text-sm text-stone-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            onChange={(event) =>
              handleProviderChange(event.target.value as AIProviderKind)
            }
            value={settings.provider}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="custom">Custom endpoint</option>
          </select>
        </label>

        <label className="block">
          <span className="text-sm font-medium text-stone-700">Model</span>
          <input
            className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-mono text-sm text-stone-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            onChange={(event) => updateSettings({ model: event.target.value })}
            spellCheck={false}
            value={settings.model}
          />
        </label>

        <label className="block">
          <span className="text-sm font-medium text-stone-700">API key</span>
          <input
            className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-mono text-sm text-stone-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
            onChange={(event) => updateSettings({ apiKey: event.target.value })}
            spellCheck={false}
            type="password"
            value={settings.apiKey}
          />
        </label>

        {settings.provider === 'custom' ? (
          <div className="grid gap-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
            <label className="block">
              <span className="text-sm font-medium text-stone-700">
                Endpoint URL
              </span>
              <input
                className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-mono text-sm text-stone-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                onChange={(event) =>
                  updateSettings({ customUrl: event.target.value })
                }
                spellCheck={false}
                value={settings.customUrl}
              />
            </label>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-medium text-stone-700">
                  API key header
                </span>
                <input
                  className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-mono text-sm text-stone-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  onChange={(event) =>
                    updateSettings({ customApiKeyHeader: event.target.value })
                  }
                  spellCheck={false}
                  value={settings.customApiKeyHeader}
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-stone-700">
                  Key prefix
                </span>
                <input
                  className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-mono text-sm text-stone-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                  onChange={(event) =>
                    updateSettings({ customApiKeyPrefix: event.target.value })
                  }
                  spellCheck={false}
                  value={settings.customApiKeyPrefix}
                />
              </label>
            </div>

            <label className="block">
              <span className="text-sm font-medium text-stone-700">
                Request JSON template
              </span>
              <textarea
                className="mt-2 min-h-44 w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-3 font-mono text-xs leading-5 text-stone-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                onChange={(event) =>
                  updateSettings({ customRequestTemplate: event.target.value })
                }
                spellCheck={false}
                value={settings.customRequestTemplate}
              />
            </label>

            <label className="block">
              <span className="text-sm font-medium text-stone-700">
                Response text path
              </span>
              <input
                className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-mono text-sm text-stone-950 outline-none transition focus:border-indigo-500 focus:ring-4 focus:ring-indigo-100"
                onChange={(event) =>
                  updateSettings({ customResponsePath: event.target.value })
                }
                spellCheck={false}
                value={settings.customResponsePath}
              />
            </label>
          </div>
        ) : null}
      </div>

      <button
        className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-indigo-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-800 focus:outline-none focus:ring-4 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600"
        disabled={isTesting}
        onClick={onTestConnection}
        type="button"
      >
        {isTesting ? 'Testing...' : 'Test connection'}
      </button>

      {status ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {status}
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function TargetFlavorSelector({
  onChange,
  value,
}: {
  onChange: (value: TargetFlavor) => void
  value: TargetFlavor
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
        Target flavor
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TARGET_FLAVOR_OPTIONS.map((option) => {
          const isSelected = option.value === value

          return (
            <button
              className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-semibold transition focus:outline-none focus:ring-4 ${
                isSelected
                  ? 'border-sky-600 bg-sky-700 text-white focus:ring-sky-200'
                  : 'border-stone-300 bg-white text-stone-700 hover:border-sky-300 hover:bg-sky-50 focus:ring-sky-100'
              }`}
              key={option.value}
              onClick={() => onChange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function GenerationPanel({
  description,
  error,
  interimTranscript,
  isGenerating,
  isListening,
  isVoiceSupported,
  onDescriptionChange,
  onApplySuggestion,
  onGenerate,
  onTargetFlavorChange,
  onToggleVoice,
  result,
  targetFlavor,
  voiceError,
}: {
  description: string
  error: string | null
  interimTranscript: string
  isGenerating: boolean
  isListening: boolean
  isVoiceSupported: boolean
  onDescriptionChange: (value: string) => void
  onApplySuggestion: (suggestion: RegexSuggestion) => void
  onGenerate: () => void
  onTargetFlavorChange: (value: TargetFlavor) => void
  onToggleVoice: () => void
  result: GenerateRegexResponse | null
  targetFlavor: TargetFlavor
  voiceError: string | null
}) {
  const canGenerate = description.trim().length > 0 && !isGenerating

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">
            Natural language to regex
          </p>
          <h2 className="mt-1 text-lg font-semibold text-stone-950">
            Describe what to match
          </h2>
        </div>
        {result?.model ? (
          <span className="w-fit rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-600">
            {result.model}
          </span>
        ) : null}
      </div>

      <TargetFlavorSelector
        onChange={onTargetFlavorChange}
        value={targetFlavor}
      />

      <textarea
        aria-keyshortcuts="Meta+Enter Control+Enter"
        className="mt-4 min-h-28 w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-3 text-sm leading-6 text-stone-950 outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            onGenerate()
          }
        }}
        onChange={(event) => onDescriptionChange(event.target.value)}
        placeholder="Match US phone numbers, allowing spaces, dashes, or parentheses."
        value={description}
      />

      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            className="inline-flex items-center justify-center rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 focus:outline-none focus:ring-4 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600"
            disabled={!canGenerate}
            onClick={onGenerate}
            type="button"
          >
            {isGenerating ? 'Generating...' : 'Generate regex'}
          </button>

          <button
            className={`inline-flex items-center justify-center rounded-lg border px-4 py-2.5 text-sm font-semibold transition focus:outline-none focus:ring-4 disabled:cursor-not-allowed disabled:border-stone-300 disabled:bg-stone-100 disabled:text-stone-500 ${
              isListening
                ? 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus:ring-red-100'
                : 'border-sky-200 bg-sky-50 text-sky-800 hover:bg-sky-100 focus:ring-sky-100'
            }`}
            disabled={!isVoiceSupported}
            onClick={onToggleVoice}
            type="button"
          >
            {isListening ? 'Stop listening' : 'Voice input'}
          </button>
        </div>

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      {!isVoiceSupported ? (
        <p className="mt-3 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-600">
          Voice input is not supported in this browser. Text input is still
          available.
        </p>
      ) : null}

      {isListening || interimTranscript ? (
        <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-800">
              Interim transcript
            </p>
            <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-sky-700">
              {isListening ? 'Listening' : 'Finalized'}
            </span>
          </div>
          <p className="mt-2 min-h-5 text-sm leading-6 text-sky-950">
            {interimTranscript || 'Waiting for speech...'}
          </p>
        </div>
      ) : null}

      {voiceError ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          {voiceError}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-4">
          {result.needsClarification ? (
            <div>
              <p className="text-sm font-semibold text-amber-800">
                Clarification needed
              </p>
              <p className="mt-2 text-sm text-stone-700">{result.question}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Pattern
                  </p>
                  <code className="mt-1 block overflow-auto rounded bg-stone-950 px-3 py-2 font-mono text-xs text-stone-100">
                    {result.pattern}
                  </code>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Flags
                  </p>
                  <code className="mt-1 block rounded bg-stone-950 px-3 py-2 font-mono text-xs text-stone-100">
                    {result.flags || 'none'}
                  </code>
                </div>
              </div>

              <p className="text-sm leading-6 text-stone-700">
                {result.explanation}
              </p>

              {result.warnings.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
                    Warnings
                  </p>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                    {result.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {result.suggestions.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Edge-case suggestions
                  </p>
                  {result.suggestions.map((suggestion) => (
                    <div
                      className="rounded-lg border border-sky-200 bg-white p-3"
                      key={`${suggestion.title}-${suggestion.request}`}
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-stone-950">
                            {suggestion.title}
                          </p>
                          <p className="mt-1 text-sm leading-5 text-stone-600">
                            {suggestion.description}
                          </p>
                        </div>
                        <button
                          className="inline-flex shrink-0 items-center justify-center rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800 transition hover:bg-sky-100 focus:outline-none focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-500"
                          disabled={isGenerating}
                          onClick={() => onApplySuggestion(suggestion)}
                          type="button"
                        >
                          Apply
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  )
}

function AnnotatedPattern({
  activeIndex,
  annotations,
  onActiveIndexChange,
  pattern,
}: {
  activeIndex: number | null
  annotations: RegexAnnotation[]
  onActiveIndexChange: (index: number | null) => void
  pattern: string
}) {
  const pieces: ReactNode[] = []
  let cursor = 0

  annotations.forEach((annotation, index) => {
    const start = annotation.position
    const end = start + annotation.token.length

    if (start < cursor || start > pattern.length || end > pattern.length) {
      return
    }

    if (start > cursor) {
      pieces.push(
        <span key={`text-${index}`}>{pattern.slice(cursor, start)}</span>,
      )
    }

    const isActive = activeIndex === index

    pieces.push(
      <button
        className={`rounded px-0.5 font-mono transition ${
          isActive
            ? 'bg-violet-300 text-violet-950 ring-2 ring-violet-500'
            : 'bg-violet-100 text-violet-950 ring-1 ring-violet-200 hover:bg-violet-200'
        }`}
        key={`annotation-${annotation.position}-${annotation.token}`}
        onBlur={() => onActiveIndexChange(null)}
        onFocus={() => onActiveIndexChange(index)}
        onMouseEnter={() => onActiveIndexChange(index)}
        onMouseLeave={() => onActiveIndexChange(null)}
        title={annotation.meaning}
        type="button"
      >
        {pattern.slice(start, end)}
      </button>,
    )

    cursor = end
  })

  if (cursor < pattern.length) {
    pieces.push(<span key="text-tail">{pattern.slice(cursor)}</span>)
  }

  return (
    <div className="whitespace-pre-wrap break-all rounded-lg border border-stone-200 bg-stone-950 p-3 font-mono text-sm leading-7 text-stone-100">
      {pieces.length > 0 ? pieces : pattern || 'No regex pattern entered.'}
    </div>
  )
}

function RegexExplainerPanel({
  error,
  isExplaining,
  onExplain,
  pattern,
  regexError,
  result,
}: {
  error: string | null
  isExplaining: boolean
  onExplain: () => void
  pattern: string
  regexError: string | null
  result: ExplainRegexResponse | null
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const canExplain = pattern.trim().length > 0 && !isExplaining && !regexError

  useEffect(() => {
    setActiveIndex(null)
  }, [result])

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">
            Regex to English
          </p>
          <h2 className="mt-1 text-lg font-semibold text-stone-950">
            Explain current pattern
          </h2>
        </div>
        {result?.model ? (
          <span className="w-fit rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-600">
            {result.model}
          </span>
        ) : null}
      </div>

      <button
        className="inline-flex w-full items-center justify-center rounded-lg bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-800 focus:outline-none focus:ring-4 focus:ring-violet-200 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-600"
        disabled={!canExplain}
        onClick={onExplain}
        type="button"
      >
        {isExplaining ? 'Explaining...' : 'Explain regex'}
      </button>

      {regexError ? (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
          Fix the regex before requesting an explanation.
        </p>
      ) : null}

      {error ? (
        <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-4">
          <p className="text-sm leading-6 text-stone-700">{result.summary}</p>

          <AnnotatedPattern
            activeIndex={activeIndex}
            annotations={result.annotations}
            onActiveIndexChange={setActiveIndex}
            pattern={pattern}
          />

          <div className="space-y-2">
            {result.annotations.map((annotation, index) => {
              const isActive = activeIndex === index

              return (
                <button
                  className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                    isActive
                      ? 'border-violet-400 bg-violet-50 shadow-sm'
                      : 'border-stone-200 bg-stone-50 hover:border-violet-200 hover:bg-white'
                  }`}
                  key={`${annotation.position}-${annotation.token}-${index}`}
                  onBlur={() => setActiveIndex(null)}
                  onFocus={() => setActiveIndex(index)}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseLeave={() => setActiveIndex(null)}
                  type="button"
                >
                  <span className="block font-mono text-xs font-semibold text-violet-800">
                    {annotation.token} at {annotation.position}
                  </span>
                  <span className="mt-1 block text-sm leading-5 text-stone-700">
                    {annotation.meaning}
                  </span>
                </button>
              )
            })}
          </div>

          {result.warnings.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">
                Warnings
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-4 text-sm text-stone-500">
          Paste or generate a regex, then explain it here.
        </div>
      )}
    </section>
  )
}

function formatHistoryDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(timestamp)
}

function PatternHistoryPanel({
  entries,
  onLoadEntry,
  onSaveCurrent,
  onShareCurrent,
  shareStatus,
}: {
  entries: HistoryEntry[]
  onLoadEntry: (entry: HistoryEntry) => void
  onSaveCurrent: () => void
  onShareCurrent: () => void
  shareStatus: string | null
}) {
  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700">
            Local history
          </p>
          <h2 className="mt-1 text-lg font-semibold text-stone-950">
            Saved patterns
          </h2>
        </div>
        <span className="w-fit rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-600">
          {entries.length}/{MAX_HISTORY_ENTRIES}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button
          className="inline-flex items-center justify-center rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800 transition hover:bg-teal-100 focus:outline-none focus:ring-4 focus:ring-teal-100"
          onClick={onSaveCurrent}
          type="button"
        >
          Save current
        </button>
        <button
          className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm font-semibold text-stone-700 transition hover:border-teal-200 hover:bg-teal-50 focus:outline-none focus:ring-4 focus:ring-teal-100"
          onClick={onShareCurrent}
          type="button"
        >
          Share URL
        </button>
      </div>

      {shareStatus ? (
        <p className="mt-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800">
          {shareStatus}
        </p>
      ) : null}

      <div className="mt-4 space-y-2">
        {entries.length === 0 ? (
          <EmptyState
            description="Generated or saved patterns will appear here for quick reloads."
            title="No saved patterns"
          />
        ) : (
          entries.map((entry) => (
            <button
              className="w-full rounded-lg border border-stone-200 bg-stone-50 p-3 text-left transition hover:border-teal-200 hover:bg-white focus:outline-none focus:ring-4 focus:ring-teal-100"
              key={entry.id}
              onClick={() => onLoadEntry(entry)}
              type="button"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-stone-600">
                  {TARGET_FLAVORS[entry.targetFlavor].label}
                </span>
                <span className="text-xs text-stone-500">
                  {formatHistoryDate(entry.createdAt)}
                </span>
              </div>
              <code className="mt-2 block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs text-stone-950">
                {entry.pattern}
              </code>
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-stone-600">
                {entry.description || 'Saved regex pattern'}
              </p>
            </button>
          ))
        )}
      </div>
    </section>
  )
}

function FixtureAuditPanel({ report }: { report: FixtureAuditReport | null }) {
  const sourceLabel =
    report?.source === 'generation'
      ? 'Generated pattern'
      : report?.source === 'explanation'
        ? 'Explained regex'
        : 'Waiting'

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-700">
            Regression suite
          </p>
          <h2 className="mt-1 text-lg font-semibold text-stone-950">
            Fixture audit
          </h2>
        </div>
        <span className="w-fit rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-600">
          {report ? `${report.fixturesChecked} cases` : sourceLabel}
        </span>
      </div>

      {!report ? (
        <EmptyState
          description="Generate or explain a regex to run it against curated edge-case fixtures."
          title="No fixture run yet"
        />
      ) : report.status === 'skipped' ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-900">
          {report.skippedReason}
        </div>
      ) : report.findings.length === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-800">
            No surprising fixture results.
          </p>
          <p className="mt-1 text-sm leading-6 text-emerald-800">
            {sourceLabel} passed {report.fixturesChecked} relevant edge-case
            checks.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {sourceLabel} produced {report.findings.length} result
            {report.findings.length === 1 ? '' : 's'} worth reviewing.
          </p>
          {report.findings.map((finding) => {
            const tone =
              finding.severity === 'warning'
                ? 'border-amber-200 bg-amber-50'
                : 'border-stone-200 bg-stone-50'

            return (
              <article
                className={`rounded-lg border p-3 ${tone}`}
                key={`${finding.fixtureId}-${finding.title}-${finding.matchPreview}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-stone-950">
                      {finding.title}
                    </h3>
                    <p className="mt-1 text-sm leading-5 text-stone-700">
                      {finding.details}
                    </p>
                  </div>
                  <span className="rounded-full border border-stone-300 bg-white px-2 py-0.5 text-xs font-medium text-stone-600">
                    {finding.matchCount} match
                    {finding.matchCount === 1 ? '' : 'es'}
                  </span>
                </div>
                <div className="mt-3 grid gap-2">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                      First match
                    </p>
                    <code className="mt-1 block max-h-24 overflow-auto whitespace-pre-wrap rounded bg-white px-2 py-1 font-mono text-xs text-stone-800">
                      {finding.matchPreview}
                    </code>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                      Fixture
                    </p>
                    <code className="mt-1 block max-h-24 overflow-auto whitespace-pre-wrap rounded bg-white px-2 py-1 font-mono text-xs text-stone-800">
                      {finding.samplePreview}
                    </code>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}

function CaptureGroups({ matches }: { matches: RegexMatch[] }) {
  if (matches.length === 0) {
    return (
      <EmptyState
        description="Matches and capture groups will appear here as soon as the pattern finds text."
        title="No matches yet"
      />
    )
  }

  return (
    <div className="space-y-3">
      {matches.map((match, matchIndex) => {
        const namedGroups = Object.entries(match.namedGroups)

        return (
          <article
            className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm"
            key={match.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-stone-950">
                  Match {matchIndex + 1}
                </h3>
                <p className="mt-1 font-mono text-xs text-stone-500">
                  index {match.index}-{match.end}
                </p>
              </div>
              <code className="max-w-full rounded bg-stone-100 px-2 py-1 font-mono text-xs text-stone-800">
                {match.isZeroWidth ? 'zero-width' : match.text}
              </code>
            </div>

            {match.groups.length > 0 || namedGroups.length > 0 ? (
              <div className="mt-4 grid gap-2">
                {match.groups.map((group, groupIndex) => (
                  <div
                    className="grid grid-cols-[5.5rem_1fr] gap-3 rounded-md bg-stone-50 px-3 py-2 text-sm"
                    key={`${match.id}-group-${groupIndex}`}
                  >
                    <span className="font-mono text-xs text-stone-500">
                      group {groupIndex + 1}
                    </span>
                    <span className="break-words font-mono text-stone-800">
                      {formatValue(group)}
                    </span>
                  </div>
                ))}

                {namedGroups.map(([name, value]) => (
                  <div
                    className="grid grid-cols-[5.5rem_1fr] gap-3 rounded-md bg-emerald-50 px-3 py-2 text-sm"
                    key={`${match.id}-named-${name}`}
                  >
                    <span className="font-mono text-xs text-emerald-700">
                      {name}
                    </span>
                    <span className="break-words font-mono text-emerald-950">
                      {formatValue(value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-4 rounded-md bg-stone-50 px-3 py-2 text-sm text-stone-500">
                No capture groups for this match.
              </p>
            )}
          </article>
        )
      })}
    </div>
  )
}

function App() {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null)
  const speechBaseDescriptionRef = useRef(DEFAULT_DESCRIPTION)
  const interimTranscriptRef = useRef('')
  const [aiSettings, setAISettings] = useState<AIProviderSettings>(() =>
    getDefaultAISettings(),
  )
  const [aiSettingsError, setAISettingsError] = useState<string | null>(null)
  const [aiSettingsStatus, setAISettingsStatus] = useState<string | null>(null)
  const [isTestingProvider, setIsTestingProvider] = useState(false)
  const [generationDescription, setGenerationDescription] =
    useState(DEFAULT_DESCRIPTION)
  const [generatedResult, setGeneratedResult] =
    useState<GenerateRegexResponse | null>(null)
  const [fixtureAudit, setFixtureAudit] = useState<FixtureAuditReport | null>(
    null,
  )
  const [generationError, setGenerationError] = useState<string | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [interimTranscript, setInterimTranscript] = useState('')
  const [isListening, setIsListening] = useState(false)
  const [voiceError, setVoiceError] = useState<string | null>(null)
  const [explanationResult, setExplanationResult] =
    useState<ExplainRegexResponse | null>(null)
  const [explanationError, setExplanationError] = useState<string | null>(null)
  const [evaluation, setEvaluation] = useState<EvaluationState>(() =>
    createEvaluationState(),
  )
  const [isExplaining, setIsExplaining] = useState(false)
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([])
  const [pattern, setPattern] = useState(DEFAULT_PATTERN)
  const [flags, setFlags] = useState(DEFAULT_FLAGS)
  const [sampleText, setSampleText] = useState(DEFAULT_SAMPLE)
  const [copyStatus, setCopyStatus] = useState<string | null>(null)
  const [shareStatus, setShareStatus] = useState<string | null>(null)
  const [targetFlavor, setTargetFlavor] = useState<TargetFlavor>(
    DEFAULT_TARGET_FLAVOR,
  )
  const [themeMode, setThemeMode] = useState<ThemeMode>(getInitialTheme)

  const debouncedPattern = useDebouncedValue(pattern)
  const debouncedFlags = useDebouncedValue(flags)
  const debouncedSampleText = useDebouncedValue(sampleText)
  const SpeechRecognitionCtor = useMemo(getSpeechRecognitionConstructor, [])
  const isVoiceSupported = SpeechRecognitionCtor !== null

  const isUpdating =
    pattern !== debouncedPattern ||
    flags !== debouncedFlags ||
    sampleText !== debouncedSampleText ||
    evaluation.isEvaluating

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode
    localStorage.setItem(THEME_STORAGE_KEY, themeMode)
  }, [themeMode])

  useEffect(() => {
    const preparedEvaluation = prepareRegexEvaluation(
      debouncedPattern,
      debouncedFlags,
      targetFlavor,
    )

    if (preparedEvaluation.type !== 'ready') {
      setEvaluation(preparedEvaluation.state)
      return undefined
    }

    setEvaluation(
      createEvaluationState({
        effectiveFlags: preparedEvaluation.effectiveFlags,
        isEvaluating: true,
        previewWarning: preparedEvaluation.previewWarning,
      }),
    )

    const workerEvaluation = startRegexWorkerEvaluation({
      flags: preparedEvaluation.previewFlags,
      pattern: debouncedPattern,
      sampleText: debouncedSampleText,
      timeoutMs: REGEX_EVALUATION_TIMEOUT_MS,
    })

    void workerEvaluation.promise.then((response) => {
      if (response.type === 'success') {
        setEvaluation(
          createEvaluationState({
            effectiveFlags: preparedEvaluation.effectiveFlags,
            matches: response.matches,
            previewWarning: preparedEvaluation.previewWarning,
            truncated: response.truncated,
          }),
        )
        return
      }

      const isTimeout = response.error.includes('timed out')
      const errorMessage =
        targetFlavor === 'javascript' || isTimeout
          ? response.error
          : `Browser preview could not run this ${TARGET_FLAVORS[targetFlavor].label} pattern as JavaScript. ${response.error}`

      setEvaluation(
        createEvaluationState({
          effectiveFlags: preparedEvaluation.effectiveFlags,
          error: errorMessage,
          previewWarning: preparedEvaluation.previewWarning,
          timedOut: isTimeout,
        }),
      )
    })

    return () => workerEvaluation.cancel()
  }, [debouncedFlags, debouncedPattern, debouncedSampleText, targetFlavor])

  useEffect(() => {
    setAISettings(readAISettings())
    setHistoryEntries(readPatternHistory())

    const searchParams = new URLSearchParams(window.location.search)
    const sharedPattern = searchParams.get('pattern')
    const sharedFlags = searchParams.get('flags')
    const sharedFlavor = searchParams.get('flavor')
    const sharedDescription = searchParams.get('description')

    if (isTargetFlavor(sharedFlavor)) {
      setTargetFlavor(sharedFlavor)
    }

    if (sharedPattern !== null) {
      setPattern(sharedPattern)
    }

    if (sharedFlags !== null) {
      setFlags(sharedFlags)
    }

    if (sharedDescription !== null) {
      setGenerationDescription(sharedDescription)
      speechBaseDescriptionRef.current = sharedDescription
    }
  }, [])

  useEffect(() => {
    writePatternHistory(historyEntries)
  }, [historyEntries])

  useEffect(() => {
    writeAISettings(aiSettings)
  }, [aiSettings])

  useEffect(() => {
    setExplanationResult(null)
    setExplanationError(null)
    setCopyStatus(null)
  }, [flags, pattern, targetFlavor])

  function handleDescriptionChange(value: string) {
    setGenerationDescription(value)

    if (!isListening) {
      speechBaseDescriptionRef.current = value
    }

    if (voiceError) {
      setVoiceError(null)
    }

    if (generationError) {
      setGenerationError(null)
    }
  }

  function handlePatternChange(value: string) {
    setPattern(value)
    setFixtureAudit(null)
  }

  function handleFlagsChange(value: string) {
    setFlags(value)
    setFixtureAudit(null)
  }

  function handleToggleVoiceInput() {
    if (isListening) {
      recognitionRef.current?.stop()
      return
    }

    if (!SpeechRecognitionCtor) {
      setVoiceError(
        'Voice input is not supported in this browser. Text input is still available.',
      )
      return
    }

    const recognition = new SpeechRecognitionCtor()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'
    recognition.onstart = () => {
      setIsListening(true)
      setVoiceError(null)
    }
    recognition.onresult = (event) => {
      let finalTranscript = ''
      let nextInterimTranscript = ''

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const transcript = result?.[0]?.transcript ?? ''

        if (result?.isFinal) {
          finalTranscript += transcript
        } else {
          nextInterimTranscript += transcript
        }
      }

      if (finalTranscript) {
        const nextBase = appendTranscript(
          speechBaseDescriptionRef.current,
          finalTranscript,
        )

        speechBaseDescriptionRef.current = nextBase
        setGenerationDescription(nextBase)
      }

      interimTranscriptRef.current = nextInterimTranscript.trim()
      setInterimTranscript(interimTranscriptRef.current)

      if (interimTranscriptRef.current) {
        setGenerationDescription(
          appendTranscript(
            speechBaseDescriptionRef.current,
            interimTranscriptRef.current,
          ),
        )
      } else if (finalTranscript) {
        setGenerationDescription(speechBaseDescriptionRef.current)
      }
    }
    recognition.onerror = (event) => {
      setVoiceError(formatSpeechError(event.error))
      interimTranscriptRef.current = ''
      setInterimTranscript('')
      setIsListening(false)
    }
    recognition.onend = () => {
      if (interimTranscriptRef.current) {
        const nextBase = appendTranscript(
          speechBaseDescriptionRef.current,
          interimTranscriptRef.current,
        )

        speechBaseDescriptionRef.current = nextBase
        setGenerationDescription(nextBase)
      }

      interimTranscriptRef.current = ''
      setInterimTranscript('')
      setIsListening(false)
      recognitionRef.current = null
    }

    recognitionRef.current = recognition
    speechBaseDescriptionRef.current = generationDescription
    interimTranscriptRef.current = ''
    setInterimTranscript('')
    setVoiceError(null)

    try {
      recognition.start()
    } catch (error) {
      recognitionRef.current = null
      setVoiceError(
        error instanceof Error
          ? error.message
          : 'Could not start voice input. You can keep typing instead.',
      )
    }
  }

  function addHistoryEntry(entry: HistoryEntry) {
    setHistoryEntries((currentEntries) => {
      const withoutDuplicate = currentEntries.filter(
        (currentEntry) =>
          !(
            currentEntry.pattern === entry.pattern &&
            currentEntry.flags === entry.flags &&
            currentEntry.targetFlavor === entry.targetFlavor
          ),
      )

      return [entry, ...withoutDuplicate].slice(0, MAX_HISTORY_ENTRIES)
    })
  }

  async function runGenerateRegex(description: string) {
    if (!description || isGenerating) {
      return
    }

    setIsGenerating(true)
    setGenerationError(null)
    setGeneratedResult(null)
    setExplanationError(null)
    setExplanationResult(null)
    setFixtureAudit(null)

    try {
      const result = await generateRegexFromDescription(
        aiSettings,
        description,
        sampleText,
        targetFlavor,
      )

      setGeneratedResult(result)

      if (!result.needsClarification) {
        setPattern(result.pattern)
        setFlags(result.flags)
        setFixtureAudit(
          auditPatternAgainstFixtures({
            flags: result.flags,
            pattern: result.pattern,
            source: 'generation',
            targetFlavor,
          }),
        )
        addHistoryEntry(
          createHistoryEntry({
            pattern: result.pattern,
            flags: result.flags,
            targetFlavor,
            description,
            explanation: result.explanation,
            sampleText,
          }),
        )
      }
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : 'Unable to generate a regex.',
      )
    } finally {
      setIsGenerating(false)
    }
  }

  function handleGenerateRegex() {
    void runGenerateRegex(generationDescription.trim())
  }

  function handleApplySuggestion(suggestion: RegexSuggestion) {
    const nextDescription = appendTranscript(
      generationDescription,
      suggestion.request,
    )

    setGenerationDescription(nextDescription)
    speechBaseDescriptionRef.current = nextDescription
    void runGenerateRegex(nextDescription)
  }

  function handleTargetFlavorChange(nextTargetFlavor: TargetFlavor) {
    setTargetFlavor(nextTargetFlavor)
    setFlags((currentFlags) =>
      [...currentFlags]
        .filter((flag) => TARGET_FLAVORS[nextTargetFlavor].supportedFlags.has(flag))
        .join(''),
    )
    setGeneratedResult(null)
    setGenerationError(null)
    setExplanationResult(null)
    setExplanationError(null)
    setFixtureAudit(null)
  }

  function handleAISettingsChange(nextSettings: AIProviderSettings) {
    setAISettings(nextSettings)
    setAISettingsError(null)
    setAISettingsStatus(null)
    setGenerationError(null)
    setExplanationError(null)
  }

  function handleToggleTheme() {
    setThemeMode((currentTheme) =>
      currentTheme === 'dark' ? 'light' : 'dark',
    )
  }

  async function handleTestAIProvider() {
    setIsTestingProvider(true)
    setAISettingsError(null)
    setAISettingsStatus(null)

    try {
      await testAIProviderConnection(aiSettings)
      setAISettingsStatus('Connection test succeeded.')
    } catch (error) {
      setAISettingsError(
        error instanceof Error ? error.message : 'Connection test failed.',
      )
    } finally {
      setIsTestingProvider(false)
    }
  }

  function handleSaveCurrentPattern() {
    if (!pattern.trim()) {
      setShareStatus('Enter a pattern before saving it.')
      return
    }

    addHistoryEntry(
      createHistoryEntry({
        pattern,
        flags,
        targetFlavor,
        description: generationDescription,
        explanation:
          generatedResult && !generatedResult.needsClarification
            ? generatedResult.explanation
            : undefined,
        sampleText,
      }),
    )
    setShareStatus('Pattern saved locally.')
  }

  function handleLoadHistoryEntry(entry: HistoryEntry) {
    setPattern(entry.pattern)
    setFlags(entry.flags)
    setTargetFlavor(entry.targetFlavor)
    setGenerationDescription(entry.description)
    setFixtureAudit(null)
    speechBaseDescriptionRef.current = entry.description

    if (entry.sampleText !== undefined) {
      setSampleText(entry.sampleText)
    }

    setShareStatus('Pattern loaded from history.')
  }

  function handleShareCurrentPattern() {
    if (!pattern.trim()) {
      setShareStatus('Enter a pattern before sharing it.')
      return
    }

    const url = new URL(window.location.href)
    url.searchParams.set('pattern', pattern)
    url.searchParams.set('flags', flags)
    url.searchParams.set('flavor', targetFlavor)
    url.searchParams.set('description', generationDescription)
    window.history.replaceState(null, '', url)

    handleSaveCurrentPattern()

    const clipboardWrite = navigator.clipboard?.writeText(url.toString())

    if (clipboardWrite) {
      void clipboardWrite
        .then(() =>
          setShareStatus('Share URL copied and added to the address bar.'),
        )
        .catch(() => setShareStatus('Share URL added to the address bar.'))
    } else {
      setShareStatus('Share URL added to the address bar.')
    }
  }

  async function handleCopyPattern() {
    if (!pattern.trim()) {
      setCopyStatus('Enter a pattern before copying it.')
      return
    }

    try {
      await copyTextToClipboard(pattern)
      setCopyStatus('Pattern copied.')
    } catch {
      setCopyStatus('Could not copy the pattern in this browser.')
    }
  }

  async function handleExplainRegex() {
    if (
      !pattern.trim() ||
      (targetFlavor === 'javascript' && evaluation.error) ||
      isExplaining
    ) {
      return
    }

    setIsExplaining(true)
    setExplanationError(null)
    setExplanationResult(null)
    setFixtureAudit(null)

    try {
      const result = await explainRegexPattern(
        aiSettings,
        pattern,
        flags,
        sampleText,
        targetFlavor,
      )

      setExplanationResult(result)
      setFixtureAudit(
        auditPatternAgainstFixtures({
          flags,
          pattern,
          source: 'explanation',
          targetFlavor,
        }),
      )
    } catch (error) {
      setExplanationError(
        error instanceof Error ? error.message : 'Unable to explain this regex.',
      )
    } finally {
      setIsExplaining(false)
    }
  }

  return (
    <main className="app-shell min-h-screen">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8">
        <header className="mb-5 flex flex-col justify-between gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-700">
              Regex Studio
            </p>
            <h1 className="mt-2 text-3xl font-semibold text-stone-950 sm:text-4xl">
              Voice-to-Regex Studio
            </h1>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <button
              aria-label={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`}
              aria-pressed={themeMode === 'dark'}
              className="theme-toggle"
              onClick={handleToggleTheme}
              type="button"
            >
              <span className="theme-toggle__track" aria-hidden="true">
                <span className="theme-toggle__thumb">
                  <span className="theme-toggle__sun">☀</span>
                  <span className="theme-toggle__moon">☾</span>
                </span>
              </span>
            </button>
            <span className="rounded-full border border-stone-300 bg-white px-3 py-1 text-stone-600">
              {evaluation.timedOut
                ? 'Timed out'
                : evaluation.isEvaluating
                  ? 'Checking...'
                  : isUpdating
                    ? 'Updating...'
                    : 'Live'}
            </span>
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-800">
              {evaluation.matches.length}
              {evaluation.truncated ? '+' : ''} matches
            </span>
          </div>
        </header>

        <div className="grid flex-1 gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(22rem,0.95fr)]">
          <section className="grid gap-5">
            <GenerationPanel
              description={generationDescription}
              error={generationError}
              interimTranscript={interimTranscript}
              isGenerating={isGenerating}
              isListening={isListening}
              isVoiceSupported={isVoiceSupported}
              onApplySuggestion={handleApplySuggestion}
              onDescriptionChange={handleDescriptionChange}
              onGenerate={handleGenerateRegex}
              onTargetFlavorChange={handleTargetFlavorChange}
              onToggleVoice={handleToggleVoiceInput}
              result={generatedResult}
              targetFlavor={targetFlavor}
              voiceError={voiceError}
            />

            <div className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500">
                    Sandbox target
                  </p>
                  <h2 className="mt-1 text-lg font-semibold text-stone-950">
                    {TARGET_FLAVORS[targetFlavor].label}
                  </h2>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="w-fit rounded-full border border-stone-300 bg-stone-50 px-3 py-1 text-xs font-medium text-stone-600">
                    Flags: {TARGET_FLAVORS[targetFlavor].flagHelp}
                  </span>
                  <button
                    className="inline-flex items-center justify-center rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-xs font-semibold text-stone-700 transition hover:border-emerald-200 hover:bg-emerald-50 focus:outline-none focus:ring-4 focus:ring-emerald-100"
                    onClick={handleCopyPattern}
                    type="button"
                  >
                    Copy pattern
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
                <label className="block">
                  <span className="text-sm font-medium text-stone-700">Regex</span>
                  <input
                    className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-mono text-sm text-stone-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    onChange={(event) => handlePatternChange(event.target.value)}
                    placeholder={String.raw`\bexample\b`}
                    spellCheck={false}
                    type="text"
                    value={pattern}
                  />
                </label>

                <label className="block">
                  <span className="text-sm font-medium text-stone-700">Flags</span>
                  <input
                    className="mt-2 w-full rounded-lg border border-stone-300 bg-white px-3 py-2.5 font-mono text-sm text-stone-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                    onChange={(event) => handleFlagsChange(event.target.value)}
                    placeholder="gm"
                    spellCheck={false}
                    type="text"
                    value={flags}
                  />
                </label>
              </div>

              {evaluation.error ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  {evaluation.error}
                </p>
              ) : (
                <p className="mt-3 text-sm text-stone-500">
                  Effective flags:{' '}
                  <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-stone-700">
                    {evaluation.effectiveFlags || 'none'}
                  </code>
                </p>
              )}

              {evaluation.previewWarning ? (
                <p className="mt-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800">
                  {evaluation.previewWarning}
                </p>
              ) : null}

              {copyStatus ? (
                <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                  {copyStatus}
                </p>
              ) : null}
            </div>

            <label className="block rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
              <span className="text-sm font-medium text-stone-700">Sample text</span>
              <textarea
                className="mt-2 min-h-72 w-full resize-y rounded-lg border border-stone-300 bg-white px-3 py-3 font-mono text-sm leading-6 text-stone-950 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-100"
                onChange={(event) => setSampleText(event.target.value)}
                spellCheck={false}
                value={sampleText}
              />
            </label>

            <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-stone-800">
                  Highlighted matches
                </h2>
                {evaluation.truncated ? (
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-800">
                    Showing first {MAX_RENDERED_MATCHES}
                  </span>
                ) : null}
              </div>
              <pre className="min-h-44 overflow-auto whitespace-pre-wrap rounded-lg border border-stone-200 bg-stone-950 p-4 font-mono text-sm leading-6 text-stone-100">
                {!pattern.trim() ? (
                  <span className="empty-inline">
                    <span className="empty-inline__icon" aria-hidden="true" />
                    <span>Enter a regex to preview matches.</span>
                  </span>
                ) : evaluation.isEvaluating ? (
                  <span className="text-stone-400">
                    Checking matches in a worker...
                  </span>
                ) : evaluation.error ? (
                  <span className="text-stone-400">
                    {evaluation.timedOut
                      ? 'Regex evaluation was stopped before it could block the page.'
                      : 'Fix the regex error to preview matches.'}
                  </span>
                ) : (
                  <HighlightedSample
                    matches={evaluation.matches}
                    sampleText={sampleText}
                  />
                )}
              </pre>
            </section>
          </section>

          <aside className="grid content-start gap-5">
            <AISettingsPanel
              error={aiSettingsError}
              isTesting={isTestingProvider}
              onSettingsChange={handleAISettingsChange}
              onTestConnection={handleTestAIProvider}
              settings={aiSettings}
              status={aiSettingsStatus}
            />

            <RegexExplainerPanel
              error={explanationError}
              isExplaining={isExplaining}
              onExplain={handleExplainRegex}
              pattern={pattern}
              regexError={targetFlavor === 'javascript' ? evaluation.error : null}
              result={explanationResult}
            />

            <FixtureAuditPanel report={fixtureAudit} />

            <PatternHistoryPanel
              entries={historyEntries}
              onLoadEntry={handleLoadHistoryEntry}
              onSaveCurrent={handleSaveCurrentPattern}
              onShareCurrent={handleShareCurrentPattern}
              shareStatus={shareStatus}
            />

            <section className="rounded-xl border border-stone-200 bg-stone-50 p-4 shadow-sm sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-stone-950">
                    Matches
                  </h2>
                  <p className="mt-1 text-sm text-stone-500">
                    Capture groups per match
                  </p>
                </div>
                <span className="rounded-full border border-stone-300 bg-white px-3 py-1 text-sm font-medium text-stone-700">
                  {evaluation.matches.length}
                  {evaluation.truncated ? '+' : ''}
                </span>
              </div>

              {!pattern.trim() ? (
                <EmptyState
                  description="Enter a regex and sample text to inspect capture groups."
                  title="Ready for a pattern"
                />
              ) : evaluation.isEvaluating ? (
                <div className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-500">
                  Checking capture groups in the regex worker.
                </div>
              ) : evaluation.error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  Results are paused until the pattern is valid.
                </div>
              ) : (
                <CaptureGroups matches={evaluation.matches} />
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  )
}

export default App
