import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_MAX_BODY_BYTES,
  DEFAULT_PORT,
  DEFAULT_PROVIDER_TIMEOUT_MS,
  getRuntimeConfig,
} from '../../dist-server/server/config.js'

test('runtime configuration has production-safe defaults', () => {
  assert.deepEqual(getRuntimeConfig({}, '/tmp/renex-config-test'), {
    allowedOrigin: null,
    maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
    port: DEFAULT_PORT,
    providerTimeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    staticDir: '/tmp/renex-config-test/dist',
  })
})

test('runtime configuration accepts documented overrides', () => {
  const config = getRuntimeConfig({
    RENEX_ALLOWED_ORIGIN: 'https://app.example',
    RENEX_MAX_BODY_BYTES: '32768',
    RENEX_PORT: '8080',
    RENEX_PROVIDER_TIMEOUT_MS: '5000',
  }, '/tmp/renex-config-test')

  assert.equal(config.allowedOrigin, 'https://app.example')
  assert.equal(config.maxBodyBytes, 32_768)
  assert.equal(config.port, 8_080)
  assert.equal(config.providerTimeoutMs, 5_000)
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
