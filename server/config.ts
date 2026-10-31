import { resolve } from 'node:path'

export const DEFAULT_DNS_TIMEOUT_MS = 3_000
export const DEFAULT_MAX_BODY_BYTES = 64 * 1024
export const DEFAULT_MAX_PROVIDER_RESPONSE_BYTES = 1024 * 1024
export const DEFAULT_PORT = 3000
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000
export const DEFAULT_RATE_LIMIT = 60
export const DEFAULT_RATE_LIMIT_MAX_CLIENTS = 10_000
export const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000
export const DEFAULT_REQUEST_BODY_TIMEOUT_MS = 10_000

export type CustomProviderMode = 'allowlist' | 'disabled' | 'public'

export type OutboundPolicyConfig = {
  allowedHosts: readonly string[]
  allowedPorts: readonly number[]
  dnsTimeoutMs: number
  mode: CustomProviderMode
}

export type RateLimitConfig = {
  limit: number
  maxClients: number
  windowMs: number
}

export type RuntimeConfig = {
  allowedOrigin: string | null
  maxBodyBytes: number
  maxProviderResponseBytes: number
  outboundPolicy: OutboundPolicyConfig
  port: number
  providerTimeoutMs: number
  rateLimit: RateLimitConfig
  requestBodyTimeoutMs: number
  staticDir: string
  trustProxy: boolean
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

function readBoolean(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: boolean,
) {
  const rawValue = env[name]?.trim().toLowerCase()

  if (rawValue === undefined || rawValue === '') {
    return fallback
  }

  if (rawValue === 'true') {
    return true
  }

  if (rawValue === 'false') {
    return false
  }

  throw new Error(`${name} must be true or false.`)
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

function readCustomProviderMode(env: NodeJS.ProcessEnv): CustomProviderMode {
  const value = env.RENEX_CUSTOM_PROVIDER_MODE?.trim().toLowerCase() ?? 'public'

  if (value === 'allowlist' || value === 'disabled' || value === 'public') {
    return value
  }

  throw new Error(
    'RENEX_CUSTOM_PROVIDER_MODE must be allowlist, disabled, or public.',
  )
}

function readAllowedHosts(env: NodeJS.ProcessEnv, mode: CustomProviderMode) {
  const values = (env.RENEX_CUSTOM_PROVIDER_HOSTS ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)

  const hosts = values.map((value) => {
    let parsed: URL

    if (value.includes('*')) {
      throw new Error(
        'RENEX_CUSTOM_PROVIDER_HOSTS does not support wildcard hostnames.',
      )
    }

    try {
      parsed = new URL(`https://${value}`)
    } catch {
      throw new Error(
        'RENEX_CUSTOM_PROVIDER_HOSTS must contain comma-separated hostnames.',
      )
    }

    if (
      parsed.hostname !== value ||
      parsed.port ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        'RENEX_CUSTOM_PROVIDER_HOSTS must contain comma-separated hostnames without ports or paths.',
      )
    }

    return parsed.hostname
  })

  if (mode === 'allowlist' && hosts.length === 0) {
    throw new Error(
      'RENEX_CUSTOM_PROVIDER_HOSTS is required when custom provider mode is allowlist.',
    )
  }

  return [...new Set(hosts)]
}

function readAllowedPorts(env: NodeJS.ProcessEnv) {
  const rawValue = env.RENEX_CUSTOM_PROVIDER_PORTS?.trim() || '80,443'
  const ports = rawValue.split(',').map((entry) => {
    const value = Number(entry.trim())

    if (!Number.isInteger(value) || value < 1 || value > 65_535) {
      throw new Error(
        'RENEX_CUSTOM_PROVIDER_PORTS must contain comma-separated ports between 1 and 65535.',
      )
    }

    return value
  })

  return [...new Set(ports)]
}

export function getRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  workingDirectory = process.cwd(),
): RuntimeConfig {
  const mode = readCustomProviderMode(env)

  return {
    allowedOrigin: readAllowedOrigin(env),
    maxBodyBytes: readInteger(
      env,
      'RENEX_MAX_BODY_BYTES',
      DEFAULT_MAX_BODY_BYTES,
      1024,
      1024 * 1024,
    ),
    maxProviderResponseBytes: readInteger(
      env,
      'RENEX_MAX_PROVIDER_RESPONSE_BYTES',
      DEFAULT_MAX_PROVIDER_RESPONSE_BYTES,
      1024,
      10 * 1024 * 1024,
    ),
    outboundPolicy: {
      allowedHosts: readAllowedHosts(env, mode),
      allowedPorts: readAllowedPorts(env),
      dnsTimeoutMs: readInteger(
        env,
        'RENEX_DNS_TIMEOUT_MS',
        DEFAULT_DNS_TIMEOUT_MS,
        100,
        30_000,
      ),
      mode,
    },
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
    rateLimit: {
      limit: readInteger(
        env,
        'RENEX_RATE_LIMIT',
        DEFAULT_RATE_LIMIT,
        1,
        10_000,
      ),
      maxClients: readInteger(
        env,
        'RENEX_RATE_LIMIT_MAX_CLIENTS',
        DEFAULT_RATE_LIMIT_MAX_CLIENTS,
        1,
        1_000_000,
      ),
      windowMs: readInteger(
        env,
        'RENEX_RATE_LIMIT_WINDOW_MS',
        DEFAULT_RATE_LIMIT_WINDOW_MS,
        1000,
        3_600_000,
      ),
    },
    requestBodyTimeoutMs: readInteger(
      env,
      'RENEX_REQUEST_BODY_TIMEOUT_MS',
      DEFAULT_REQUEST_BODY_TIMEOUT_MS,
      1000,
      120_000,
    ),
    staticDir: resolve(workingDirectory, 'dist'),
    trustProxy: readBoolean(env, 'RENEX_TRUST_PROXY', false),
  }
}
