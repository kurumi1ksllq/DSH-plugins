// Contract test for the browser half.
//
// This file used to be a 384-line render smoke test: it mounted the old sidebar
// `Page` component and asserted provider rows, balance bars and every POST body.
//
// That component no longer exists. The provider manager is a section of
// dsh-inventory's Tools page, so the behaviour assertions moved there
// (`packages/dsh-inventory/test/client.test.mjs` — provider rows, priority
// order, balance bar geometry, refresh-only-on-click). What remains this
// bundle's own responsibility is its load contract: one ModuleLoader record
// with the right id, a `locale`-only dependency, and the dictionary the Tools
// page reads.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

const reactStub = {
  createElement: () => null,
  useState: () => [null, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}

function loadBundle() {
  const loads = []
  const windowStub = { __ModuleLoader__: { load: (record) => loads.push(record) } }
  const run = new Function(
    'window', 'require', 'console', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    source,
  )
  run(
    windowStub,
    () => reactStub,
    console,
    () => Promise.resolve({ ok: true, json: async () => ({}) }),
    setTimeout, clearTimeout, setInterval, clearInterval,
  )
  return loads
}

test('the bundle registers exactly one module loader record with its own id', () => {
  const loads = loadBundle()
  assert.equal(loads.length, 1)
  assert.equal(loads[0].id, 'dsh-websearch-failover')
})

test('the browser half depends on the locale service only', () => {
  const loads = loadBundle()
  const plugin = loads[0].factory(() => reactStub)
  // `inject` crosses a sandbox boundary, so compare contents rather than identity.
  assert.deepEqual([...plugin.inject], ['locale'])
  assert.equal(typeof plugin.apply, 'function')
})

test('applying the plugin registers the websearch-failover dictionary', () => {
  const loads = loadBundle()
  const plugin = loads[0].factory(() => reactStub)
  const registered = []
  plugin.apply({
    effect: (fn) => fn(),
    locale: { register: (ns, dicts) => registered.push({ ns, dicts }), bind: () => (k) => k },
  })
  assert.equal(registered.length, 1)
  assert.equal(registered[0].ns, 'websearch-failover')
  assert.ok(Object.keys(registered[0].dicts.zh).length > 0, 'zh dictionary must not be empty')
  assert.ok(Object.keys(registered[0].dicts.en).length > 0, 'en dictionary must not be empty')
})

test('the old sidebar section export is gone', () => {
  const loads = loadBundle()
  const plugin = loads[0].factory(() => reactStub)
  assert.equal(plugin.__providersPage, undefined, 'the deleted Page must not still be exported')
})
