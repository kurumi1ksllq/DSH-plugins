// Runtime-state contract for the websearch-failover DSH bundle.
// Covers: ordering (top = highest priority), enable/disable overrides,
// balance/stats persistence, tolerant reads, atomic writes.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const {
  RUNTIME_VERSION,
  emptyRuntime,
  readRuntime,
  writeRuntime,
  applyRuntime,
  reorder,
  setEnabled,
  recordResult,
  setBalance,
  defaultRuntimePath,
} = await import('../lib/runtime.mjs')

let pass = 0
function ok(name, fn) {
  fn()
  pass += 1
  console.log(`PASS ${name}`)
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-runtime-'))
const runtimeFile = path.join(tempRoot, 'nested', 'runtime.json')

const providers = [
  { id: 'tavily', kind: 'tavily', enabled: true },
  { id: 'exa', kind: 'exa', enabled: true },
  { id: 'firecrawl', kind: 'firecrawl', enabled: true },
]

ok('emptyRuntime has the documented shape', () => {
  const state = emptyRuntime()
  assert.equal(state.version, RUNTIME_VERSION)
  assert.deepEqual(state.order, [])
  assert.deepEqual(state.disabled, {})
  assert.deepEqual(state.balances, {})
  assert.deepEqual(state.stats, {})
})

ok('applyRuntime honours the order array (top first)', () => {
  const ordered = applyRuntime(providers, { ...emptyRuntime(), order: ['firecrawl', 'tavily'] })
  assert.deepEqual(ordered.map((p) => p.id), ['firecrawl', 'tavily', 'exa'])
})

ok('applyRuntime drops disabled providers but keeps config order for the rest', () => {
  const state = { ...emptyRuntime(), disabled: { exa: true } }
  assert.deepEqual(applyRuntime(providers, state).map((p) => p.id), ['tavily', 'firecrawl'])
})

ok('applyRuntime tolerates stale ids in the order array', () => {
  const state = { ...emptyRuntime(), order: ['gone', 'exa'] }
  assert.deepEqual(applyRuntime(providers, state).map((p) => p.id), ['exa', 'tavily', 'firecrawl'])
})

ok('applyRuntime does not mutate its inputs', () => {
  const state = { ...emptyRuntime(), order: ['exa'], disabled: { tavily: true } }
  const snapshot = JSON.stringify([providers, state])
  applyRuntime(providers, state)
  assert.equal(JSON.stringify([providers, state]), snapshot)
})

ok('reorder keeps only unique non-empty strings', () => {
  const next = reorder(emptyRuntime(), ['exa', 'exa', '', 7, null, ' tavily '])
  assert.deepEqual(next.order, ['exa', 'tavily'])
})

ok('reorder rejects a non-array payload instead of throwing', () => {
  const before = { ...emptyRuntime(), order: ['exa'] }
  const after = reorder(before, 'exa')
  assert.deepEqual(after.order, ['exa'])
})

ok('setEnabled writes boolean overrides only', () => {
  let state = setEnabled(emptyRuntime(), 'exa', false)
  assert.equal(state.disabled.exa, true)
  state = setEnabled(state, 'exa', true)
  assert.equal('exa' in state.disabled, false)
})

ok('setEnabled ignores a missing/short id', () => {
  const state = setEnabled(emptyRuntime(), '', false)
  assert.deepEqual(state.disabled, {})
})

ok('recordResult accumulates call/success/failure counters', () => {
  let state = emptyRuntime()
  state = recordResult(state, 'tavily', 'ok', { at: 1000 })
  state = recordResult(state, 'tavily', 'ok', { at: 2000 })
  state = recordResult(state, 'exa', 'failed', { at: 3000, message: 'HTTP 402 insufficient credit' })
  assert.equal(state.stats.tavily.calls, 2)
  assert.equal(state.stats.tavily.successes, 2)
  assert.equal(state.stats.tavily.failures, 0)
  assert.equal(state.stats.tavily.lastUsedAt, new Date(2000).toISOString())
  assert.equal(state.stats.exa.calls, 1)
  assert.equal(state.stats.exa.failures, 1)
  assert.match(state.stats.exa.lastError, /insufficient credit/)
})

ok('recordResult truncates the stored error message', () => {
  const state = recordResult(emptyRuntime(), 'exa', 'failed', { at: 1, message: 'x'.repeat(5000) })
  assert.ok(state.stats.exa.lastError.length <= 300)
})

ok('setBalance stores a normalized balance record', () => {
  const state = setBalance(emptyRuntime(), 'firecrawl', {
    status: 'ok', remaining: 12, total: 100, unit: 'credits', ratio: 0.12, fetchedAt: 42,
  })
  const stored = state.balances.firecrawl
  assert.equal(stored.remaining, 12)
  assert.equal(stored.ratio, 0.12)
  assert.equal(stored.unit, 'credits')
})

ok('writeRuntime/readRuntime round-trips through a nested path', () => {
  const state = { ...emptyRuntime(), order: ['exa'], balances: { exa: { status: 'ok', remaining: 3 } } }
  writeRuntime(state, runtimeFile)
  const loaded = readRuntime(runtimeFile)
  assert.deepEqual(loaded.order, ['exa'])
  assert.equal(loaded.balances.exa.remaining, 3)
  assert.equal(fs.existsSync(`${runtimeFile}.tmp`), false, 'atomic write must not leave a temp file')
})

ok('readRuntime treats a missing or corrupt file as empty state', () => {
  assert.deepEqual(readRuntime(path.join(tempRoot, 'nope.json')).order, [])
  const broken = path.join(tempRoot, 'broken.json')
  fs.writeFileSync(broken, '{not json', 'utf8')
  const loaded = readRuntime(broken)
  assert.deepEqual(loaded.order, [])
  assert.deepEqual(loaded.stats, {})
})

ok('readRuntime sanitizes hostile values', () => {
  const hostile = path.join(tempRoot, 'hostile.json')
  fs.writeFileSync(
    hostile,
    JSON.stringify({ version: 99, order: ['exa', 5, null], disabled: { exa: 'yes' }, balances: [], stats: 'nope' }),
    'utf8',
  )
  const loaded = readRuntime(hostile)
  assert.deepEqual(loaded.order, ['exa'])
  assert.deepEqual(loaded.disabled, {})
  assert.deepEqual(loaded.balances, {})
  assert.deepEqual(loaded.stats, {})
})

ok('defaultRuntimePath honours WEBSEARCH_FAILOVER_RUNTIME', () => {
  const previous = process.env.WEBSEARCH_FAILOVER_RUNTIME
  process.env.WEBSEARCH_FAILOVER_RUNTIME = path.join(tempRoot, 'custom.json')
  try {
    assert.equal(defaultRuntimePath(), path.join(tempRoot, 'custom.json'))
  } finally {
    if (previous === undefined) delete process.env.WEBSEARCH_FAILOVER_RUNTIME
    else process.env.WEBSEARCH_FAILOVER_RUNTIME = previous
  }
})

ok('defaultRuntimePath falls back to $DSH_HOME/websearch-failover/runtime.json', () => {
  const previousRuntime = process.env.WEBSEARCH_FAILOVER_RUNTIME
  const previousHome = process.env.DSH_HOME
  delete process.env.WEBSEARCH_FAILOVER_RUNTIME
  process.env.DSH_HOME = tempRoot
  try {
    assert.equal(defaultRuntimePath(), path.join(tempRoot, 'websearch-failover', 'runtime.json'))
  } finally {
    if (previousRuntime !== undefined) process.env.WEBSEARCH_FAILOVER_RUNTIME = previousRuntime
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
})

console.log(`\n${pass} PASS — runtime state contract holds`)
