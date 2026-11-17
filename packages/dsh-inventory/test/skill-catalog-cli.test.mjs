import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isSkillDisabled } from '../lib/skill-toggle.js'

const BIN = new URL('../bin/skill-catalog.mjs', import.meta.url).pathname
const scratch = []
after(() => {
  for (const dir of scratch) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows may still hold a handle; a temp leftover is harmless.
    }
  }
})

function rootWith(names) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-skill-catalog-cli-'))
  scratch.push(root)
  for (const name of names) {
    mkdirSync(join(root, name), { recursive: true })
    writeFileSync(
      join(root, name, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${name} does a thing.\n---\n\nBody of ${name}.\n`,
      'utf8',
    )
  }
  return root
}

function runCli(args) {
  const result = spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

function visible(root, name) {
  return !isSkillDisabled(readFileSync(join(root, name, 'SKILL.md'), 'utf8'))
}

test('the CLI hides every unkept skill and reports a machine-readable summary', () => {
  const root = rootWith(['alpha', 'beta', 'gamma'])
  const run = runCli(['--root', root, '--keep', 'alpha', '--json'])

  assert.equal(run.status, 0)
  const summary = JSON.parse(run.stdout)
  assert.equal(summary.scanned, 3)
  assert.deepEqual(summary.marked.sort(), ['beta', 'gamma'])
  assert.equal(summary.visibleAfter, 1)
  assert.equal(visible(root, 'alpha'), true)
  assert.equal(visible(root, 'beta'), false)
})

test('an unmatched keep name exits 2 and names it', () => {
  const root = rootWith(['alpha', 'beta'])
  const run = runCli(['--root', root, '--keep', 'alpha,typo', '--dry-run', '--json'])

  assert.equal(run.status, 2)
  assert.deepEqual(JSON.parse(run.stdout).unknown, ['typo'])
  assert.equal(visible(root, 'beta'), true)
})

test('a keep file carries the same list as --keep', () => {
  const root = rootWith(['alpha', 'beta', 'gamma'])
  const file = join(root, 'keep.txt')
  writeFileSync(file, '# keep these\nalpha\ngamma\n', 'utf8')

  const run = runCli(['--root', root, '--keep-file', file, '--json'])

  assert.equal(run.status, 0)
  assert.deepEqual(JSON.parse(run.stdout).marked, ['beta'])
})

test('--restore puts every skill back in the model catalog', () => {
  const root = rootWith(['alpha', 'beta', 'gamma'])
  runCli(['--root', root, '--keep', 'alpha'])
  const restored = runCli(['--root', root, '--restore', '--json'])

  assert.equal(restored.status, 0)
  assert.equal(JSON.parse(restored.stdout).unmarked.length, 2)
  for (const name of ['alpha', 'beta', 'gamma']) assert.equal(visible(root, name), true)
})

test('a missing root and a missing selection both fail with exit 1', () => {
  const missing = join(tmpdir(), 'dsh-skill-root-that-does-not-exist')
  assert.equal(runCli(['--root', missing, '--keep', 'alpha']).status, 1)
  assert.equal(runCli(['--keep', 'alpha', '--restore']).status, 1)
})
