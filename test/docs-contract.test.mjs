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
import { dirname, join, relative, sep } from 'node:path'

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

test('AGENTS.md exists and its plugin count matches reality', () => {
  // AGENTS.md is the file that makes the development flow mandatory rather than
  // a lucky skill match, so it is held to the same factual standard as the README.
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
  const count = packageDirs().length
  const claimed = agents.match(/([一二三四五六七八九十]+)个可独立/)
  assert.ok(claimed, 'AGENTS.md must describe the packages it lists')
  assert.equal(claimed[1], CN_DIGITS[count], `AGENTS.md says ${claimed[1]} bundles but packages/ holds ${count}`)

  // "otherwise it becomes the Nth bundle" must stay N+1.
  const ordinal = agents.match(/它会变成第([一二三四五六七八九十]+)个 bundle/)
  assert.ok(ordinal, 'AGENTS.md must warn about the root becoming a bundle')
  assert.equal(ordinal[1], CN_DIGITS[count + 1], `AGENTS.md says the root would become bundle ${ordinal[1]}, expected ${count + 1}`)
})

test('AGENTS.md states the non-negotiables', () => {
  const agents = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
  for (const rule of ['dev-flow', '禁止直接改 main', 'merge #', '.flow', '禁测私有函数']) {
    assert.ok(agents.includes(rule), `AGENTS.md must state: ${rule}`)
  }
})

test('the README points a new session at the mandatory development flow', () => {
  assert.ok(README.includes('AGENTS.md'), 'README must point at the repo AGENTS.md')
  assert.ok(README.includes('dev-flow'), 'README must name the dev-flow skill')
})

// ---------------------------------------------------------------------------
// Install path
//
// The 「装上」 snippet listed four of the five bundles the live profile links, and
// said nothing about `dsh.profile.bundles`. Copying it produced a profile that
// installed cleanly and loaded nothing — the worst failure mode, because every
// command exited 0. These tests take `packages/` as the only source of truth, so
// adding or retiring a bundle turns CI red instead of quietly rotting the prose.

/** Every package under packages/ that registers itself as a DSH bundle. */
function bundlePackages() {
  const dirs = packageDirs().map((name) => join(ROOT, 'packages', name))
  // dsh-websearch-failover is a repo root; the installable bundle is plugin/.
  dirs.push(join(ROOT, 'packages', 'dsh-websearch-failover', 'plugin'))

  const bundles = []
  for (const dir of dirs) {
    let manifest
    try {
      manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    } catch {
      continue
    }
    if (manifest.dsh?.bundle === undefined) continue
    bundles.push({ name: manifest.name, dir })
  }
  return bundles
}

/** name → link target, taken from the README's dependency snippet. */
function readmeLinkSpecs() {
  const blocks = [...README.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1])
  const snippet = blocks.find((block) => block.includes('"dependencies"'))
  assert.ok(snippet, 'README must carry a `"dependencies"` snippet for a new profile')

  const specs = new Map()
  for (const line of snippet.matchAll(/"([^"]+)"\s*:\s*"link:([^"]+)"/g)) {
    specs.set(line[1], line[2])
  }
  return specs
}

test('the README install snippet links every bundle the workspace carries', () => {
  const specs = readmeLinkSpecs()
  const missing = []
  for (const bundle of bundlePackages()) {
    const spec = specs.get(bundle.name)
    const expected = relative(ROOT, bundle.dir).split(sep).join('/')
    if (spec === undefined) missing.push(`${bundle.name} (no line at all)`)
    else if (!spec.split('\\').join('/').endsWith(expected)) {
      missing.push(`${bundle.name} (link:${spec} does not point at ${expected})`)
    }
  }
  assert.deepEqual(missing, [], `README install snippet is incomplete: ${missing.join('; ')}`)
})

test('the README says a dependency line alone does not load the bundle', () => {
  // The half that is easy to miss: `dsh.profile.bundles` decides what loads.
  assert.ok(README.includes('dsh.profile.bundles'), 'README must name `dsh.profile.bundles`')
  assert.ok(README.includes('不会加载'), 'README must warn that a missing bundles row does not load')
})

// ---------------------------------------------------------------------------
// Update docs
//
// docs/update-scheme.md and docs/update-checkout.md were written against a repo
// that no longer exists: eight bundles, two checkouts splitting the six links,
// the running commit on no tag, no CI. Reading them today sends a new session
// chasing a fault that was already repaired.

const UPDATE_DOCS = ['docs/update-scheme.md', 'docs/update-checkout.md']

test('the update docs do not describe the repository as it was before the repair', () => {
  for (const doc of UPDATE_DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8')
    const stale = text.match(/八个\s*bundle|8\s*个\s*bundle/g)
    assert.equal(
      stale,
      null,
      `${doc} still claims ${stale?.[0]} — packages/ holds ${packageDirs().length} bundles`,
    )
  }
})

test('each update doc carries a dated calibration block', () => {
  for (const doc of UPDATE_DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8')
    const block = text.match(/现状校准（\d{4}-\d{2}-\d{2},main @ [0-9a-f]{7}）/)
    assert.ok(
      block,
      `${doc} must open with 现状校准（YYYY-MM-DD,main @ <sha>） naming the commit it was checked against`,
    )
  }
})

test('the checkout doc no longer asks for approval of work that is done', () => {
  const text = readFileSync(join(ROOT, 'docs/update-checkout.md'), 'utf8')
  assert.equal(text.includes('状态:**待批准**'), false, 'update-checkout.md still reads as pending approval')
  assert.ok(
    text.includes('/root/DSH-plugins'),
    'update-checkout.md must say which checkout the profile loads now',
  )
})
