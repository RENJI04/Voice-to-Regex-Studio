export const APP_NAME = 'Renex'
export const APP_TAGLINE = 'AI-Powered Regex IDE'
export const APP_DESCRIPTION =
  'AI-powered regex development platform for generation, testing, explanation, debugging, security analysis, optimization, and cross-engine conversion.'

// Keep the original keys during the Renex rebrand so existing browser data remains
// available. A future versioned migration can introduce a new namespace if needed.
export const STORAGE_KEYS = {
  aiSettings: 'voice-to-regex-studio:ai-settings',
  patternHistory: 'voice-to-regex-studio:pattern-history',
  theme: 'voice-to-regex-studio:theme',
} as const
