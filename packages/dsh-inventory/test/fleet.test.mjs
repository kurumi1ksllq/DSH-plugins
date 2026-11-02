/**
 * Fleet manifest: multi-machine publishing semantics.
 *
 * The question this file answers with tests: what happens when two machines
 * publish at the same time? The old whole-file behaviour meant the last writer
 * erased the first. The fleet document + read-merge-conditional-write loop must
 * make both publishes land, every machine's section intact, with retries
 * converging instead of clobbering.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildFleetDocument,
  flattenFleet,
  fleetHasMachine,
  FLEET_VERSION,
  LEGACY_ID,
  machineCount,
  machineIds,
  MAX_MACHINES,
  mergeFleetDocument,
  normalizeMachineId,
  parseFleetDocument,
} from '../lib/fleet.js'
import { sameManifest, publishHttp, publishManifest } from '../lib/sync-publish.js'
import { syncPublish } from '../lib/sync-service.js'

function section(overrides = {}) {
  return {
    manifestVersion: 1,
    generatedAt: 100,
    repo: 'o/r',
    ref: 'main',
    plugins: [{ kind: 'plugin', name: 'a', version: '1.0.0', source: 'npm', spec: '1.0.0', platform: 'any' }],
    mcp: [],
    skills: [],
    ...overrides,
  }
}

const SNAPSHOT = {
  packages: [{ name: 'a', spec: 'npm:1.0.0', version: '1.0.0' }],
  mcp: [],
  skills: [],
}

function state(overrides = {}) {
  return {
    repo: 'o/r',
    ref: 'main',
    path: 'dsh-manifest.json',
    mode: 'github',
    repoUrl: '',
    token: 't',
    annotations: {},
    lastPullAt: 0,
    lastPushAt: 0,
    machineId: 'machine-a',
    ...overrides,
  }
}

// ---- document shape ---------------------------------------------------------

test('a v1 document parses as one legacy machine section', () => {
  const parsed = parseFleetDocument(JSON.stringify(section()))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.legacy, true)
  assert.deepEqual(machineIds(parsed.fleet), [LEGACY_ID])
  assert.equal(machineCount(parsed.fleet), 1)
})

test('a v2 document round-trips its sections', () => {
  const doc = buildFleetDocument(section(), 'Laptop-1')
  assert.equal(doc.fleetVersion, FLEET_VERSION)
  const parsed = parseFleetDocument(JSON.stringify(doc))
  assert.equal(parsed.ok, true)
  assert.equal(parsed.legacy, false)
  assert.deepEqual(machineIds(parsed.fleet), ['laptop-1'])
})

test('broken sections are dropped, not fatal', () => {
  const doc = JSON.stringify({
    fleetVersion: FLEET_VERSION,
    machines: { good: section(), broken: 42, alsoBroken: 'x', arr: [] },
  })
  const parsed = parseFleetDocument(doc)
  assert.equal(parsed.ok, true)
  assert.deepEqual(machineIds(parsed.fleet), ['good'])
})

test('a section named __proto__ is refused, not parsed into prototypes', () => {
  assert.equal(normalizeMachineId('__proto__'), LEGACY_ID)
  assert.equal(normalizeMachineId('constructor'), LEGACY_ID)
  // `obj['__proto__'] = x` sets the prototype instead of adding a key, so a
  // hostile JSON document must be simulated with a real own property — that is
  // exactly what `JSON.parse` produces for `{"__proto__": {...}}`.
  const doc = { fleetVersion: FLEET_VERSION, generatedAt: 0, machines: {} }
  Object.defineProperty(doc.machines, '__proto__', { value: section(), enumerable: true, configurable: true, writable: true })
  // Filtering leaves no sections at all, which flattenFleet reports as "empty
  // document" (null) — the same answer a fleet with no machines gives.
  assert.equal(flattenFleet(doc), null)
  // And nothing leaked onto Object.prototype.
  assert.equal({}.plugins, undefined)
})

// ---- merge semantics --------------------------------------------------------

test('merging keeps the other machine section untouched', () => {
  const other = section({ generatedAt: 5, plugins: [{ kind: 'plugin', name: 'theirs', version: '9', source: 'npm', spec: '9', platform: 'any' }] })
  const fleet = { fleetVersion: FLEET_VERSION, generatedAt: 0, machines: { 'box-b': other } }
  const merged = mergeFleetDocument(fleet, 'machine-a', section())
  assert.deepEqual(machineIds(merged), ['box-b', 'machine-a'])
  assert.deepEqual(merged.machines['box-b'], other)
})

test('merging replaces only our own section', () => {
  const oursOld = section({ generatedAt: 1, plugins: [{ kind: 'plugin', name: 'old', version: '0', source: 'npm', spec: '0', platform: 'any' }] })
  const fleet = { fleetVersion: FLEET_VERSION, generatedAt: 0, machines: { 'machine-a': oursOld, 'box-b': section() } }
  const merged = mergeFleetDocument(fleet, 'machine-a', section({ generatedAt: 2 }))
  assert.equal(merged.machines['machine-a'].generatedAt, 2)
  assert.equal(machineCount(merged), 2)
})

test('a legacy base is absorbed, not kept as a ghost section', () => {
  const parsed = parseFleetDocument(JSON.stringify(section()))
  const merged = mergeFleetDocument(parsed.fleet, 'machine-a', section({ generatedAt: 2 }))
  assert.deepEqual(machineIds(merged), ['machine-a'])
  assert.equal(merged.machines[LEGACY_ID], undefined)
})

test('a full fleet refuses a new machine instead of evicting one', () => {
  const machines = {}
  for (let i = 0; i < MAX_MACHINES; i += 1) machines[`m${i}`] = section()
  const merged = mergeFleetDocument({ fleetVersion: FLEET_VERSION, machines }, 'fresh', section())
  assert.equal(merged, null)
})

test('merging does not mutate the base fleet', () => {
  const fleet = { fleetVersion: FLEET_VERSION, generatedAt: 0, machines: { 'box-b': section() } }
  const snapshot = JSON.stringify(fleet)
  mergeFleetDocument(fleet, 'machine-a', section())
  assert.equal(JSON.stringify(fleet), snapshot)
})

// ---- flatten ----------------------------------------------------------------

test('flatten unions every machine section into one view', () => {
  const fleet = {
    fleetVersion: FLEET_VERSION,
    generatedAt: 0,
    machines: {
      a: section({ generatedAt: 5, plugins: [{ kind: 'plugin', name: 'alpha', version: '1', source: 'npm', spec: '1', platform: 'any' }] }),
      b: section({ generatedAt: 6, plugins: [{ kind: 'plugin', name: 'beta', version: '2', source: 'npm', spec: '2', platform: 'any' }] }),
    },
  }
  const flat = flattenFleet(fleet)
  assert.deepEqual(flat.plugins.map((p) => p.name).sort(), ['alpha', 'beta'])
})

test('flatten resolves duplicate entries by the newest section', () => {
  const old = section({ generatedAt: 1, plugins: [{ kind: 'plugin', name: 'a', version: '1.0.0', source: 'npm', spec: '1.0.0', platform: 'any' }] })
  const fresh = section({ generatedAt: 9, plugins: [{ kind: 'plugin', name: 'a', version: '2.0.0', source: 'npm', spec: '2.0.0', platform: 'any' }] })
  const fleet = { fleetVersion: FLEET_VERSION, generatedAt: 0, machines: { old, new: fresh } }
  assert.equal(flattenFleet(fleet).plugins[0].version, '2.0.0')
  // Ties break by section id, so both iteration orders converge.
  const flipped = { fleetVersion: FLEET_VERSION, generatedAt: 0, machines: { old: fresh, new: old } }
  assert.equal(flattenFleet(flipped).plugins[0].version, '2.0.0')
})

test('flatten carries the newest section header facts', () => {
  const fleet = {
    fleetVersion: FLEET_VERSION,
    generatedAt: 0,
    machines: {
      a: section({ generatedAt: 5, repo: 'a/repo' }),
      b: section({ generatedAt: 7, repo: 'b/repo', repoUrl: 'https://x' }),
    },
  }
  const flat = flattenFleet(fleet)
  assert.equal(flat.repo, 'b/repo')
  assert.equal(flat.repoUrl, 'https://x')
  assert.equal(flat.generatedAt, 7)
})

// ---- v1 ↔ v2 equivalence ----------------------------------------------------

test('sameManifest treats a v1 file and its own fleet rendering as equal', () => {
  const v1 = JSON.stringify(section())
  const v2 = JSON.stringify({ fleetVersion: FLEET_VERSION, generatedAt: 1, machines: { m1: section({ generatedAt: 2 }) } })
  assert.equal(sameManifest(v1, v2), true)
})

test('sameManifest still detects real content changes through the fleet', () => {
  const v1 = JSON.stringify(section())
  const v2 = JSON.stringify({
    fleetVersion: FLEET_VERSION,
    generatedAt: 1,
    machines: { m1: section({ plugins: [{ kind: 'plugin', name: 'changed', version: '9', source: 'npm', spec: '9', platform: 'any' }] }) },
  })
  assert.equal(sameManifest(v1, v2), false)
})

test('sameManifest keeps the formatting tolerance for fleet documents', () => {
  const doc = { fleetVersion: FLEET_VERSION, generatedAt: 1, machines: { m1: section() } }
  assert.equal(sameManifest(JSON.stringify(doc), JSON.stringify(doc, null, 4) + '\r\n'), true)
})
