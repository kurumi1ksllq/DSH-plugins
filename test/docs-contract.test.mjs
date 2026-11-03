// Repo-level documentation contract.
//
// The root README and AGENTS.md are the first things a new session reads, and
// they were both wrong at some point: the README still said "six plugins" when
// the workspace carried seven, and listed sidebar panels that had been merged
// into dsh-inventory's Tools page. AGENTS.md did not exist at all, so nothing in
// the repository told a fresh session that dev-flow is mandatory — the skill only
// fired when a request happened to match its description.
//
// These tests bind the prose to the facts it claims, so the next drift fails CI
// instead of misleading the next reader.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, '..')
const README = readFileSync(join(ROOT, 'README.md'), 'utf8')

/** Bundle directories the workspace actually carries. */
function packageDirs() {
  return readdirSync(join(ROOT, 'packages'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
}

const CN_DIGITS = { 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十' }

test('the README plugin count matches the packages actually present', () => {
  const count = packageDirs().length
  const claimed = README.match(/([一二三四五六七八九十]+)个独立插件/)
  assert.ok(claimed, 'README must state how many plugins the repository holds')
  assert.equal(
    claimed[1],
    CN_DIGITS[count],
    `README says ${claimed[1]} plugins but packages/ holds ${count}`,
  )
})

test('the README test-command description matches the package count', () => {
  const count = packageDirs().length
  const claimed = README.match(/pnpm test\s*#\s*([一二三四五六七八九十]+)个包全部测试/)
  assert.ok(claimed, 'README must describe what `pnpm test` covers')
  assert.equal(
    claimed[1],
    CN_DIGITS[count],
    `README says pnpm test covers ${claimed[1]} packages but packages/ holds ${count}`,
  )
})

test('the README does not resurrect the retired sidebar panels', () => {
  // The credential vault, the prompt editor and the provider manager are sections
  // of dsh-inventory's Tools page now; describing them as sidebar panels sends a
  // reader looking for UI that no longer exists.
  for (const phrase of ['侧栏管理面板', '带侧栏编辑器', '侧栏余额管理器']) {
    assert.equal(README.includes(phrase), false, `stale sidebar wording: ${phrase}`)
  }
})

test('the README points a new session at the mandatory development flow', () => {
  assert.ok(README.includes('AGENTS.md'), 'README must point at the repo AGENTS.md')
  assert.ok(README.includes('dev-flow'), 'README must name the dev-flow skill')
})
