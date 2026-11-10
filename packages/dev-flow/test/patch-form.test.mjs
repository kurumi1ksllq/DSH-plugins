// The bundle patch has to describe rows this package *adds*, not rows it edits.
//
// Written as bare `- id: dev-flow` entries, the patch layer reads them as
// modifications of entries that do not exist, logs `entry "dev-flow" not found`
// and mounts nothing — the plugin then never runs, which is exactly the silent
// failure this repository keeps paying for (issue #161). Six sibling bundles
// wrap their new rows in `- insert:`; this contract keeps dev-flow doing the same.

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PATCH = readFileSync(join(HERE, '..', 'cordis.patch.yml'), 'utf8')

/** Entries at column 0: either `- insert:` or a modification of an existing row. */
function topLevelEntries(text) {
  return text.split('\n').filter((line) => line.startsWith('- '))
}

/** Row ids nested under an `- insert:` block (the shipped shape indents them by four). */
export function insertedIds(text) {
  return [...text.matchAll(/^ {4}- id:\s*(\S+)\s*$/gm)].map((match) => match[1])
}

describe('dev-flow bundle patch (#161)', () => {
  it('only adds rows: every top-level entry is an insert block', () => {
    const entries = topLevelEntries(PATCH)
    assert.ok(entries.length > 0, 'the patch must carry the rows this bundle ships')
    for (const entry of entries) {
      assert.equal(
        entry.startsWith('- insert:'),
        true,
        'dev-flow ships new rows, so a bare modification entry is a mistake: ' + entry,
      )
    }
  })

  it('inserts the flow row and the board row, in that order', () => {
    assert.deepEqual(insertedIds(PATCH), ['dev-flow', 'git-status'])
  })

  it('carries no config, because neither row has a Config schema', () => {
    assert.equal(/^\s+config:/m.test(PATCH), false, 'a row without a Config schema must not receive config')
  })

  it('carries no keys the host never reads', () => {
    assert.equal(/skillName|skillPath/.test(PATCH), false)
  })
})
