import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createRenexServer } from '../../dist-server/server/httpServer.js'

const generatedResult = JSON.stringify({
  explanation: 'Matches one or more digits.',
  flags: 'g',
  needsClarification: false,
  pattern: '\\d+',
  suggestions: [],
  warnings: [],
})

const explainedResult = JSON.stringify({
  annotations: [
    { meaning: 'Matches a digit.', position: 0, token: '\\d' },
    { meaning: 'Matches one or more times.', position: 2, token: '+' },
  ],
  summary: 'Matches one or more digits.',
  warnings: [],
})

function providerConfig(provider = 'openai') {
  return {
    apiKey: 'test-provider-key',
    customApiKeyHeader: 'Authorization',
    customApiKeyPrefix: 'Bearer',
    customRequestTemplate:
      '{"model":"{{model}}","messages":[{"role":"system","content":"{{systemPrompt}}"},{"role":"user","content":"{{prompt}}"}]}',
    customResponsePath: 'result.text',
    customUrl: provider === 'custom' ? 'https://custom.example/v1/generate' : '',
    model: 'test-model',
    provider,
  }
}

function generateBody(overrides = {}) {
  return {
    aiConfig: providerConfig(),
    description: 'Match one or more digits',
    sampleText: 'Invoice 123',
    targetFlavor: 'javascript',
    ...overrides,
  }
}

function openAiResponse(content = generatedResult) {
  return new Response(
    JSON.stringify({ choices: [{ message: { content } }] }),
    { headers: { 'content-type': 'application/json' }, status: 200 },
  )
}

async function startServer({
  allowedOrigin = null,
  fetchImplementation = async () => openAiResponse(),
  maxBodyBytes = 65_536,
  providerTimeoutMs = 100,
} = {}) {
  const server = createRenexServer({
    config: {
      allowedOrigin,
      maxBodyBytes,
      port: 0,
      providerTimeoutMs,
      staticDir: '/tmp/renex-backend-test-missing-static',
    },
    fetchImplementation,
    logger: () => {},
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

async function request(server, path, { body, headers, method = 'POST' } = {}) {
  return fetch(`${server.baseUrl}${path}`, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    method,
  })
}

async function withServer(options, callback) {
  const server = await startServer(options)

  try {
    await callback(server)
  } finally {
    await server.close()
  }
}

test('health endpoint returns readiness without calling a provider', async () => {
  let providerCalled = false
  await withServer(
    { fetchImplementation: async () => {
      providerCalled = true
      return openAiResponse()
    } },
    async (server) => {
      const response = await request(server, '/health', { method: 'GET' })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { status: 'ok' })
      assert.equal(providerCalled, false)
    },
  )
})

test('health endpoint supports HEAD without a response body', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/health', { method: 'HEAD' })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '')
  })
})

test('health endpoint rejects unsupported methods', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/health')
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('allow'), 'GET, HEAD')
    assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED')
  })
})

test('API endpoint rejects unsupported methods', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/generate-regex', { method: 'GET' })
    assert.equal(response.status, 405)
    assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED')
  })
})

test('unknown API route returns a structured 404', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/unknown', { method: 'GET' })
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), {
      error: { code: 'NOT_FOUND', message: 'API route was not found.' },
    })
  })
})

test('invalid JSON returns a structured validation error', async () => {
  await withServer({}, async (server) => {
    const response = await fetch(`${server.baseUrl}/api/generate-regex`, {
      body: '{broken',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'INVALID_JSON')
  })
})

test('non-JSON request bodies are rejected', async () => {
  await withServer({}, async (server) => {
    const response = await fetch(`${server.baseUrl}/api/generate-regex`, {
      body: 'plain text',
      headers: { 'content-type': 'text/plain' },
      method: 'POST',
    })
    assert.equal(response.status, 415)
    assert.equal((await response.json()).error.code, 'UNSUPPORTED_MEDIA_TYPE')
  })
})

test('oversized request bodies are rejected before provider access', async () => {
  let providerCalled = false
  await withServer(
    {
      fetchImplementation: async () => {
        providerCalled = true
        return openAiResponse()
      },
      maxBodyBytes: 1_024,
    },
    async (server) => {
      const response = await request(server, '/api/generate-regex', {
        body: generateBody({ sampleText: 'x'.repeat(2_000) }),
      })
      assert.equal(response.status, 413)
      assert.equal((await response.json()).error.code, 'PAYLOAD_TOO_LARGE')
      assert.equal(providerCalled, false)
    },
  )
})

test('missing generation description is rejected', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/generate-regex', {
      body: generateBody({ description: '' }),
    })
    assert.equal(response.status, 400)
    assert.match((await response.json()).error.message, /Description is required/)
  })
})

test('missing explanation pattern is rejected', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/explain-regex', {
      body: {
        aiConfig: providerConfig(),
        flags: 'g',
        pattern: '',
        sampleText: '',
        targetFlavor: 'javascript',
      },
    })
    assert.equal(response.status, 400)
    assert.match((await response.json()).error.message, /Pattern is required/)
  })
})

test('invalid flags are rejected before provider access', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/explain-regex', {
      body: {
        aiConfig: providerConfig(),
        flags: 'z',
        pattern: '\\d+',
        sampleText: '',
        targetFlavor: 'javascript',
      },
    })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'INVALID_FLAGS')
  })
})

test('invalid regex patterns are rejected before provider access', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/explain-regex', {
      body: {
        aiConfig: providerConfig(),
        flags: '',
        pattern: '(',
        sampleText: '',
        targetFlavor: 'javascript',
      },
    })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'INVALID_PATTERN')
  })
})

test('missing provider API key is rejected', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/generate-regex', {
      body: generateBody({
        aiConfig: { ...providerConfig(), apiKey: '' },
      }),
    })
    assert.equal(response.status, 400)
    assert.match((await response.json()).error.message, /API key is required/)
  })
})

test('invalid provider identifiers are rejected', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/generate-regex', {
      body: generateBody({
        aiConfig: { ...providerConfig(), provider: 'unknown' },
      }),
    })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'INVALID_PROVIDER')
  })
})

test('unsupported target flavors are rejected', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/generate-regex', {
      body: generateBody({ targetFlavor: 'ruby' }),
    })
    assert.equal(response.status, 400)
    assert.equal((await response.json()).error.code, 'UNSUPPORTED_TARGET_FLAVOR')
  })
})

test('provider timeouts abort while waiting for response headers', async () => {
  let observedAbort = false
  const fetchImplementation = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      observedAbort = true
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })

  await withServer(
    { fetchImplementation, providerTimeoutMs: 100 },
    async (server) => {
      const response = await request(server, '/api/generate-regex', {
        body: generateBody(),
      })
      assert.equal(response.status, 504)
      assert.equal((await response.json()).error.code, 'PROVIDER_TIMEOUT')
      assert.equal(observedAbort, true)
    },
  )
})

test('provider timeouts also abort a stalled response body', async () => {
  let observedAbort = false
  const fetchImplementation = async (_url, init) => new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"partial":'))
        init.signal.addEventListener('abort', () => {
          observedAbort = true
          controller.error(new DOMException('Aborted', 'AbortError'))
        })
      },
    }),
    { status: 200 },
  )

  await withServer(
    { fetchImplementation, providerTimeoutMs: 100 },
    async (server) => {
      const response = await request(server, '/api/generate-regex', {
        body: generateBody(),
      })
      assert.equal(response.status, 504)
      assert.equal((await response.json()).error.code, 'PROVIDER_TIMEOUT')
      assert.equal(observedAbort, true)
    },
  )
})

test('provider failures are normalized without upstream response bodies', async () => {
  await withServer(
    {
      fetchImplementation: async () => new Response(
        'upstream-secret-body',
        { status: 429 },
      ),
    },
    async (server) => {
      const response = await request(server, '/api/generate-regex', {
        body: generateBody(),
      })
      assert.equal(response.status, 502)
      const responseText = await response.text()
      assert.match(responseText, /PROVIDER_REQUEST_FAILED/)
      assert.doesNotMatch(responseText, /upstream-secret-body/)
    },
  )
})

test('thrown provider errors cannot leak API keys to clients', async () => {
  await withServer(
    {
      fetchImplementation: async () => {
        throw new Error('failed with test-provider-key')
      },
    },
    async (server) => {
      const response = await request(server, '/api/generate-regex', {
        body: generateBody(),
      })
      assert.equal(response.status, 502)
      assert.doesNotMatch(await response.text(), /test-provider-key/)
    },
  )
})

test('OpenAI generation succeeds and keeps the public response shape', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/generate-regex', {
      body: generateBody(),
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {
      explanation: 'Matches one or more digits.',
      flags: 'g',
      model: 'test-model',
      needsClarification: false,
      pattern: '\\d+',
      provider: 'openai',
      suggestions: [],
      targetFlavor: 'javascript',
      warnings: [],
    })
  })
})

test('Anthropic provider integration parses content blocks', async () => {
  const fetchImplementation = async (url, init) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages')
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers['x-api-key'], 'test-provider-key')
    return new Response(JSON.stringify({
      content: [{ text: generatedResult, type: 'text' }],
    }), { status: 200 })
  }

  await withServer({ fetchImplementation }, async (server) => {
    const response = await request(server, '/api/generate-regex', {
      body: generateBody({ aiConfig: providerConfig('anthropic') }),
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).provider, 'anthropic')
  })
})

test('custom provider integration applies its template, path, and auth header', async () => {
  const fetchImplementation = async (url, init) => {
    assert.equal(url, 'https://custom.example/v1/generate')
    assert.equal(init.redirect, 'error')
    assert.equal(init.headers.Authorization, 'Bearer test-provider-key')
    const outboundBody = JSON.parse(init.body)
    assert.equal(outboundBody.model, 'test-model')
    assert.match(outboundBody.messages[1].content, /Match one or more digits/)
    return new Response(JSON.stringify({ result: { text: generatedResult } }), {
      status: 200,
    })
  }

  await withServer({ fetchImplementation }, async (server) => {
    const response = await request(server, '/api/generate-regex', {
      body: generateBody({ aiConfig: providerConfig('custom') }),
    })
    assert.equal(response.status, 200)
    assert.equal((await response.json()).provider, 'custom')
  })
})

test('custom provider URL schemes are restricted to HTTP(S)', async () => {
  await withServer({}, async (server) => {
    const response = await request(server, '/api/generate-regex', {
      body: generateBody({
        aiConfig: { ...providerConfig('custom'), customUrl: 'file:///etc/passwd' },
      }),
    })
    assert.equal(response.status, 400)
    assert.match((await response.json()).error.message, /HTTP or HTTPS/)
  })
})

test('explanation requests return validated annotations', async () => {
  await withServer(
    { fetchImplementation: async () => openAiResponse(explainedResult) },
    async (server) => {
      const response = await request(server, '/api/explain-regex', {
        body: {
          aiConfig: providerConfig(),
          flags: 'g',
          pattern: '\\d+',
          sampleText: '123',
          targetFlavor: 'javascript',
        },
      })
      assert.equal(response.status, 200)
      assert.equal((await response.json()).annotations.length, 2)
    },
  )
})

test('invalid provider output is retried once and can recover', async () => {
  let calls = 0
  await withServer(
    {
      fetchImplementation: async () => {
        calls += 1
        return openAiResponse(calls === 1 ? 'not-json' : generatedResult)
      },
    },
    async (server) => {
      const response = await request(server, '/api/generate-regex', {
        body: generateBody(),
      })
      assert.equal(response.status, 200)
      assert.equal(calls, 2)
    },
  )
})

test('invalid provider output after one retry returns a structured error', async () => {
  let calls = 0
  await withServer(
    { fetchImplementation: async () => {
      calls += 1
      return openAiResponse('not-json')
    } },
    async (server) => {
      const response = await request(server, '/api/generate-regex', {
        body: generateBody(),
      })
      assert.equal(response.status, 502)
      assert.equal((await response.json()).error.code, 'PROVIDER_RESPONSE_INVALID')
      assert.equal(calls, 2)
    },
  )
})

test('provider connection testing succeeds without returning credentials', async () => {
  await withServer(
    { fetchImplementation: async () => openAiResponse('OK') },
    async (server) => {
      const response = await request(server, '/api/test-provider', {
        body: { aiConfig: providerConfig() },
      })
      assert.equal(response.status, 200)
      const responseText = await response.text()
      assert.doesNotMatch(responseText, /test-provider-key/)
      assert.deepEqual(JSON.parse(responseText), {
        model: 'test-model',
        ok: true,
        provider: 'openai',
      })
    },
  )
})

test('configured cross-origin policy allows only the exact origin', async () => {
  await withServer(
    { allowedOrigin: 'https://app.example' },
    async (server) => {
      const allowed = await request(server, '/health', {
        headers: { origin: 'https://app.example' },
        method: 'GET',
      })
      assert.equal(allowed.status, 200)
      assert.equal(
        allowed.headers.get('access-control-allow-origin'),
        'https://app.example',
      )

      const rejected = await request(server, '/health', {
        headers: { origin: 'https://evil.example' },
        method: 'GET',
      })
      assert.equal(rejected.status, 403)
      assert.equal((await rejected.json()).error.code, 'ORIGIN_NOT_ALLOWED')
    },
  )
})
