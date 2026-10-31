import type {
  ExplainRegexRequest,
  ExplainRegexResponse,
  GenerateRegexRequest,
  GenerateRegexResponse,
  TestProviderRequest,
} from '../../shared/ai.js'
import {
  createExplainPrompt,
  createGeneratePrompt,
  EXPLAIN_SYSTEM_PROMPT,
  GENERATE_SYSTEM_PROMPT,
} from '../ai/prompts.js'
import {
  generateValidatedJson,
  validateExplainResult,
  validateGenerateResult,
} from '../ai/responseValidation.js'
import { ApiError } from '../errors.js'
import {
  createAIProvider,
  type CustomRequestImplementation,
  type DnsResolver,
  type FetchImplementation,
} from '../providers/index.js'
import type { OutboundPolicyConfig } from '../config.js'

export type AiService = {
  explainRegex(request: ExplainRegexRequest): Promise<ExplainRegexResponse>
  generateRegex(request: GenerateRegexRequest): Promise<GenerateRegexResponse>
  testProvider(request: TestProviderRequest): Promise<{
    model: string
    ok: true
    provider: string
  }>
}

export function createAiService({
  customRequestImplementation,
  dnsResolver,
  fetchImplementation,
  maxProviderResponseBytes,
  outboundPolicy,
  providerTimeoutMs,
}: {
  customRequestImplementation?: CustomRequestImplementation
  dnsResolver?: DnsResolver
  fetchImplementation: FetchImplementation
  maxProviderResponseBytes: number
  outboundPolicy: OutboundPolicyConfig
  providerTimeoutMs: number
}): AiService {
  const providerDependencies = {
    customRequestImplementation,
    dnsResolver,
    fetchImplementation,
    maxResponseBytes: maxProviderResponseBytes,
    outboundPolicy,
    timeoutMs: providerTimeoutMs,
  }

  return {
    async generateRegex(request) {
      const provider = createAIProvider(
        request.aiConfig,
        providerDependencies,
      )
      const result = await generateValidatedJson({
        prompt: createGeneratePrompt(
          request.description,
          request.sampleText,
          request.targetFlavor,
        ),
        provider,
        systemPrompt: GENERATE_SYSTEM_PROMPT,
        validate: (value) =>
          validateGenerateResult(value, request.targetFlavor),
      })

      return {
        ...result,
        model: request.aiConfig.model,
        provider: request.aiConfig.provider,
        targetFlavor: request.targetFlavor,
      }
    },

    async explainRegex(request) {
      const provider = createAIProvider(
        request.aiConfig,
        providerDependencies,
      )
      const result = await generateValidatedJson({
        prompt: createExplainPrompt(
          request.pattern,
          request.flags,
          request.sampleText,
          request.targetFlavor,
        ),
        provider,
        systemPrompt: EXPLAIN_SYSTEM_PROMPT,
        validate: (value) => validateExplainResult(value, request.pattern),
      })

      return {
        ...result,
        model: request.aiConfig.model,
        provider: request.aiConfig.provider,
        targetFlavor: request.targetFlavor,
      }
    },

    async testProvider(request) {
      const provider = createAIProvider(
        request.aiConfig,
        providerDependencies,
      )
      const result = await provider.generate(
        'Reply with the word OK only.',
        'You are testing whether this AI provider connection works.',
      )

      if (!result.text.trim()) {
        throw new ApiError(
          'PROVIDER_RESPONSE_INVALID',
          502,
          'Provider returned an empty response.',
        )
      }

      return {
        model: request.aiConfig.model,
        ok: true,
        provider: request.aiConfig.provider,
      }
    },
  }
}
