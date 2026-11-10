// The one claim this bundle makes is that its text reaches the model. A stub
// can accept shapes the real service rejects (`required` misspelled, `text` not
// a provider, a changed `ctx.inject` callback), so the registration is also
// exercised against the host's own SystemPrompt when this checkout can see it.
//
// When the runtime is not resolvable (a bare checkout, CI without the install
// tree) the case is skipped rather than faked: a green stub here would be
// worth as little as the silence this issue is trying to remove.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'

import * as plugin from '../index.js'

const RUNTIME = process.env.DSH_RUNTIME ?? '/opt/dsh-runtime/dshcli/lib/node_modules/@deepseek-ai/dsh'

/** Resolve the host's system-prompt service, or null when it is not installed. */
async function loadHost() {
  const candidates = [
    { cordis: '@deepseek-ai/cordis', prompt: '@deepseek-ai/dsh-system-prompt' },
    {
      cordis: join(RUNTIME, 'node_modules/@deepseek-ai/cordis/lib/index.js'),
      prompt: join(RUNTIME, 'node_modules/@deepseek-ai/dsh-system-prompt/lib/index.js'),
    },
  ]
  for (const candidate of candidates) {
    try {
      const [{ Context }, promptModule] = await Promise.all([import(candidate.cordis), import(candidate.prompt)])
      return { Context, SystemPrompt: promptModule.default ?? promptModule.SystemPrompt }
    } catch {
      continue
    }
  }
  return null
}

describe('the contract reaches the assembled prompt (needs the host runtime)', () => {
  it('registers a context the real SystemPrompt hands back on assemble', async (t) => {
    const host = await loadHost()
    if (host === null) {
      t.skip('host systemPrompt service not installed in this checkout')
      return
    }
    const ctx = new host.Context()
    ctx.plugin(host.SystemPrompt)
    plugin.apply(ctx)
    // `ctx.inject` resolves the service asynchronously, so give the effect a tick.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const assembly = await ctx.systemPrompt.assemble()
    const mine = assembly.contexts.find((entry) => entry.name === plugin.CONTEXT_NAME)
    assert.ok(mine, 'assemble must carry ' + plugin.CONTEXT_NAME + ', got: ' + assembly.contexts.map((entry) => entry.name).join(','))
    assert.ok(mine.text.length > 200, 'the contract must not assemble empty')
    assert.match(mine.text, /禁止直接改 main/)
    assert.match(mine.text, /FLOW\.md/)
    ctx.stop?.()
  })
})
