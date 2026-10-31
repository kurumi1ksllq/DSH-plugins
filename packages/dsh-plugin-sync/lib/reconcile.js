/**
 * One full reconciliation pass.
 *
 * Pure with respect to `options`: the test suite injects `installed`, `fetched`
 * and `applyPlugins`, so no test needs a real git remote or a real pnpm.
 */
import { diff } from './compare.js'
import { fetchManifest } from './fetch.js'
import { readInstalled, resolveProfileDir } from './installed.js'

export async function reconcile(config, options = {}) {
  const profileDir = options.profileDir ?? resolveProfileDir(options.ctx ?? {}, options.env ?? process.env)
  const installed = options.installed ?? readInstalled(profileDir)
  const fetched = options.fetched ?? (await fetchManifest(config, options))

  if (!fetched.ok) {
    return {
      ok: false,
      reason: fetched.reason,
      profileDir,
      fetchedAt: Date.now(),
      installed: installed.length,
      actions: [],
      extras: [],
      pending: [],
      applied: [],
    }
  }

  const result = diff(installed, fetched.plugins, { exclude: config.exclude })
  const applied = []
  const runner = options.applyPlugins
  if (config.apply === true && config.direction === 'remote' && result.applicable.length > 0 && typeof runner === 'function') {
    for (const action of result.applicable) {
      try {
        await runner(action, { profileDir, config })
        applied.push({ name: action.name, state: action.state, ok: true })
      } catch (error) {
        applied.push({ name: action.name, state: action.state, ok: false, error: String(error?.message ?? error) })
      }
    }
  }

  return {
    ok: true,
    reason: null,
    profileDir,
    fetchedAt: Date.now(),
    repo: config.repo,
    ref: config.ref,
    installed: installed.length,
    manifestProblems: fetched.problems,
    actions: result.actions,
    extras: result.extras,
    pending: result.pending,
    applied,
  }
}
