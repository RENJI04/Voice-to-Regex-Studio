import {
  DEFAULT_CUSTOM_REQUEST_TEMPLATE,
  DEFAULT_CUSTOM_RESPONSE_PATH,
  DEFAULT_PROVIDER_MODELS,
  TARGET_FLAVOR_IDS,
  type AIProviderKind,
  type AIProviderSettings,
  type TargetFlavor,
} from '../../shared/ai'
import { STORAGE_KEYS } from '../config/app'

export const MAX_HISTORY_ENTRIES = 12

export type ThemeMode = 'dark' | 'light'

export type HistoryEntry = {
  id: string
  pattern: string
  flags: string
  targetFlavor: TargetFlavor
  description: string
  explanation?: string
  sampleText?: string
  createdAt: number
}

export function getInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') {
    return 'light'
  }

  const savedTheme = window.localStorage.getItem(STORAGE_KEYS.theme)

  if (savedTheme === 'dark' || savedTheme === 'light') {
    return savedTheme
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light'
}

export function getDefaultAISettings(
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

export function readAISettings() {
  if (typeof window === 'undefined') {
    return getDefaultAISettings()
  }

  try {
    return normalizeAISettings(
      JSON.parse(window.localStorage.getItem(STORAGE_KEYS.aiSettings) ?? 'null'),
    )
  } catch {
    return getDefaultAISettings()
  }
}

export function writeAISettings(settings: AIProviderSettings) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(STORAGE_KEYS.aiSettings, JSON.stringify(settings))
}

export function isTargetFlavor(value: string | null): value is TargetFlavor {
  return (
    value !== null &&
    (TARGET_FLAVOR_IDS as readonly string[]).includes(value)
  )
}

export function readPatternHistory() {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const rawHistory = window.localStorage.getItem(STORAGE_KEYS.patternHistory)
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

export function writePatternHistory(entries: HistoryEntry[]) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(
    STORAGE_KEYS.patternHistory,
    JSON.stringify(entries.slice(0, MAX_HISTORY_ENTRIES)),
  )
}

function getHistoryEntryId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createHistoryEntry({
  description,
  explanation,
  flags,
  pattern,
  sampleText,
  targetFlavor,
}: Omit<HistoryEntry, 'createdAt' | 'id'>): HistoryEntry {
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
