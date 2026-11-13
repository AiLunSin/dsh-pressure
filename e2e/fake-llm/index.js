/**
 * Offline scripted LLM adapter for the end-to-end verification.
 *
 * It scripts one real DSH turn: three failing `read` calls followed by a final
 * text answer. The point is to exercise the real pipeline — tool dispatch,
 * `tools/post-execute` notices, `tools/guard` denials, Session events, and the
 * receipt writer — without a model account or token spend.
 *
 * Test only; this package is excluded from the published files.
 */

export const name = 'fake-llm'
export const inject = ['llm']

/**
 * @param {string} provider
 * @param {string} model
 */
function createAdapter(provider, model) {
  let agentCalls = 0
  return {
    providerInfo() {
      return { id: provider, name: 'Fake scripted provider' }
    },
    providerRetryPolicy() {
      return undefined
    },
    imageRequestPricing() {
      return undefined
    },
    imageRequestTarget(_provider, _model, image) {
      return { width: image.width, height: image.height, maxBytes: image.bytes }
    },
    async listModels() {
      return [{ provider, id: model, name: 'Fake scripted model' }]
    },
    async resolveModel() {
      return {
        provider,
        id: model,
        name: 'Fake scripted model',
        context: { contextWindow: 128000 },
        defaultMaxTokens: 1024,
      }
    },
    async prepareCall() {
      return { model: await this.resolveModel(), stream: (options) => this.stream(options) }
    },
    async *stream(options) {
      // Title generation and other auxiliary calls carry no tools; only agent
      // loop requests advance the script.
      const agentLoop = Array.isArray(options?.tools) && options.tools.length > 0
      if (!agentLoop) {
        yield usage(0)
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      agentCalls += 1
      const id = `call_${agentCalls}`
      if (agentCalls <= 3) {
        const args = JSON.stringify({ path: `missing-${agentCalls}.txt` })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: 'read', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'read', arguments: args } }
        yield usage(agentCalls)
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      const text = 'Stopped after three failing reads; reporting instead of retrying.'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield usage(agentCalls)
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  }
}

/** @param {number} attempt */
function usage(attempt) {
  return {
    type: 'usage',
    usage: {
      inputTokens: 1000 + attempt * 100,
      outputTokens: 40,
      cacheReadTokens: attempt > 1 ? 400 : 0,
      cacheWriteTokens: 20,
    },
  }
}

/** @param {any} ctx */
export function apply(ctx) {
  const adapter = createAdapter('fake', 'fake-1')
  ctx.effect(() => ctx.llm.registerAdapter(['fake'], adapter))
  ctx.logger?.info?.('[fake-llm] scripted adapter registered for provider "fake"')
}
