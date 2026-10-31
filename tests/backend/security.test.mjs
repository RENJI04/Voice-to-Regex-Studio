import assert from 'node:assert/strict'
import { once } from 'node:events'
import { request as requestHttp } from 'node:http'
import { test } from 'node:test'
import { createRenexServer } from '../../dist-server/server/httpServer.js'
import { getClientIp } from '../../dist-server/server/security/clientIp.js'
import {
  authorizeCustomDestination,
  isPublicAddress,
} from '../../dist-server/server/security/outboundPolicy.js'
import {
  createPinnedLookup,
  readLimitedFetchResponse,
  requestCustomProvider,
} from '../../dist-server/server/security/providerTransport.js'
import { FixedWindowRateLimiter } from '../../dist-server/server/security/rateLimiter.js'

const publicIpv4 = { address: '93.184.216.34', family: 4 }
const generatedResult = JSON.stringify({
  explanation: 'Matches digits.',
  flags: 'g',
  needsClarification: false,
  pattern: '\\d+',
  suggestions: [],
  warnings: [],
})

function baseConfig(overrides = {}) {
  return {
    allowedOrigin: null,
    maxBodyBytes: 65_536,
    maxProviderResponseBytes: 1_048_576,
    outboundPolicy: {
      allowedHosts: [],
      allowedPorts: [80, 443],
      dnsTimeoutMs: 100,
      mode: 'public',
    },
    port: 0,
    providerTimeoutMs: 500,
    rateLimit: { limit: 1_000, maxClients: 1_000, windowMs: 60_000 },
    requestBodyTimeoutMs: 10_000,
    staticDir: '/tmp/renex-security-test-static-missing',
    trustProxy: false,
    ...overrides,
  }
}

function providerConfig(provider = 'openai') {
  return {
    apiKey: 'security-test-key',
    customApiKeyHeader: 'Authorization',
    customApiKeyPrefix: 'Bearer',
    customRequestTemplate:
      '{"model":"{{model}}","messages":[{"role":"system","content":"{{systemPrompt}}"},{"role":"user","content":"{{prompt}}"}]}',
    customResponsePath: 'result.text',
    customUrl: provider === 'custom' ? 'https://provider.example/generate' : '',
    model: 'security-test-model',
    provider,
  }
}

function generateBody(aiConfig = providerConfig()) {
  return {
    aiConfig,
    description: 'Match digits',
    sampleText: '123',
    targetFlavor: 'javascript',
  }
}

function openAiResponse(content = generatedResult) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { status: 200 },
  )
}

async function startServer({
  config = baseConfig(),
  customRequestImplementation,
  dnsResolver,
  fetchImplementation = async () => openAiResponse(),
  logger = () => {},
} = {}) {
  const server = createRenexServer({
    config,
    customRequestImplementation,
    dnsResolver,
    fetchImplementation,
    logger,
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  assert.ok(address && typeof address === 'object')

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}

async function withServer(options, callback) {
  const server = await startServer(options)

  try {
    await callback(server)
  } finally {
    await server.close()
  }
}

async function post(server, path, body, headers = {}) {
  return fetch(`${server.baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
    method: 'POST',
  })
}

function publicPolicy(overrides = {}) {
  return {
    allowedHosts: [],
    allowedPorts: [80, 443],
    dnsTimeoutMs: 100,
    mode: 'public',
    ...overrides,
  }
}

async function assertDestinationBlocked(url, resolver) {
  await assert.rejects(
    authorizeCustomDestination(url, publicPolicy(), resolver),
    (error) => error?.code === 'OUTBOUND_DESTINATION_BLOCKED',
  )
}

test('network policy blocks loopback IPv4', async () => {
  await assertDestinationBlocked('http://127.0.0.1/')
})

test('network policy blocks loopback IPv6', async () => {
  await assertDestinationBlocked('http://[::1]/')
})

test('network policy blocks private IPv4 ranges', async () => {
  for (const address of [
    '10.0.0.1',
    '100.64.0.1',
    '100.127.255.254',
    '172.16.0.1',
    '192.168.0.1',
  ]) {
    assert.equal(isPublicAddress(address), false, address)
  }
})

test('network policy blocks private IPv6 ranges', () => {
  assert.equal(isPublicAddress('fc00::1'), false)
  assert.equal(isPublicAddress('fd12:3456::1'), false)
})

test('network policy blocks link-local addresses', () => {
  assert.equal(isPublicAddress('169.254.1.1'), false)
  assert.equal(isPublicAddress('fe80::1'), false)
})

test('network policy blocks cloud metadata and unspecified addresses', async () => {
  await assertDestinationBlocked('http://169.254.169.254/latest/meta-data')
  assert.equal(isPublicAddress('0.0.0.0'), false)
  assert.equal(isPublicAddress('::'), false)
})

test('network policy blocks multicast, reserved, and documentation ranges', () => {
  for (const address of [
    '224.0.0.1',
    '240.0.0.1',
    '192.0.2.1',
    '198.51.100.1',
    '203.0.113.1',
    '2001::1',
    '2001:db8::1',
    '2002:5db8:d822::1',
    'ff02::1',
  ]) {
    assert.equal(isPublicAddress(address), false, address)
  }
})

test('network policy evaluates IPv4-mapped IPv6 addresses', () => {
  assert.equal(isPublicAddress('::ffff:127.0.0.1'), false)
  assert.equal(isPublicAddress('::ffff:10.0.0.1'), false)
  assert.equal(isPublicAddress('::ffff:93.184.216.34'), true)
})

test('alternative numeric IPv4 notation is normalized and blocked', async () => {
  await assertDestinationBlocked('http://2130706433/')
  await assertDestinationBlocked('http://0x7f000001/')
})

test('hostname resolving to a private address is blocked', async () => {
  await assertDestinationBlocked(
    'https://provider.example/',
    async () => [{ address: '10.0.0.5', family: 4 }],
  )
})

test('hostname with any private answer is blocked', async () => {
  await assertDestinationBlocked(
    'https://provider.example/',
    async () => [publicIpv4, { address: '192.168.1.5', family: 4 }],
  )
})

test('valid public A and AAAA answers are accepted', async () => {
  const destination = await authorizeCustomDestination(
    'https://provider.example/generate',
    publicPolicy(),
    async () => [
      publicIpv4,
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ],
  )

  assert.equal(destination.hostname, 'provider.example')
  assert.equal(destination.addresses.length, 2)
})

test('DNS resolution is bounded and fails closed', async () => {
  await assert.rejects(
    authorizeCustomDestination(
      'https://provider.example/',
      publicPolicy({ dnsTimeoutMs: 20 }),
      async () => new Promise(() => {}),
    ),
    (error) => error?.code === 'PROVIDER_TIMEOUT',
  )
})

test('custom provider mode and hostname allowlist are enforced', async () => {
  await assert.rejects(
    authorizeCustomDestination(
      'https://provider.example/',
      publicPolicy({ mode: 'disabled' }),
      async () => [publicIpv4],
    ),
    (error) => error?.code === 'OUTBOUND_DESTINATION_BLOCKED',
  )
  await assert.rejects(
    authorizeCustomDestination(
      'https://provider.example/',
      publicPolicy({ allowedHosts: ['trusted.example'], mode: 'allowlist' }),
      async () => [publicIpv4],
    ),
    (error) => error?.code === 'OUTBOUND_DESTINATION_BLOCKED',
  )
  const destination = await authorizeCustomDestination(
    'https://trusted.example/',
    publicPolicy({ allowedHosts: ['trusted.example'], mode: 'allowlist' }),
    async () => [publicIpv4],
  )
  assert.equal(destination.hostname, 'trusted.example')
})

test('custom provider port policy is enforced', async () => {
  await assert.rejects(
    authorizeCustomDestination(
      'https://provider.example:8443/',
      publicPolicy(),
      async () => [publicIpv4],
    ),
    (error) => error?.code === 'OUTBOUND_DESTINATION_BLOCKED',
  )
})

test('embedded URL credentials are rejected', async () => {
  await assert.rejects(
    authorizeCustomDestination(
      'https://user:pass@provider.example/',
      publicPolicy(),
      async () => [publicIpv4],
    ),
    (error) => error?.code === 'OUTBOUND_DESTINATION_BLOCKED',
  )
})

test('blocked custom destinations fail at the public API boundary', async () => {
  let transportCalled = false
  await withServer(
    {
      customRequestImplementation: async () => {
        transportCalled = true
        return { body: '', status: 200 }
      },
    },
    async (server) => {
      const response = await post(
        server,
        '/api/generate-regex',
        generateBody({
          ...providerConfig('custom'),
          customUrl: 'http://127.0.0.1/',
        }),
      )
      assert.equal(response.status, 403)
      assert.equal(
        (await response.json()).error.code,
        'OUTBOUND_DESTINATION_BLOCKED',
      )
      assert.equal(transportCalled, false)
    },
  )
})

test('pinned lookup returns only previously approved addresses', async () => {
  const approved = [
    publicIpv4,
    { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
  ]
  const lookup = createPinnedLookup(approved)
  const addresses = await new Promise((resolve, reject) => {
    lookup('changed.example', { all: true }, (error, results) => {
      if (error) {
        reject(error)
      } else {
        resolve(results)
      }
    })
  })

  assert.deepEqual(addresses, approved)
})

test('custom provider redirects are rejected without a second request', async () => {
  let calls = 0
  await withServer(
    {
      customRequestImplementation: async () => {
        calls += 1
        return { body: '', status: 302 }
      },
      dnsResolver: async () => [publicIpv4],
    },
    async (server) => {
      const response = await post(
        server,
        '/api/generate-regex',
        generateBody(providerConfig('custom')),
      )
      assert.equal(response.status, 502)
      assert.equal((await response.json()).error.code, 'PROVIDER_REQUEST_FAILED')
      assert.equal(calls, 1)
    },
  )
})

test('provider response reader accepts data under and at the limit', async () => {
  const underController = new AbortController()
  assert.equal(
    await readLimitedFetchResponse(
      new Response('abc'),
      4,
      underController,
    ),
    'abc',
  )
  const boundaryController = new AbortController()
  assert.equal(
    await readLimitedFetchResponse(
      new Response('abcd'),
      4,
      boundaryController,
    ),
    'abcd',
  )
})

test('oversized provider responses are rejected and aborted', async () => {
  const controller = new AbortController()
  await assert.rejects(
    readLimitedFetchResponse(new Response('abcde'), 4, controller),
    (error) => error?.code === 'PROVIDER_RESPONSE_TOO_LARGE',
  )
  assert.equal(controller.signal.aborted, true)
})

test('streamed bytes override a falsely small Content-Length', async () => {
  const controller = new AbortController()
  const response = new Response(
    new ReadableStream({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode('abcdef'))
        streamController.close()
      },
    }),
    { headers: { 'content-length': '3' } },
  )

  await assert.rejects(
    readLimitedFetchResponse(response, 5, controller),
    (error) => error?.code === 'PROVIDER_RESPONSE_TOO_LARGE',
  )
  assert.equal(controller.signal.aborted, true)
})

test('slow oversized provider streams terminate safely', async () => {
  const controller = new AbortController()
  const response = new Response(
    new ReadableStream({
      async start(streamController) {
        streamController.enqueue(new TextEncoder().encode('abc'))
        await new Promise((resolve) => setTimeout(resolve, 10))
        streamController.enqueue(new TextEncoder().encode('def'))
      },
    }),
  )

  await assert.rejects(
    readLimitedFetchResponse(response, 5, controller),
    (error) => error?.code === 'PROVIDER_RESPONSE_TOO_LARGE',
  )
  assert.equal(controller.signal.aborted, true)
})

test('provider size errors are normalized through the public API', async () => {
  await withServer(
    {
      config: baseConfig({ maxProviderResponseBytes: 16 }),
      fetchImplementation: async () => new Response('x'.repeat(17)),
    },
    async (server) => {
      const response = await post(
        server,
        '/api/generate-regex',
        generateBody(),
      )
      assert.equal(response.status, 502)
      assert.deepEqual(await response.json(), {
        error: {
          code: 'PROVIDER_RESPONSE_TOO_LARGE',
          message: 'Provider response exceeded the configured size limit.',
        },
      })
    },
  )
})

test('native custom transport enforces its response size ceiling', async () => {
  const upstream = (await import('node:http')).createServer((_request, response) => {
    response.write('x'.repeat(8))
    setTimeout(() => response.end('x'.repeat(24)), 10)
  })
  upstream.listen(0, '127.0.0.1')
  await once(upstream, 'listening')
  const address = upstream.address()
  assert.ok(address && typeof address === 'object')

  try {
    await assert.rejects(
      requestCustomProvider(
        {
          addresses: [{ address: '127.0.0.1', family: 4 }],
          hostname: 'provider.example',
          url: new URL(`http://provider.example:${address.port}/`),
        },
        { method: 'POST' },
        { maxResponseBytes: 16, signal: new AbortController().signal },
      ),
      (error) => error?.code === 'PROVIDER_RESPONSE_TOO_LARGE',
    )
  } finally {
    upstream.close()
    await once(upstream, 'close')
  }
})

test('fixed-window limiter allows requests below the threshold and resets', () => {
  const limiter = new FixedWindowRateLimiter({
    limit: 2,
    maxClients: 10,
    windowMs: 1000,
  })

  assert.equal(limiter.consume('client', 0).allowed, true)
  assert.equal(limiter.consume('client', 100).allowed, true)
  assert.equal(limiter.consume('client', 200).allowed, false)
  assert.equal(limiter.consume('client', 1000).allowed, true)
})

test('fixed-window limiter keeps client memory bounded', () => {
  const limiter = new FixedWindowRateLimiter({
    limit: 2,
    maxClients: 1,
    windowMs: 1000,
  })

  assert.equal(limiter.consume('first', 0).allowed, true)
  assert.equal(limiter.consume('second', 0).allowed, false)
  assert.equal(limiter.consume('second', 1000).allowed, true)
})

test('a new limiter instance starts with empty in-memory state', () => {
  const config = { limit: 1, maxClients: 10, windowMs: 1000 }
  const firstProcess = new FixedWindowRateLimiter(config)
  assert.equal(firstProcess.consume('client', 0).allowed, true)
  assert.equal(firstProcess.consume('client', 1).allowed, false)

  const restartedProcess = new FixedWindowRateLimiter(config)
  assert.equal(restartedProcess.consume('client', 1).allowed, true)
})

test('API rate limit returns 429 and does not affect health', async () => {
  await withServer(
    { config: baseConfig({
      rateLimit: { limit: 1, maxClients: 100, windowMs: 60_000 },
    }) },
    async (server) => {
      const first = await post(
        server,
        '/api/generate-regex',
        generateBody(),
      )
      assert.equal(first.status, 200)
      const limited = await post(
        server,
        '/api/generate-regex',
        generateBody(),
      )
      assert.equal(limited.status, 429)
      assert.equal(limited.headers.get('retry-after'), '60')
      assert.equal((await limited.json()).error.code, 'RATE_LIMITED')
      const health = await fetch(`${server.baseUrl}/health`)
      assert.equal(health.status, 200)
    },
  )
})

test('OPTIONS requests do not consume API rate-limit capacity', async () => {
  await withServer(
    { config: baseConfig({
      rateLimit: { limit: 1, maxClients: 100, windowMs: 60_000 },
    }) },
    async (server) => {
      for (let index = 0; index < 2; index += 1) {
        const preflight = await fetch(
          `${server.baseUrl}/api/generate-regex`,
          { method: 'OPTIONS' },
        )
        assert.equal(preflight.status, 204)
      }

      const firstLimitedRequest = await fetch(
        `${server.baseUrl}/api/generate-regex`,
      )
      assert.equal(firstLimitedRequest.status, 405)
      const limited = await fetch(`${server.baseUrl}/api/generate-regex`)
      assert.equal(limited.status, 429)
    },
  )
})

test('spoofed forwarding headers are ignored by default', () => {
  const request = {
    headers: { 'x-forwarded-for': '203.0.113.10' },
    socket: { remoteAddress: '192.0.2.20' },
  }
  assert.equal(getClientIp(request, false), '192.0.2.20')
})

test('trusted proxy mode uses the rightmost valid forwarded address', () => {
  const request = {
    headers: { 'x-forwarded-for': '198.51.100.10, 203.0.113.20' },
    socket: { remoteAddress: '192.0.2.20' },
  }
  assert.equal(getClientIp(request, true), '203.0.113.20')
})

test('rate limiting ignores spoofed forwarding headers by default', async () => {
  await withServer(
    { config: baseConfig({
      rateLimit: { limit: 1, maxClients: 100, windowMs: 60_000 },
    }) },
    async (server) => {
      const first = await fetch(`${server.baseUrl}/api/generate-regex`, {
        headers: { 'x-forwarded-for': '198.51.100.10' },
      })
      assert.equal(first.status, 405)
      const second = await fetch(`${server.baseUrl}/api/generate-regex`, {
        headers: { 'x-forwarded-for': '203.0.113.20' },
      })
      assert.equal(second.status, 429)
    },
  )
})

test('trusted proxy mode keys rate limits by the forwarded client', async () => {
  await withServer(
    { config: baseConfig({
      rateLimit: { limit: 1, maxClients: 100, windowMs: 60_000 },
      trustProxy: true,
    }) },
    async (server) => {
      const first = await fetch(`${server.baseUrl}/api/generate-regex`, {
        headers: { 'x-forwarded-for': '198.51.100.10' },
      })
      assert.equal(first.status, 405)
      const second = await fetch(`${server.baseUrl}/api/generate-regex`, {
        headers: { 'x-forwarded-for': '203.0.113.20' },
      })
      assert.equal(second.status, 405)
    },
  )
})

test('trusted proxy mode ignores spoofed left-side XFF values', async () => {
  await withServer(
    { config: baseConfig({
      rateLimit: { limit: 1, maxClients: 100, windowMs: 60_000 },
      trustProxy: true,
    }) },
    async (server) => {
      const first = await fetch(`${server.baseUrl}/api/generate-regex`, {
        headers: {
          'x-forwarded-for': '198.51.100.10, 203.0.113.20',
        },
      })
      assert.equal(first.status, 405)

      const spoofed = await fetch(`${server.baseUrl}/api/generate-regex`, {
        headers: {
          'x-forwarded-for': '192.0.2.99, 203.0.113.20',
        },
      })
      assert.equal(spoofed.status, 429)
    },
  )
})

test('CORS uses the configured exact origin without a wildcard', async () => {
  await withServer(
    { config: baseConfig({ allowedOrigin: 'https://app.example' }) },
    async (server) => {
      const allowed = await fetch(`${server.baseUrl}/health`, {
        headers: { origin: 'https://app.example' },
      })
      assert.equal(allowed.status, 200)
      assert.equal(
        allowed.headers.get('access-control-allow-origin'),
        'https://app.example',
      )
      assert.notEqual(allowed.headers.get('access-control-allow-origin'), '*')

      const rejected = await fetch(`${server.baseUrl}/health`, {
        headers: { origin: 'https://evil.example' },
      })
      assert.equal(rejected.status, 403)
    },
  )
})

test('provider keys stay out of logs and client errors', async () => {
  const events = []
  await withServer(
    {
      fetchImplementation: async () => {
        throw new Error('failed with security-test-key and Bearer token')
      },
      logger: (event) => events.push(event),
    },
    async (server) => {
      const response = await post(
        server,
        '/api/generate-regex',
        generateBody(),
      )
      const responseText = await response.text()
      const logText = JSON.stringify(events)
      assert.equal(response.status, 502)
      assert.doesNotMatch(responseText, /security-test-key|Bearer token/)
      assert.doesNotMatch(logText, /security-test-key|Bearer token|authorization/i)
    },
  )
})

test('unknown API paths are normalized before logging', async () => {
  const events = []
  await withServer(
    { logger: (event) => events.push(event) },
    async (server) => {
      const response = await fetch(
        `${server.baseUrl}/api/security-test-key`,
      )
      assert.equal(response.status, 404)
      assert.equal(events.length, 1)
      assert.equal(events[0].path, '/api/*')
      assert.doesNotMatch(JSON.stringify(events), /security-test-key/)
    },
  )
})

test('non-allowlisted HTTP methods are normalized before logging', async () => {
  const events = []
  await withServer(
    { logger: (event) => events.push(event) },
    async (server) => {
      const status = await new Promise((resolve, reject) => {
        const request = requestHttp(
          `${server.baseUrl}/api/generate-regex`,
          { method: 'PUT' },
          (response) => {
            response.resume()
            response.on('end', () => resolve(response.statusCode))
          },
        )
        request.on('error', reject)
        request.end()
      })

      assert.equal(status, 405)
      assert.equal(events.length, 1)
      assert.equal(events[0].method, 'OTHER')
    },
  )
})

test('production responses include the documented security headers', async () => {
  await withServer({}, async (server) => {
    const response = await fetch(`${server.baseUrl}/health`)
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.equal(response.headers.get('x-frame-options'), 'DENY')
    assert.equal(response.headers.get('cross-origin-opener-policy'), 'same-origin')
    assert.match(response.headers.get('permissions-policy'), /camera=\(\)/)
  })
})

test('protected and malformed custom auth headers are rejected', async () => {
  await withServer({}, async (server) => {
    for (const header of [
      'Host',
      'Content-Length',
      'Content-Type',
      'Connection',
      'Keep-Alive',
      'Transfer-Encoding',
      'Proxy-Authenticate',
      'Proxy-Authorization',
      'TE',
      'Trailer',
      'Upgrade',
    ]) {
      const response = await post(
        server,
        '/api/generate-regex',
        generateBody({
          ...providerConfig('custom'),
          customApiKeyHeader: header,
        }),
      )
      assert.equal(response.status, 400, header)
      assert.match((await response.json()).error.message, /reserved/)
    }

    const malformedResponse = await post(
      server,
      '/api/generate-regex',
      generateBody({
        ...providerConfig('custom'),
        customApiKeyHeader: 'Invalid Header',
      }),
    )
    assert.equal(malformedResponse.status, 400)
    assert.match(
      (await malformedResponse.json()).error.message,
      /valid HTTP header name/,
    )
  })
})

test('custom header values reject control characters', async () => {
  await withServer({}, async (server) => {
    const prefixResponse = await post(
      server,
      '/api/generate-regex',
      generateBody({
        ...providerConfig('custom'),
        customApiKeyPrefix: 'Bearer\r\nInjected',
      }),
    )
    assert.equal(prefixResponse.status, 400)

    const keyResponse = await post(
      server,
      '/api/generate-regex',
      generateBody({
        ...providerConfig('custom'),
        apiKey: 'key\nInjected',
      }),
    )
    assert.equal(keyResponse.status, 400)
  })
})

test('oversized prompt input is rejected before provider access', async () => {
  let providerCalled = false
  await withServer(
    { fetchImplementation: async () => {
      providerCalled = true
      return openAiResponse()
    } },
    async (server) => {
      const response = await post(server, '/api/generate-regex', {
        ...generateBody(),
        description: 'x'.repeat(4_001),
      })
      assert.equal(response.status, 400)
      assert.equal(providerCalled, false)
    },
  )
})

test('inbound request bodies have a full-consumption deadline', async () => {
  await withServer(
    { config: baseConfig({ requestBodyTimeoutMs: 50 }) },
    async (server) => {
      const result = await new Promise((resolve, reject) => {
        const request = requestHttp(
          `${server.baseUrl}/api/generate-regex`,
          {
            headers: {
              'content-length': '100',
              'content-type': 'application/json',
            },
            method: 'POST',
          },
          (response) => {
            const chunks = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('end', () => {
              request.destroy()
              resolve({
                body: Buffer.concat(chunks).toString('utf8'),
                status: response.statusCode,
              })
            })
          },
        )
        request.on('error', reject)
        request.write('{')
      })

      assert.equal(result.status, 408)
      assert.equal(JSON.parse(result.body).error.code, 'REQUEST_TIMEOUT')
    },
  )
})
