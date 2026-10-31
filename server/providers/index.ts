import type { AIProviderSettings } from '../../shared/ai.js'
import type { OutboundPolicyConfig } from '../config.js'
import { ApiError } from '../errors.js'
import {
  authorizeCustomDestination,
  type DnsResolver,
  resolveAllAddresses,
} from '../security/outboundPolicy.js'
import {
  type CustomRequestImplementation,
  readLimitedFetchResponse,
  requestCustomProvider,
} from '../security/providerTransport.js'

export type { DnsResolver } from '../security/outboundPolicy.js'
export type { CustomRequestImplementation } from '../security/providerTransport.js'

export type FetchImplementation = typeof fetch

export interface AIProvider {
  generate(prompt: string, systemPrompt: string): Promise<{ text: string }>
}

export type ProviderDependencies = {
  customRequestImplementation?: CustomRequestImplementation
  dnsResolver?: DnsResolver
  fetchImplementation: FetchImplementation
  maxResponseBytes: number
  outboundPolicy: OutboundPolicyConfig
  timeoutMs: number
}

async function requestProvider(
  url: string,
  init: RequestInit,
  dependencies: ProviderDependencies,
  custom = false,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), dependencies.timeoutMs)

  try {
    let status: number
    let rawText: string

    if (custom) {
      const destination = await authorizeCustomDestination(
        url,
        dependencies.outboundPolicy,
        dependencies.dnsResolver ?? resolveAllAddresses,
        controller.signal,
      )
      const response = await (
        dependencies.customRequestImplementation ?? requestCustomProvider
      )(destination, init, {
        maxResponseBytes: dependencies.maxResponseBytes,
        signal: controller.signal,
      })
      status = response.status
      rawText = response.body
    } else {
      const response = await dependencies.fetchImplementation(url, {
        ...init,
        redirect: 'error',
        signal: controller.signal,
      })
      status = response.status
      rawText = await readLimitedFetchResponse(
        response,
        dependencies.maxResponseBytes,
        controller,
      )
    }

    if (status < 200 || status >= 300) {
      throw new ApiError(
        'PROVIDER_REQUEST_FAILED',
        502,
        `Provider returned HTTP ${status}.`,
      )
    }

    try {
      return JSON.parse(rawText) as unknown
    } catch {
      return rawText
    }
  } catch (error) {
    if (error instanceof ApiError) {
      throw error
    }

    if (controller.signal.aborted) {
      throw new ApiError(
        'PROVIDER_TIMEOUT',
        504,
        `Provider request timed out after ${dependencies.timeoutMs}ms.`,
      )
    }

    throw new ApiError(
      'PROVIDER_REQUEST_FAILED',
      502,
      'Provider request failed.',
    )
  } finally {
    clearTimeout(timeout)
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
    throw new ApiError(
      'PROVIDER_RESPONSE_INVALID',
      502,
      'Provider response did not contain text at the configured path.',
    )
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

class AnthropicProvider implements AIProvider {
  private readonly config: AIProviderSettings
  private readonly dependencies: ProviderDependencies

  constructor(
    config: AIProviderSettings,
    dependencies: ProviderDependencies,
  ) {
    this.config = config
    this.dependencies = dependencies
  }

  async generate(prompt: string, systemPrompt: string) {
    const payload = await requestProvider(
      'https://api.anthropic.com/v1/messages',
      {
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
      },
      this.dependencies,
    )
    const content = (payload as { content?: Array<{ text?: string; type?: string }> })
      .content

    if (!Array.isArray(content)) {
      throw new ApiError(
        'PROVIDER_RESPONSE_INVALID',
        502,
        'Anthropic response did not include text content.',
      )
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
  private readonly config: AIProviderSettings
  private readonly dependencies: ProviderDependencies

  constructor(
    config: AIProviderSettings,
    dependencies: ProviderDependencies,
  ) {
    this.config = config
    this.dependencies = dependencies
  }

  async generate(prompt: string, systemPrompt: string) {
    const payload = await requestProvider(
      'https://api.openai.com/v1/chat/completions',
      {
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
      },
      this.dependencies,
    )

    return {
      text: extractResponseText(payload, 'choices.0.message.content'),
    }
  }
}

class CustomEndpointProvider implements AIProvider {
  private readonly config: AIProviderSettings
  private readonly dependencies: ProviderDependencies

  constructor(
    config: AIProviderSettings,
    dependencies: ProviderDependencies,
  ) {
    this.config = config
    this.dependencies = dependencies
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

    headers[this.config.customApiKeyHeader] = this.config.customApiKeyPrefix
      ? `${this.config.customApiKeyPrefix} ${this.config.apiKey}`
      : this.config.apiKey

    let body: unknown

    try {
      body = JSON.parse(renderedBody)
    } catch {
      throw new ApiError(
        'INVALID_REQUEST',
        400,
        'Custom request template did not render as valid JSON.',
      )
    }

    const payload = await requestProvider(
      this.config.customUrl,
      {
        body: JSON.stringify(body),
        headers,
        method: 'POST',
      },
      this.dependencies,
      true,
    )

    return {
      text: extractResponseText(payload, this.config.customResponsePath),
    }
  }
}

export function createAIProvider(
  config: AIProviderSettings,
  dependencies: ProviderDependencies,
): AIProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config, dependencies)
    case 'openai':
      return new OpenAIProvider(config, dependencies)
    case 'custom':
      return new CustomEndpointProvider(config, dependencies)
  }
}
