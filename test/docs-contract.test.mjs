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
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
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

/**
 * Everything the README's json snippets say: `link:` specs and bundles rows.
 *
 * Read as a union of all snippets, not just the first one — the install path is
 * split into a required block and an optional block, and both count.
 */
function readmeSnippets() {
  const blocks = [...README.matchAll(/```json\n([\s\S]*?)```/g)].map((match) => match[1])
  const links = new Map()
  const bundles = new Set()

  for (const block of blocks) {
    for (const match of block.matchAll(/"([^"]+)"\s*:\s*"link:([^"]+)"/g)) {
      links.set(match[1], match[2])
    }
    // Every array in every block: a second one must not be silently ignored.
    for (const array of block.matchAll(/"bundles"\s*:\s*\[([\s\S]*?)\]/g)) {
      for (const match of array[1].matchAll(/"([^"]+)"/g)) bundles.add(match[1])
    }
  }

  return { links, bundles }
}

test('the README names every bundle and gives its path', () => {
  // Every bundle must be discoverable by name *and* with the directory it is
  // linked from. Deliberately not "must appear as a `link:` line in a json
  // block": the Windows-only bundle reads better in prose, and forcing a format
  // makes a correct edit fail.
  const missing = []
  for (const bundle of bundlePackages()) {
    const expected = relative(ROOT, bundle.dir).split(sep).join('/')
    if (!README.includes(bundle.name)) missing.push(`${bundle.name} (name never mentioned)`)
    if (!README.includes(expected)) missing.push(`${bundle.name} (path ${expected} never given)`)
  }
  assert.deepEqual(missing, [], `README does not document every bundle: ${missing.join('; ')}`)
})

test('the README bundles list and its link list agree', () => {
  // Listing a package in `dependencies` installs the files; only the bundles row
  // loads it. Both directions are checked, because the failure this issue is
  // about has two sides: a link nobody loads (silently inert) and a retired name
  // that survives in the bundles list (silently skipped at startup).
  const { links, bundles } = readmeSnippets()
  assert.ok(bundles.size > 0, 'README must carry a `dsh.profile.bundles` snippet')

  const unlisted = [...links.keys()].filter((name) => !bundles.has(name))
  assert.deepEqual(unlisted, [], `README links but never loads: ${unlisted.join(', ')}`)

  const known = new Set(bundlePackages().map((bundle) => bundle.name))
  const phantom = [...bundles].filter((name) => !known.has(name))
  assert.deepEqual(phantom, [], `README loads names packages/ does not carry: ${phantom.join(', ')}`)
})

test('the README says a dependency line alone does not load the bundle', () => {
  assert.ok(README.includes('dsh.profile.bundles'), 'README must name `dsh.profile.bundles`')
  assert.ok(README.includes('不会加载'), 'README must warn that a missing bundles row does not load')
})

// ---------------------------------------------------------------------------
// Update docs
//
// docs/update-scheme.md and docs/update-checkout.md were written against a repo
// that no longer exists: eight bundles, two checkouts splitting the six links,
// the running commit on no tag, no CI. Reading them today sends a new session
// chasing a fault that was already repaired. Historical sentences are allowed to
// stay (they are the record of that survey); what must not drift is the line that
// claims what the repository holds *now*.

const UPDATE_DOCS = ['docs/update-scheme.md', 'docs/update-checkout.md']

test('the update docs do not state the pre-repair bundle count as current', () => {
  // These docs are the record of an eight-bundle survey, so the old number is
  // allowed to appear — but only on a line that says it is history. A bare
  // "8 个包(bundle)" reads as today's fact and is how the first pass slipped by.
  const stale = /(?:八|8)\s*个\s*(?:bundle|包)/
  for (const doc of UPDATE_DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8')
    const offenders = text
      .split('\n')
      .filter((line) => stale.test(line) && !line.includes('当时'))
    assert.deepEqual(
      offenders,
      [],
      `${doc} states ${offenders.join(' / ')} as current — packages/ holds ${packageDirs().length} bundles`,
    )
  }
})

test('the update scheme states the bundle count that packages/ actually holds', () => {
  const text = readFileSync(join(ROOT, 'docs/update-scheme.md'), 'utf8')
  const scope = text.match(/(?:范围|覆盖)[：:][^\n]*?(\d+)\s*个\s*(?:bundle|包)/)
  assert.ok(scope, 'docs/update-scheme.md must state the scope and how many bundles it covers')
  assert.equal(
    Number(scope[1]),
    packageDirs().length,
    `docs/update-scheme.md says ${scope[1]} bundles but packages/ holds ${packageDirs().length}`,
  )
})

test('each update doc carries a dated calibration block naming a real commit', () => {
  // A calibration block whose only property is "matches a regex" is worthless:
  // `2030-13-45,main @ deadbee` proves nothing was ever checked. The date must
  // parse and the sha must resolve to a commit in this repository.
  for (const doc of UPDATE_DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8')
    const block = text.match(/现状校准[（(](\d{4}-\d{2}-\d{2}),main @ ([0-9a-f]{7})[）)]/)
    assert.ok(
      block,
      `${doc} must open with 现状校准（YYYY-MM-DD,main @ <sha>） naming the commit it was checked against`,
    )
    const [, date, sha] = block
    assert.equal(Number.isNaN(Date.parse(date)), false, `${doc}: ${date} is not a real date`)
    // A shallow clone (some CI checkouts, `--depth 1`) genuinely cannot tell
    // whether the sha exists; skipping beats failing for the wrong reason. CI
    // fetches full history (ci.yml: fetch-depth 0), so the check runs there.
    const shallow = spawnSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: ROOT })
    if (shallow.stdout?.toString().trim() === 'true') continue
    const resolved = spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { cwd: ROOT })
    assert.equal(resolved.status, 0, `${doc}: ${sha} is not a commit in this repository`)
  }
})

test('the checkout doc no longer asks for approval of work that is done', () => {
  const text = readFileSync(join(ROOT, 'docs/update-checkout.md'), 'utf8')
  // Full-width colons are the house style in half these docs, so a half-width
  // literal is not a guard — it is a spelling test.
  assert.equal(/状态[：:]\s*\*\*待批准\*\*/.test(text), false, 'update-checkout.md still reads as pending approval')
  assert.ok(/状态[：:]\s*\*\*已执行完成/.test(text), 'update-checkout.md must say the work is done')
  assert.ok(
    text.includes('/root/DSH-plugins'),
    'update-checkout.md must say which checkout the profile loads now',
  )
})

test('the checkout doc does not state an old link count as current', () => {
  // The calibration block says five; the body still said six in three places.
  for (const doc of UPDATE_DOCS) {
    const text = readFileSync(join(ROOT, doc), 'utf8')
    const offenders = text
      .split('\n')
      .filter((line) => /(?:6|六)\s*个[^\n]{0,14}?(?:link|包|插件)/.test(line) && !line.includes('当时'))
    assert.deepEqual(offenders, [], `${doc} states an old link count as current: ${offenders.join(' / ')}`)
  }
})

test('the README root-bundle warning matches the packages actually present', () => {
  // AGENTS.md gets this ordinal pinned; the same sentence in the README was left
  // at "sixth" while the workspace grew to seven bundles.
  const ordinal = README.match(/否则它会变成第([一二三四五六七八九十]+)个 bundle/)
  assert.ok(ordinal, 'README must warn about the root becoming a bundle')
  assert.equal(
    ordinal[1],
    CN_DIGITS[packageDirs().length + 1],
    `README says the root would become bundle ${ordinal[1]}, expected ${packageDirs().length + 1}`,
  )
})

// ---------------------------------------------------------------------------
// P1-6 (lockfile drift)
//
// The one thing the docs promised to keep honest was "P1-6 is still not fixed".
// Flipping that line to ✅ left all contracts green, and the follow-up ticket it
// referred to did not exist. Both are now checked against the lockfile itself.

/** Workspace importers the lockfile declares vs. the packages that exist. */
function lockfileDrift() {
  const lock = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const section = lock.slice(lock.indexOf('importers:'))
  const declared = new Set([...section.matchAll(/^ {2}(packages\/[^:\n]+):/gm)].map((match) => match[1]))
  const expected = packageDirs().map((name) => `packages/${name}`)
  return {
    declared,
    missing: expected.filter((entry) => !declared.has(entry)),
    phantom: [...declared].filter((entry) => !expected.includes(entry)),
  }
}

test('the update scheme keeps P1-6 open while the lockfile is still drifted', () => {
  const { missing, phantom } = lockfileDrift()
  const drifted = missing.length > 0 || phantom.length > 0
  const text = readFileSync(join(ROOT, 'docs/update-scheme.md'), 'utf8')
  const lines = text.split('\n').filter((line) => line.includes('P1-6'))
  assert.ok(lines.length > 0, 'docs/update-scheme.md must mention P1-6')

  for (const line of lines) {
    if (drifted) {
      assert.ok(
        line.includes('仍未修'),
        `pnpm-lock.yaml is still drifted (missing: ${missing.join(', ') || '-'}; phantom: ${phantom.join(', ') || '-'}) but this line does not say 仍未修: ${line}`,
      )
    }
  }
})

test('the P1-6 lines point at a ticket that exists', () => {
  // "已另开工单" with no number is unfalsifiable: the reader cannot tell whether
  // anyone is following up. The ticket is #39; the docs must name it.
  const text = readFileSync(join(ROOT, 'docs/update-scheme.md'), 'utf8')
  const lines = text.split('\n').filter((line) => line.includes('P1-6') && line.includes('仍未修'))
  assert.ok(lines.length > 0, 'docs/update-scheme.md must state that P1-6 is still open')
  for (const line of lines) {
    assert.ok(/#\d+/.test(line), `P1-6 line must cite the follow-up issue number: ${line}`)
  }
})

test('the spec that deferred work points at the issue that owns it', () => {
  const spec = readFileSync(join(ROOT, 'docs/specs/docs-drift.md'), 'utf8')
  assert.ok(/#\d+/.test(spec), 'docs/specs/docs-drift.md must name the follow-up issue it deferred work to')
  assert.equal(spec.includes('待确认'), false, 'docs/specs/docs-drift.md still reads as awaiting approval')
})

test('the docs cite a CI workflow that exists', () => {
  // P1-10 is "there is no CI"; `pnpm verify` never looks at .github/workflows, so
  // citing it as evidence for that line proved nothing.
  const text = readFileSync(join(ROOT, 'docs/update-scheme.md'), 'utf8')
  const line = text.split('\n').find((entry) => entry.includes('P1-10'))
  assert.ok(line, 'docs/update-scheme.md must mention P1-10')
  assert.ok(
    /\.github\/workflows|gh pr checks/.test(line),
    `P1-10's evidence must name the CI workflow, not just pnpm verify: ${line}`,
  )
  assert.ok(existsSync(join(ROOT, '.github/workflows/ci.yml')), 'the CI workflow the docs cite must exist')
})
