import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyItems, findPackageDir, resolveSpec, writePluginDependencies } from '../lib/sync-apply.js'

function scratch() {
  return mkdtempSync(join(tmpdir(), 'dsh-apply-'))
}

/** A profile directory with a package.json, as dsh actually stores it. */
function makeProfile(dependencies = {}) {
  const dir = scratch()
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'profile', dependencies }, null, 2))
  return dir
}

/** A plugin repository clone with packages/<name>/package.json. */
function makeRepo(packages) {
  const root = scratch()
  mkdirSync(join(root, 'packages'), { recursive: true })
  for (const [dir, name] of Object.entries(packages)) {
    mkdirSync(join(root, 'packages', dir), { recursive: true })
    writeFileSync(join(root, 'packages', dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
  }
  return root
}

test('resolveSpec points a repo-sourced plugin at the local clone', () => {
  const repoRoot = makeRepo({ 'dsh-ctx-guard': 'dsh-ctx-guard' })
  const result = resolveSpec({ kind: 'plugin', name: 'dsh-ctx-guard', source: 'repo' }, { repoRoot })
  assert.equal(result.spec.startsWith('link:'), true)
  assert.equal(result.spec.includes(join('packages', 'dsh-ctx-guard')), true)
})

test('resolveSpec fails per item when the local clone is absent', () => {
  const result = resolveSpec({ kind: 'plugin', name: 'x', source: 'repo' }, { repoRoot: null })
  assert.match(result.error, /没有找到插件仓库副本/)
})

test('resolveSpec uses the npm version, defaulting to latest', () => {
  assert.equal(resolveSpec({ kind: 'plugin', name: 'a', source: 'npm', version: '1.2.3' }).spec, '1.2.3')
  assert.equal(resolveSpec({ kind: 'plugin', name: 'a', source: 'npm' }).spec, 'latest')
})

test('resolveSpec passes a git spec through unchanged', () => {
  const spec = 'git+https://github.com/o/r.git'
  assert.equal(resolveSpec({ kind: 'plugin', name: 'a', source: 'git', spec }).spec, spec)
})

test('resolveSpec rejects non-plugins and unknown sources', () => {
  assert.match(resolveSpec({ kind: 'skill', name: 's' }).error, /不是插件/)
  assert.match(resolveSpec({ kind: 'plugin', name: 'a', source: 'weird' }).error, /来源无法解析/)
})

test('findPackageDir matches by package name, not directory name', () => {
  const root = makeRepo({ 'dsh-prompt-inject': '@local/dsh-prompt-inject' })
  const found = findPackageDir(root, '@local/dsh-prompt-inject')
  assert.ok(found)
  assert.equal(found.includes('dsh-prompt-inject'), true)
  assert.equal(findPackageDir(root, 'nope'), null)
})

test('findPackageDir finds a bundle nested one level deeper', () => {
  const root = scratch()
  mkdirSync(join(root, 'packages', 'dsh-websearch-failover', 'plugin'), { recursive: true })
  writeFileSync(
    join(root, 'packages', 'dsh-websearch-failover', 'plugin', 'package.json'),
    JSON.stringify({ name: 'dsh-websearch-failover' }),
  )
  const found = findPackageDir(root, 'dsh-websearch-failover')
  assert.equal(found.includes('plugin'), true)
})

test('writePluginDependencies only rewrites what actually changed', () => {
  const dir = makeProfile({ a: '1.0.0' })
  const result = writePluginDependencies(dir, [
    { entry: { name: 'a' }, spec: '1.0.0' },
    { entry: { name: 'b' }, spec: 'link:E:/x' },
  ])
  assert.deepEqual(result.changed, ['b'])
  const written = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.equal(written.dependencies.a, '1.0.0')
  assert.equal(written.dependencies.b, 'link:E:/x')
})

test('writePluginDependencies leaves the file alone when nothing changed', () => {
  const dir = makeProfile({ a: '1.0.0' })
  const before = readFileSync(join(dir, 'package.json'), 'utf8')
  const result = writePluginDependencies(dir, [{ entry: { name: 'a' }, spec: '1.0.0' }])
  assert.deepEqual(result.changed, [])
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before)
})

test('applyItems reports per-item failures without aborting the batch', async () => {
  const profileDir = makeProfile()
  const repoRoot = makeRepo({ 'dsh-ctx-guard': 'dsh-ctx-guard' })
  const result = await applyItems(
    [
      { kind: 'plugin', name: 'dsh-ctx-guard', source: 'repo' },
      { kind: 'plugin', name: 'ghost', source: 'repo' },
    ],
    { profileDir, repoRoot, pnpmBin: 'definitely-not-pnpm' },
  )
  const byKey = new Map(result.results.map((r) => [r.key, r]))
  // The ghost never reached pnpm: it failed at spec resolution.
  assert.match(byKey.get('plugin:ghost').error, /插件仓库里没有 ghost/)
  // The real one reached pnpm, which is missing here.
  assert.match(byKey.get('plugin:dsh-ctx-guard').error, /pnpm install 失败/)
  assert.equal(result.failed, 2)
})

test('applyItems writes dependencies before attempting install', async () => {
  const profileDir = makeProfile()
  const repoRoot = makeRepo({ 'dsh-ctx-guard': 'dsh-ctx-guard' })
  await applyItems([{ kind: 'plugin', name: 'dsh-ctx-guard', source: 'repo' }], {
    profileDir,
    repoRoot,
    pnpmBin: 'definitely-not-pnpm',
  })
  // The declaration survives even though the install failed.
  const written = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  assert.equal(written.dependencies['dsh-ctx-guard'].startsWith('link:'), true)
})

test('applyItems rejects an unusable profile directory', async () => {
  const result = await applyItems([], { profileDir: '/nonexistent-profile' })
  assert.equal(result.ok, false)
  assert.match(result.error, /找不到 profile 目录/)
})

test('applyItems refuses mcp entries instead of pretending to install them', async () => {
  const result = await applyItems([{ kind: 'mcp', name: 'context7' }], { profileDir: makeProfile() })
  assert.match(result.results[0].error, /暂不支持自动安装/)
})

test('applyItems refuses traversal / absolute / nested skill names with no files written', async () => {
  const profileDir = makeProfile()
  const workdir = scratch()
  const result = await applyItems(
    [
      { kind: 'skill', name: '../../evil' },
      { kind: 'skill', name: 'C:/evil' },
      { kind: 'skill', name: 'a/b' },
      { kind: 'skill', name: 'UPPER' },
    ],
    { profileDir, vaultDir: workdir, repoRoot: workdir },
  )
  const byKey = new Map(result.results.map((r) => [r.key, r]))
  for (const name of ['../../evil', 'C:/evil', 'a/b', 'UPPER']) {
    assert.match(byKey.get(`skill:${name}`).error, /非法技能名/)
  }
  assert.equal(result.failed, 4)
  assert.equal(result.applied, 0)
  // Nothing escaped anywhere: the scratch dir stays empty.
  assert.deepEqual(readdirSync(workdir), [])
  // package.json untouched too (skills never touch it, but guard anyway).
  assert.deepEqual(JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')).dependencies, {})
})
