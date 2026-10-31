import { resolve } from 'node:path'

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000
export const DEFAULT_PORT = 3000

export type RuntimeConfig = {
  allowedOrigin: string | null
  maxBodyBytes: number
  port: number
  providerTimeoutMs: number
  staticDir: string
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const rawValue = env[name]

  if (rawValue === undefined || rawValue === '') {
    return fallback
  }

  const value = Number(rawValue)

  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    )
  }

  return value
}

function readAllowedOrigin(env: NodeJS.ProcessEnv) {
  const rawValue = env.RENEX_ALLOWED_ORIGIN?.trim()

  if (!rawValue) {
    return null
  }

  let parsed: URL

  try {
    parsed = new URL(rawValue)
  } catch {
    throw new Error('RENEX_ALLOWED_ORIGIN must be an absolute HTTP(S) origin.')
  }

  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    parsed.origin !== rawValue.replace(/\/$/, '') ||
    parsed.username ||
    parsed.password
  ) {
    throw new Error('RENEX_ALLOWED_ORIGIN must be an absolute HTTP(S) origin.')
  }

  return parsed.origin
}

export function getRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): RuntimeConfig {
  return {
    allowedOrigin: readAllowedOrigin(env),
    maxBodyBytes: readInteger(
      env,
      'RENEX_MAX_BODY_BYTES',
      DEFAULT_MAX_BODY_BYTES,
      1024,
      1024 * 1024,
    ),
    port: readInteger(
      env,
      env.RENEX_PORT === undefined ? 'PORT' : 'RENEX_PORT',
      DEFAULT_PORT,
      1,
      65_535,
    ),
    providerTimeoutMs: readInteger(
      env,
      'RENEX_PROVIDER_TIMEOUT_MS',
      DEFAULT_PROVIDER_TIMEOUT_MS,
      100,
      120_000,
    ),
    staticDir: resolve(workingDirectory, 'dist'),
  }
}
