import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_DNS_TIMEOUT_MS,
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_MAX_PROVIDER_RESPONSE_BYTES,
  DEFAULT_PORT,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  DEFAULT_RATE_LIMIT,
  DEFAULT_RATE_LIMIT_MAX_CLIENTS,
  DEFAULT_RATE_LIMIT_WINDOW_MS,
  DEFAULT_REQUEST_BODY_TIMEOUT_MS,
  getRuntimeConfig,
} from '../../dist-server/server/config.js'

test('runtime configuration has production-safe defaults', () => {
  assert.deepEqual(getRuntimeConfig({}, '/tmp/renex-config-test'), {
    allowedOrigin: null,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    maxProviderResponseBytes: DEFAULT_MAX_PROVIDER_RESPONSE_BYTES,
    outboundPolicy: {
      allowedHosts: [],
      allowedPorts: [80, 443],
      dnsTimeoutMs: DEFAULT_DNS_TIMEOUT_MS,
      mode: 'public',
    },
    port: DEFAULT_PORT,
    providerTimeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    rateLimit: {
      limit: DEFAULT_RATE_LIMIT,
      maxClients: DEFAULT_RATE_LIMIT_MAX_CLIENTS,
      windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
    },
    requestBodyTimeoutMs: DEFAULT_REQUEST_BODY_TIMEOUT_MS,
    staticDir: '/tmp/renex-config-test/dist',
    trustProxy: false,
  })
})

test('runtime configuration accepts documented overrides', () => {
  const config = getRuntimeConfig({
    RENEX_ALLOWED_ORIGIN: 'https://app.example',
    RENEX_CUSTOM_PROVIDER_HOSTS: 'api.example.com',
    RENEX_CUSTOM_PROVIDER_MODE: 'allowlist',
    RENEX_CUSTOM_PROVIDER_PORTS: '443,8443',
    RENEX_DNS_TIMEOUT_MS: '2000',
    RENEX_MAX_BODY_BYTES: '32768',
    RENEX_MAX_PROVIDER_RESPONSE_BYTES: '131072',
    RENEX_PORT: '8080',
    RENEX_PROVIDER_TIMEOUT_MS: '5000',
    RENEX_RATE_LIMIT: '10',
    RENEX_RATE_LIMIT_MAX_CLIENTS: '500',
    RENEX_RATE_LIMIT_WINDOW_MS: '30000',
    RENEX_REQUEST_BODY_TIMEOUT_MS: '4000',
    RENEX_TRUST_PROXY: 'true',
  }, '/tmp/renex-config-test')

  assert.equal(config.allowedOrigin, 'https://app.example')
  assert.equal(config.maxBodyBytes, 32_768)
  assert.equal(config.maxProviderResponseBytes, 131_072)
  assert.deepEqual(config.outboundPolicy, {
    allowedHosts: ['api.example.com'],
    allowedPorts: [443, 8443],
    dnsTimeoutMs: 2_000,
    mode: 'allowlist',
  })
  assert.equal(config.port, 8_080)
  assert.equal(config.providerTimeoutMs, 5_000)
  assert.deepEqual(config.rateLimit, {
    limit: 10,
    maxClients: 500,
    windowMs: 30_000,
  })
  assert.equal(config.requestBodyTimeoutMs, 4_000)
  assert.equal(config.trustProxy, true)
})

test('PORT is supported when RENEX_PORT is absent', () => {
  assert.equal(getRuntimeConfig({ PORT: '4000' }).port, 4_000)
})

test('invalid runtime integer values fail fast', () => {
  assert.throws(
    () => getRuntimeConfig({ RENEX_PROVIDER_TIMEOUT_MS: 'unbounded' }),
    /RENEX_PROVIDER_TIMEOUT_MS must be an integer/,
  )
})

test('allowed origin must be an exact HTTP(S) origin', () => {
  assert.throws(
    () => getRuntimeConfig({ RENEX_ALLOWED_ORIGIN: 'https://app.example/path' }),
    /absolute HTTP\(S\) origin/,
  )
})

test('allowlist mode requires at least one hostname', () => {
  assert.throws(
    () => getRuntimeConfig({ RENEX_CUSTOM_PROVIDER_MODE: 'allowlist' }),
    /RENEX_CUSTOM_PROVIDER_HOSTS is required/,
  )
})

test('custom provider ports reject malformed values', () => {
  assert.throws(
    () => getRuntimeConfig({ RENEX_CUSTOM_PROVIDER_PORTS: '443,70000' }),
    /ports between 1 and 65535/,
  )
})

test('custom provider hostname allowlists reject wildcards', () => {
  assert.throws(
    () => getRuntimeConfig({
      RENEX_CUSTOM_PROVIDER_HOSTS: '*.example.com',
      RENEX_CUSTOM_PROVIDER_MODE: 'allowlist',
    }),
    /does not support wildcard/,
  )
})

test('malformed security settings fail closed', () => {
  const invalidSettings = [
    ['RENEX_DNS_TIMEOUT_MS', '0'],
    ['RENEX_MAX_PROVIDER_RESPONSE_BYTES', '0'],
    ['RENEX_PROVIDER_TIMEOUT_MS', 'unbounded'],
    ['RENEX_RATE_LIMIT', '0'],
    ['RENEX_RATE_LIMIT_MAX_CLIENTS', '0'],
    ['RENEX_RATE_LIMIT_WINDOW_MS', '0'],
    ['RENEX_REQUEST_BODY_TIMEOUT_MS', '0'],
    ['RENEX_TRUST_PROXY', 'yes'],
    ['RENEX_CUSTOM_PROVIDER_MODE', 'permissive'],
  ]

  for (const [name, value] of invalidSettings) {
    assert.throws(
      () => getRuntimeConfig({ [name]: value }),
      undefined,
      `${name} should fail closed`,
    )
  }
})
