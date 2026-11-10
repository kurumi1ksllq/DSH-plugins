import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import yaml from 'js-yaml'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = dirname(HERE)

const WHITELIST = ['planner', 'architect', 'code-reviewer', 'security-reviewer', 'build-error-resolver']

test('bundle manifest is a valid link-able bundle', async () => {
  const pkg = JSON.parse(await readFile(join(PKG, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'ecc-agent-presets')
  assert.ok(pkg.dsh?.bundle?.patch === './cordis.patch.yml')
  assert.ok(/\^0\.2\.0/.test(pkg.engines?.dsh ?? ''))
  assert.ok(pkg.scripts?.test?.length > 0)
  assert.equal(pkg.exports?.['./client'], undefined, 'preset collection is host-only: no client export')
})

test('patch carries exactly the 133 non-whitelisted preset rows', async () => {
  const doc = yaml.load(await readFile(join(PKG, 'cordis.patch.yml'), 'utf8'))
  assert.equal(Array.isArray(doc), true, 'patch root must be a sequence (loader dialect)')
  assert.equal(doc.length, 1, 'single insert block')
  const rows = doc[0].insert
  assert.equal(rows.length, 133)
  assert.ok(rows.every((row) => row.name === '@deepseek-ai/dsh-agent-preset'), 'every row declares an agent preset')
  assert.equal(new Set(rows.map((row) => row.id)).size, 133, 'row ids unique')
  const configIds = new Set(rows.map((row) => row.config.id))
  for (const kept of WHITELIST) {
    assert.equal(configIds.has(kept), false, `whitelisted preset ${kept} must stay in the main profile, not here`)
  }
})

test('the main profile patch still carries the whitelisted rows and none of the moved ones', async (t) => {
  // Deployment-side sentinel: reads the HOST's profile patch, which only
  // exists on the operator machine (not in CI or verify-clean worktrees).
  // It can never turn red from a repository change alone, so the skip is
  // declared explicitly; the authoritative post-deployment evidence lives in
  // docs/specs/issue-151-deployment-log.md.
  const profilePatch = await readFile(join(PKG, '..', '..', '..', '.dsh', 'profiles', 'web', 'cordis.patch.yml'), 'utf8')
    .catch(() => null)
  if (profilePatch === null) return t.skip('host profile layout not present (CI / clean worktree)')
  const moved = yaml.load(await readFile(join(PKG, 'cordis.patch.yml'), 'utf8'))[0].insert.map((row) => row.id)
  for (const id of moved) {
    assert.equal(
      new RegExp(`^    - id: ${id}$`, 'm').test(profilePatch),
      false,
      `${id} still mounted in the main profile patch — deployment step pending (spec issue-151 §验收 D)`,
    )
  }
  for (const kept of WHITELIST) {
    assert.equal(
      new RegExp(`^    - id: preset-${kept}$`, 'm').test(profilePatch),
      true,
      `whitelisted preset-${kept} must stay mounted in the main profile`,
    )
  }
})

test('locale files exist and meta keys match across locales', async () => {
  const en = JSON.parse(await readFile(join(PKG, 'locale/en.json'), 'utf8'))
  const zh = JSON.parse(await readFile(join(PKG, 'locale/zh.json'), 'utf8'))
  for (const dict of [en, zh]) {
    assert.ok(dict.meta?.title)
    assert.ok(dict.meta?.description)
  }
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())
})
