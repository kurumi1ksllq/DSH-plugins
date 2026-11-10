// The bundle patch has to describe rows this package *adds*, not rows it edits.
//
// Written as bare `- id: dev-flow` entries, the patch layer reads them as
// modifications of entries that do not exist, logs `entry "dev-flow" not found`
// and mounts nothing — the plugin then never runs (issue #161). Six sibling
// bundles wrap their new rows in `- insert:`; this contract keeps dev-flow doing
// the same.
//
// The file is read as structure, not as fixed indentation: a reindented or
// reflowed patch must stay green, and an id nested deeper (a group insert) must
// not slip past the row list.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(HERE, '..')
const PATCH = readFileSync(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
const MANIFEST = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))

/** Entries at column 0, each with the lines that belong to it. */
function entries(text) {
  const list = []
  let current = null
  for (const line of text.split('\n')) {
    if (line.startsWith('- ')) {
      current = { head: line, body: [] }
      list.push(current)
    } else if (current !== null) {
      current.body.push(line)
    }
  }
  return list
}

/** Row ids nested under an insert block, whatever the indent depth. */
function insertedIds(text) {
  return entries(text)
    .filter((entry) => entry.head.startsWith('- insert:'))
    .flatMap((entry) => entry.body)
    .map((line) => /^\s*-\s*id:\s*'?([^'\s]+)'?\s*$/.exec(line))
    .filter((match) => match !== null)
    .map((match) => match[1])
}

describe('dev-flow bundle patch (#161)', () => {
  it('only adds rows: every top-level entry is an insert block', () => {
    const list = entries(PATCH)
    assert.ok(list.length > 0, 'the patch must carry the rows this bundle ships')
    for (const entry of list) {
      assert.equal(
        entry.head.startsWith('- insert:'),
        true,
        'these ids are new, so the row goes under `- insert:`; a bare entry edits an existing row: ' + entry.head,
      )
    }
  })

  it('inserts the flow row and the board row, in that order', () => {
    assert.deepEqual(insertedIds(PATCH), ['dev-flow', 'git-status'])
  })

  it('names each row by an export the package really declares', () => {
    // The name is what the loader imports; an id-only assertion would stay green
    // while the host failed to resolve the module at boot.
    const names = [...PATCH.matchAll(/^\s*-?\s*name:\s*'?([^'\n]+)'?\s*$/gm)].map((match) => match[1])
    assert.deepEqual(names, ['dev-flow', 'dev-flow/git-status'])
    for (const name of names) {
      const subpath = name === MANIFEST.name ? '.' : './' + name.slice(MANIFEST.name.length + 1)
      assert.ok(MANIFEST.exports[subpath], `row name "${name}" must map to export "${subpath}"`)
    }
  })

  it('each row name resolves to a loadable module with an apply hook', async () => {
    // Self-reference: the package exports these subpaths, so the test imports the
    // same specifiers the host will. A mounted row that cannot be imported is the
    // other half of the #161 failure, and no patch-shape assertion would see it.
    for (const name of ['dev-flow', 'dev-flow/git-status']) {
      const module = await import(name)
      assert.equal(typeof module.apply, 'function', name + ' must export apply()')
    }
  })

  it('carries no config, because neither row has a Config schema', () => {
    assert.equal(/^\s+config:/m.test(PATCH), false, 'a row without a Config schema must not receive config')
  })

  it('carries no keys the host never reads', () => {
    assert.equal(/skillName|skillPath/.test(PATCH), false)
  })
})
