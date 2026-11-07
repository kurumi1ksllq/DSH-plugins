import { test } from 'node:test'
import assert from 'node:assert/strict'
import { missingChangelogEntries } from '../scripts/check-bundle-versions.mjs'

// 回归钉:复合标题行的跨包假绿。旧实现用「行内同时含包名与版本号」的宽松正则,
// dsh-credential-vault@0.5.0 会撞上 '### dsh-credential-vault 0.2.1 / dsh-inventory 0.5.0' 而假绿。
const COMBINED = `### dsh-credential-vault 0.2.1 / dsh-inventory 0.5.0 — combined
### dsh-websearch-failover (bundle 0.2.0 / repo root 0.3.0)
### @local/dsh-prompt-inject 0.2.1 — scoped name
### dev-flow-skill 0.2.3 — real entry
`

test('combined heading must not vouch for a package it does not actually document', () => {
  const missing = missingChangelogEntries('dsh-credential-vault', ['dsh-credential-vault@0.5.0'], COMBINED)
  assert.deepEqual(missing, ['dsh-credential-vault@0.5.0'], '0.2.1 heading must not cover 0.5.0')
})

test('adjacent name+version inside the same segment counts as documented', () => {
  assert.deepEqual(missingChangelogEntries('dsh-inventory', ['dsh-inventory@0.5.0'], COMBINED), [])
  assert.deepEqual(missingChangelogEntries('dsh-websearch-failover', ['dsh-websearch-failover@0.2.0'], COMBINED), [])
  assert.deepEqual(missingChangelogEntries('@local/dsh-prompt-inject', ['@local/dsh-prompt-inject@0.2.1'], COMBINED), [])
  assert.deepEqual(missingChangelogEntries('dev-flow-skill', ['dev-flow-skill@0.2.3'], COMBINED), [])
})

test('versions of other packages in the same heading never leak', () => {
  assert.deepEqual(missingChangelogEntries('dsh-inventory', ['dsh-inventory@0.3.0'], COMBINED), ['dsh-inventory@0.3.0'])
})
