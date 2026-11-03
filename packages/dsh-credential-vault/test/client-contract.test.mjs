// Contract test for the browser half.
//
// The vault used to register a sidebar row and a main panel. Since the UI moved
// into dsh-inventory's Tools page, its only remaining job is to ship the
// `credential-vault` locale dictionary. Registering slots again (or asking for
// services it no longer uses) would put a second, unowned copy of the UI back in
// the product, so the shape is pinned here.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

function loadBundle() {
  let captured = null
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (definition) => { captured = definition } },
      setTimeout: () => 0,
    },
    document: { createElement: () => ({ style: {}, setAttribute() {}, select() {} }), body: { appendChild() {}, removeChild() {} }, execCommand: () => true },
    navigator: {},
    fetch: () => Promise.reject(new Error('no network in test')),
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  return captured
}

const bundle = loadBundle()

function applyWith(enabled) {
  const registered = []
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: (ns, dict) => registered.push({ kind: 'locale', ns, dict }), bind: () => (k) => k },
    slots: {
      inject: (name, run) => { registered.push({ kind: 'inject', name }); return run() },
      register: (spec) => registered.push({ kind: 'slot', spec }),
    },
    layout: { selectPanel: () => {} },
  }
  const module = bundle.factory(() => ({}))
  module.apply(ctx)
  return { module, registered }
}

test('the vault client registers only its locale dictionary', () => {
  const { registered } = applyWith(true)
  const kinds = registered.map((r) => r.kind)
  assert.deepEqual(kinds, ['locale'], `unexpected registrations: ${kinds.join(', ')}`)
})

test('the vault client declares no slot or layout dependency', () => {
  const { module } = applyWith(true)
  // `module.inject` comes from another vm realm, so its Array prototype differs
  // from ours — compare contents, not identity.
  assert.deepEqual([...module.inject], ['locale'])
})

test('the dictionary still carries the vault namespace', () => {
  const { registered } = applyWith(true)
  const locale = registered.find((r) => r.kind === 'locale')
  assert.equal(locale.ns, 'credential-vault')
  assert.ok(Object.keys(locale.dict.zh).length > 0)
  assert.ok(Object.keys(locale.dict.en).length > 0)
})
