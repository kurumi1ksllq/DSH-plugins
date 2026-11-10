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
  assert.ok(README.includes('dev-flow'), 'README must name the dev-flow flow')
  // #154 turned the rules into an always-on contract: the entry document no
  // longer tells a new session to "call the skill", and it must not link the
  // rule file that stopped existing.
  assert.ok(README.includes('packages/dev-flow/FLOW.md'), 'README must link the packaged procedure')
  assert.equal(README.includes('packages/dev-flow/SKILL.md'), false, 'README must not link the retired SKILL.md')
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

// The one bundle a new machine may legitimately skip: it replaces the shell with
// Git Bash and there is no point installing it off Windows. Everything else must
// appear as a real `link:` line — a name and a path in prose is not an install.
const WINDOWS_ONLY = new Set(['dsh-git-bash-tool'])

test('the README links every bundle a new machine needs', () => {
  const { links } = readmeSnippets()
  assert.ok(links.size > 0, 'README must carry a `"dependencies"` snippet with `link:` lines')

  const required = bundlePackages().filter((bundle) => !WINDOWS_ONLY.has(bundle.name))
  const missing = []
  for (const bundle of required) {
    const spec = links.get(bundle.name)
    const expected = relative(ROOT, bundle.dir).split(sep).join('/')
    if (spec === undefined) missing.push(`${bundle.name} (no link: line)`)
    else if (!spec.split('\\').join('/').endsWith(expected)) {
      missing.push(`${bundle.name} (link:${spec} does not point at ${expected})`)
    }
  }
  assert.deepEqual(missing, [], `README install snippet is incomplete: ${missing.join('; ')}`)
  assert.ok(
    links.size >= required.length,
    `README links ${links.size} bundle(s); a new machine needs ${required.length}`,
  )
})

test('the README names every bundle and gives its path, whatever the format', () => {
  // Format is free (json snippet, table, prose) — being undocumented is not.
  const missing = []
  for (const bundle of bundlePackages()) {
    const expected = relative(ROOT, bundle.dir).split(sep).join('/')
    if (!README.includes(bundle.name)) missing.push(`${bundle.name} (name never mentioned)`)
    if (!README.includes(expected)) missing.push(`${bundle.name} (path ${expected} never given)`)
  }
  assert.deepEqual(missing, [], `README does not document every bundle: ${missing.join('; ')}`)
})

test('the README link-section count matches the packages actually present', () => {
  // The install snippet's "共 N 个 bundle" sentence drifted to "five" while the
  // workspace grew (issue-153 axis-2 finding); it sits next to the link list it
  // introduces and must agree with packages/. Both numeral styles accepted.
  const arabic = README.match(/本仓库共 (\d+) 个 bundle/)
  const chinese = README.match(/本仓库共 ([一二三四五六七八九十]+) 个 bundle/)
  const claimed = arabic ? Number(arabic[1]) : chinese ? CN_DIGITS.indexOf(chinese[1]) + 1 : null
  assert.ok(claimed, 'README must state how many bundles the install snippet covers')
  assert.equal(
    claimed,
    packageDirs().length,
    `README says ${claimed} bundles in the link section, expected ${packageDirs().length}`,
  )
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
    const block = text.match(/现状校准[（(](\d{4}-\d{2}-\d{2}),main @ ([0-9a-f]{7,40})[）)]/)
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
    const ancestor = spawnSync('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], { cwd: ROOT })
    assert.equal(ancestor.status, 0, `${doc}: ${sha} is not an ancestor of HEAD`)
    // The block claims "checked against this commit on this date": a date before
    // the commit or far in the future is a claim nobody could have made.
    const committed = spawnSync('git', ['show', '-s', '--format=%cs', sha], { cwd: ROOT })
    const commitDate = committed.stdout?.toString().trim()
    assert.ok(commitDate, `${doc}: cannot read the commit date of ${sha}`)
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    assert.ok(date >= commitDate, `${doc}: ${date} predates commit ${sha} (${commitDate})`)
    assert.ok(date <= tomorrow, `${doc}: ${date} is in the future`)
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
    // 「6 包」 without the 个 was the one that survived the first pass.
    const offenders = text
      .split('\n')
      .filter((line) => /(?:6|六)\s*个?[^\n]{0,14}?(?:link|包|插件)/.test(line) && !/当时|历史上/.test(line))
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

test('the root package.json description states the bundle count actually present', () => {
  // The root description drifted to "eight" while nothing pinned it (issue-151
  // axis-2 review finding); README/AGENTS/CHANGELOG get ordinals elsewhere.
  const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  const words = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' }
  const claimed = (manifest.description ?? '').match(/([a-z]+) independently installable/)
  assert.ok(claimed, 'root package.json description must state the bundle count')
  assert.equal(
    claimed[1],
    words[packageDirs().length],
    `root description says ${claimed[1]} bundles, expected ${words[packageDirs().length]}`,
  )
})

// ---------------------------------------------------------------------------
// P1-6 (lockfile drift)
//
// The one thing the docs promised to keep honest was "P1-6 is still not fixed".
// Flipping that line to ✅ left all contracts green, and the ticket it referred to
// did not exist. A status line is now checked against the lockfile in both
// directions, and it must name the issue that owns the work.

/**
 * Which revision's lockfile the contract is about.
 *
 * On a GitHub `pull_request` checkout HEAD is the *merge* commit, so `HEAD:` is
 * base+PR — a PR that never touches the lockfile would be judged on whatever main
 * did to it. When HEAD is a merge, use its second parent (the PR head); otherwise
 * the commit itself. Reported in every failure so the reader knows what was read.
 */
function lockfileRev() {
  const parents = spawnSync('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], { cwd: ROOT })
  assert.equal(parents.status, 0, 'docs-contract needs a git checkout (git rev-list failed)')
  const fields = parents.stdout.toString().trim().split(/\s+/)
  return fields.length > 2 ? 'HEAD^2' : 'HEAD'
}

/** The lockfile at `rev`, from git — never the working copy, which `pnpm install` rewrites. */
function committedLockfile(rev) {
  const blob = spawnSync('git', ['show', `${rev}:pnpm-lock.yaml`], { cwd: ROOT })
  assert.equal(blob.status, 0, `docs-contract needs pnpm-lock.yaml in ${rev}`)
  assert.ok(blob.stdout.length > 0, `pnpm-lock.yaml at ${rev} is empty`)
  return blob.stdout.toString()
}

/** Workspace importers the lockfile at `rev` declares vs. the packages that exist. */
function lockfileDrift(rev = lockfileRev()) {
  const lock = committedLockfile(rev)
  const at = lock.indexOf('importers:')
  // A parser that cannot find its section would report "everything missing" and
  // then happily agree with a "仍未修" line: blind must be loud.
  assert.ok(at > -1, `pnpm-lock.yaml at ${rev} has no importers: section`)
  const declared = new Set([...lock.slice(at).matchAll(/^ {2}(packages\/[^:\n]+):/gm)].map((match) => match[1]))
  assert.ok(declared.size > 0, `pnpm-lock.yaml at ${rev} declares no workspace importers`)
  const expected = packageDirs().map((name) => `packages/${name}`)
  return {
    rev,
    declared,
    missing: expected.filter((entry) => !declared.has(entry)),
    phantom: [...declared].filter((entry) => !expected.includes(entry)),
  }
}

/** Lines that talk about P1-6, matched on `P1-6` and the easier-to-miss `P1.6`. */
function p16Lines(text) {
  return text.split('\n').filter((line) => /P1[-.]6/.test(line))
}

test('every P1-6 line states a status the lockfile can be checked against', () => {
  // Leaving a P1-6 line without a marker made it invisible: a second, contradicting
  // line could be added next to the correct one and the docs still passed.
  const lines = p16Lines(readFileSync(join(ROOT, 'docs/update-scheme.md'), 'utf8'))
  assert.ok(lines.length > 0, 'docs/update-scheme.md must state the P1-6 status')
  const bare = lines.filter((line) => !/(⬜|✅|仍未修|已修)/.test(line))
  assert.deepEqual(bare, [], `P1-6 lines must state 仍未修/已修 explicitly: ${bare.join(' / ')}`)
})

test('the update scheme keeps P1-6 in step with the committed pnpm-lock.yaml', () => {
  const { rev, missing, phantom } = lockfileDrift()
  const drifted = missing.length > 0 || phantom.length > 0
  const detail = `pnpm-lock.yaml@${rev}: missing ${missing.join(', ') || '-'}; unexpected ${phantom.join(', ') || '-'}`

  // Locally, a lockfile edited but not committed means the doc and the file are
  // being read at two different states — say that instead of reporting a drift
  // nobody can see. On CI the working copy is rewritten by `pnpm install`, so this
  // check is local-only: the workflow's own `git diff --exit-code` step (asserted by
  // its own contract) is what catches an install that changes the lockfile.
  const working = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const committed = committedLockfile(rev)
  if (process.env.CI === undefined && working !== committed) {
    const diff = spawnSync('git', ['status', '--porcelain', '--', 'pnpm-lock.yaml'], { cwd: ROOT })
    assert.equal(
      diff.stdout.toString().trim(),
      '',
      `pnpm-lock.yaml differs from ${rev} but is not committed — commit it, the P1-6 contract reads ${rev}`,
    )
  }

  const lines = p16Lines(readFileSync(join(ROOT, 'docs/update-scheme.md'), 'utf8'))
  for (const line of lines) {
    if (drifted) {
      assert.ok(line.includes('仍未修'), `${detail} — but this line does not say 仍未修: ${line}`)
      assert.ok(/#\d+/.test(line), `P1-6 line must cite the follow-up issue number: ${line}`)
    } else {
      // The other direction: once the lockfile is fixed, leaving "仍未修" behind is
      // the same lie in reverse.
      assert.ok(line.includes('已修'), `${detail} is clean — but this line does not say 已修: ${line}`)
      assert.equal(line.includes('仍未修'), false, `${detail} is clean — but this line still says 仍未修: ${line}`)
    }
  }
})

test('while P1-6 is open, the follow-up ticket exists and both docs name it', () => {
  const { missing, phantom } = lockfileDrift()
  if (missing.length === 0 && phantom.length === 0) return // nothing deferred, nothing to cite

  const scheme = readFileSync(join(ROOT, 'docs/update-scheme.md'), 'utf8')
  const cited = new Set(
    p16Lines(scheme)
      .flatMap((line) => [...line.matchAll(/#(\d+)/g)])
      .map((match) => match[1]),
  )
  assert.ok(cited.size > 0, 'P1-6 out of step: cite the issue that owns the fix')
  const [ticket] = [...cited]

  const drift = readFileSync(join(ROOT, 'docs/specs/docs-drift.md'), 'utf8')
  const deferred = drift.match(/(?:拆成独立 chore issue|不做)[^\n]*?#(\d+)/)
  assert.ok(deferred, 'docs/specs/docs-drift.md must name the issue it deferred work to, on the deferral line')
  assert.equal(deferred[1], ticket, `docs/specs/docs-drift.md defers to #${deferred[1]}, but P1-6 cites #${ticket}`)

  const specs = readdirSync(join(ROOT, 'docs/specs')).filter((name) => name.startsWith(`issue-${ticket}-`))
  assert.ok(specs.length > 0, `#${ticket} has no spec under docs/specs/ (expected issue-${ticket}-*.md)`)
})

test('every P1-10 line cites evidence that covers the claim', () => {
  // P1-10 is "there is no CI" and `pnpm verify` never looks at .github/workflows,
  // so citing it proved nothing. Every line, not just the first one found.
  const text = readFileSync(join(ROOT, 'docs/update-scheme.md'), 'utf8')
  const lines = text.split('\n').filter((line) => line.includes('P1-10'))
  assert.ok(lines.length > 0, 'docs/update-scheme.md must mention P1-10')
  const bad = lines.filter((line) => !/\.github|gh pr checks/.test(line))
  assert.deepEqual(bad, [], `P1-10 evidence must name the CI workflow: ${bad.join(' / ')}`)
  assert.ok(existsSync(join(ROOT, '.github/workflows/ci.yml')), 'the CI workflow the docs cite must exist')
})

test('CI compares the lockfile after install, in a way that can fail', () => {
  // `pnpm install --frozen-lockfile` exits 0 *and* rewrites pnpm-lock.yaml when
  // its importers are out of step, which is how the P1-6 drift survived. Matching
  // the workflow text with a loose regex would pass on a commented-out step, on a
  // guard placed *before* install, or on `|| true` — so read the steps in order.
  const ci = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')
  const steps = [...ci.matchAll(/^\s*-\s+name:\s*(.+)\n\s+run:\s*(.+)$/gm)].map((match) => ({
    name: match[1].trim(),
    run: match[2].trim(),
  }))

  const installAt = steps.findIndex((step) => step.name === 'Install')
  const guardAt = steps.findIndex((step) => /git diff --exit-code/.test(step.run))
  assert.ok(installAt >= 0, 'ci.yml must run pnpm install')
  assert.ok(guardAt >= 0, 'ci.yml must compare pnpm-lock.yaml')
  assert.ok(guardAt > installAt, 'the comparison must run after install, or it can never fail')

  const guard = steps[guardAt].run
  assert.match(guard, /^git diff --exit-code (?:-- )?pnpm-lock\.yaml$/, `unexpected guard command: ${guard}`)

  // A guard that cannot fail is not a guard: `continue-on-error: true` and
  // `if: false` both leave the command text intact while neutering it, and the
  // step-order check above cannot see them.
  const block = ci.slice(ci.indexOf('- name:', ci.indexOf(steps[guardAt].name) - 200))
  const guardBlock = block.slice(0, block.indexOf('- name:', 1))
  const neutered = guardBlock.split('\n').filter((line) => /continue-on-error|^\s+if:/.test(line))
  assert.deepEqual(neutered, [], `the lockfile guard must be able to fail: ${neutered.join(' / ')}`)
})

test('the CHANGELOG header states the bundle count packages/ actually holds', () => {
  // The header drifted to "eight" while the workspace held seven, and nothing
  // covered CHANGELOG at all.
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const words = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine' }
  const claimed = changelog.match(/One repository, ([a-z]+) independently versioned bundles/)
  assert.ok(claimed, 'CHANGELOG must state how many bundles the repository holds')
  assert.equal(
    claimed[1],
    words[packageDirs().length],
    `CHANGELOG says ${claimed[1]} bundles but packages/ holds ${packageDirs().length}`,
  )
})



// ---------------------------------------------------------------------------
// Version discipline (docs maintenance, #147)
//
// #144 merged two version bumps (dsh-deep-ptc-mode 1.11.2, dev-flow 0.5.0) whose
// CHANGELOG entries were never written. packages/ is the only source of truth:
// every current bundle version must carry a `### <name> <version>` entry heading
// inside the FIRST `## Unreleased` section. Whole-file matching would stay green
// once an entry is archived out of Unreleased (dual-axis review finding), so the
// scope and the heading format are checked on purpose; the archival pass must
// update this test together with the section it moves entries into.

/** The FIRST `## Unreleased` section of the CHANGELOG, up to the next `## ` heading. */
function unreleasedSection(changelog) {
  const start = changelog.indexOf('## Unreleased')
  assert.ok(start > -1, 'CHANGELOG must carry an `## Unreleased` section')
  const next = changelog.indexOf('\n## ', start + 1)
  return changelog.slice(start, next === -1 ? changelog.length : next)
}

test('the CHANGELOG Unreleased section carries every current package version as an entry', () => {
  const unreleased = unreleasedSection(readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8'))
  const missing = []
  for (const dir of packageDirs()) {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'))
    const heading = new RegExp(`^### ${pkg.name} ${pkg.version.replace(/\\./g, '\\.')}(?![\\w.])`, 'm')
    if (!heading.test(unreleased)) missing.push(`${pkg.name} ${pkg.version}`)
  }
  assert.deepEqual(
    missing,
    [],
    `CHANGELOG Unreleased must state every current package version as an entry: ${missing.join('; ')}`,
  )
})


// ---------------------------------------------------------------------------
// Single Unreleased section (docs round-2, #149)
//
// The CHANGELOG once grew a second `## Unreleased` heading (a #96-#105-and-earlier
// batch that was never archived), so readers cannot tell which section is
// authoritative and entries got duplicated across the two. There must be exactly
// one, anchored to the exact heading line (a suffixed variant like
// `## Unreleased (legacy)` counts as a drift and goes red via the count check).

test('the CHANGELOG carries exactly one Unreleased section', () => {
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  // Anchored with $ so the guard and unreleasedSection() agree on what a
  // section heading is; a suffixed variant fails the count assertion below.
  const headings = changelog.split('\n').filter((line) => /^## Unreleased$/.test(line))
  assert.equal(
    headings.length,
    1,
    `CHANGELOG must carry exactly one ## Unreleased section, found ${headings.length}`,
  )
})

test('no CHANGELOG entry heading appears more than once', () => {
  // The defect that motivated #149's second section was entry-level duplication
  // (0.1.1 and 0.3.1 existed under both Unreleased sections), which the
  // section-count guard above cannot see. Every `### ` heading line must be
  // unique across the whole file.
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const seen = new Map()
  for (const line of changelog.split('\n')) {
    if (/^### /.test(line)) seen.set(line, (seen.get(line) || 0) + 1)
  }
  const duplicates = [...seen.entries()].filter(([, count]) => count >= 2).map(([line]) => line)
  assert.deepEqual(
    duplicates,
    [],
    `duplicate ### entry headings across the CHANGELOG: ${duplicates.join(' | ')}`,
  )
})
