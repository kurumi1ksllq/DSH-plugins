// T3 (issue #51): the two-phase snapshot merge — a pure function, no IO.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { randomUUID } from 'node:crypto'
import { mergeImports } from '../lib/merge.mjs'

const local = (id, name, extra = {}) => ({
  id, name, kind: 'token', secret: `sealed-${name}`, service: null, aliases: [],
  username: null, url: null, note: null, createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z', ...extra,
})
const incoming = (id, name, extra = {}) => ({
  id, name, kind: 'token', secret: `plain-${name}`, service: null, aliases: [],
  username: null, url: null, note: null, createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z', ...extra,
})

test('a brand-new credential is imported', () => {
  const result = mergeImports({ localEntries: [], incomingEntries: [incoming('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'new one')], mode: 'skip' })
  assert.equal(result.imported, 1)
  assert.deepEqual(result.writes.map((entry) => entry.name), ['new one'])
})

test('the same file imported twice: second time everything is skipped', () => {
  const entries = [incoming('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'gh'), incoming('f866f60a-1661-4e4d-a7c2-96002bcabcbf', 'db')]
  const first = mergeImports({ localEntries: [], incomingEntries: entries, mode: 'skip' })
  const second = mergeImports({ localEntries: first.writes, incomingEntries: entries, mode: 'skip' })
  assert.equal(second.imported, 0)
  assert.equal(second.skipped, 2)
  assert.deepEqual(second.writes, [])
})

test('same id, same name, skip mode: skipped without touching the entry', () => {
  const result = mergeImports({
    localEntries: [local('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'gh', { secret: 'local-secret' })],
    incomingEntries: [incoming('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'gh')],
    mode: 'skip',
  })
  assert.equal(result.skipped, 1)
  assert.deepEqual(result.writes, [])
})

test('same id, same name, overwrite mode: the entry is replaced', () => {
  const result = mergeImports({
    localEntries: [local('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'gh', { secret: 'old-sealed' })],
    incomingEntries: [incoming('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'gh', { secret: 'new-plain' })],
    mode: 'overwrite',
  })
  assert.equal(result.updated, 1)
  assert.equal(result.writes.length, 1)
  assert.equal(result.writes[0].secret, 'new-plain')
  assert.equal(result.writes[0].id, '4ad73be4-89d1-4b19-88af-e225f4a3624c')
})

test('#51 rule 2: same id but DIFFERENT name is a conflict in BOTH modes', () => {
  const shared = 'aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa'
  for (const mode of ['skip', 'overwrite']) {
    const result = mergeImports({
      localEntries: [local(shared, 'alpha')],
      incomingEntries: [incoming(shared, 'beta')],
      mode,
    })
    assert.equal(result.conflicts.length, 1, mode)
    assert.equal(result.conflicts[0].reason, 'same-id-different-name')
    assert.deepEqual(result.writes, [], mode)
  }
})

test('#51 rule 3: name taken by ANOTHER id is a conflict in both modes', () => {
  for (const mode of ['skip', 'overwrite']) {
    const result = mergeImports({
      localEntries: [local('405e7bf9-313f-4ee1-b3e4-823b966ecd7d', 'prod ssh')],
      incomingEntries: [incoming('ee3cd80d-5c7b-4dfd-943d-58c43d0f08a3', 'prod ssh')],
      mode,
    })
    assert.equal(result.conflicts.length, 1, mode)
    assert.equal(result.conflicts[0].reason, 'name-taken')
    assert.deepEqual(result.writes, [], mode)
  }
})

test('#51 rule 3b: slug taken by another id is a conflict too', () => {
  const result = mergeImports({
    localEntries: [local('405e7bf9-313f-4ee1-b3e4-823b966ecd7d', 'prod ssh')],
    incomingEntries: [incoming('ee3cd80d-5c7b-4dfd-943d-58c43d0f08a3', 'Prod SSH')],
    mode: 'skip',
  })
  assert.equal(result.conflicts.length, 1)
  assert.equal(result.conflicts[0].reason, 'name-taken')
})

test('stale detection: the local copy is newer than the incoming one', () => {
  const newer = local('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'gh', { updatedAt: '2026-06-01T00:00:00.000Z' })
  const result = mergeImports({
    localEntries: [newer],
    incomingEntries: [incoming('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'gh', { updatedAt: '2026-02-01T00:00:00.000Z' })],
    mode: 'skip',
  })
  assert.equal(result.skipped, 1)
  assert.equal(result.stale, 1)
})

test('batch validation: duplicate ids inside the file reject the WHOLE batch', () => {
  assert.throws(
    () => mergeImports({ localEntries: [], incomingEntries: [incoming('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'a'), incoming('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'b')], mode: 'skip' }),
    /duplicate/,
  )
})

test('batch validation: two entries whose names fold to one slug reject the batch', () => {
  assert.throws(
    () => mergeImports({ localEntries: [], incomingEntries: [incoming('4ad73be4-89d1-4b19-88af-e225f4a3624c', 'prod ssh'), incoming('f866f60a-1661-4e4d-a7c2-96002bcabcbf', 'Prod SSH')], mode: 'skip' }),
    /slug/,
  )
})

test('batch validation: a malformed id rejects the batch', () => {
  assert.throws(
    () => mergeImports({ localEntries: [], incomingEntries: [incoming('not-a-uuid', 'x')], mode: 'skip' }),
    /uuid/i,
  )
})

test('mixed outcomes are counted independently in one pass', () => {
  const result = mergeImports({
    localEntries: [
      local('0e9caaa3-9d8a-4442-9a05-b169c722cce8', 'keep me'),
      local('4860d3b4-4fd4-4bc2-b766-108614a8e3f0', 'update me'),
      local('345b4c2d-3c7c-4e4b-9527-384e1df4b85b', 'blocker'),
    ],
    incomingEntries: [
      incoming('0e9caaa3-9d8a-4442-9a05-b169c722cce8', 'keep me'),
      incoming('4860d3b4-4fd4-4bc2-b766-108614a8e3f0', 'update me'),
      incoming('345b4c2d-3c7c-4e4b-9527-384e1df4b85b', 'blocker'),
      incoming('53d59e16-3136-4ecb-8088-d9b0d5f0e1c4', 'fresh'),
    ],
    mode: 'overwrite',
  })
  // keep/upd/blocker share id+name → overwrite replaces all three; fresh imports.
  assert.equal(result.updated, 3)
  assert.equal(result.imported, 1)
  assert.equal(result.conflicts.length, 0)
  assert.deepEqual(result.writes.map((entry) => entry.name).sort(), ['blocker', 'fresh', 'keep me', 'update me'])
})
