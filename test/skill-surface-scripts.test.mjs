import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const WIRE = join(REPO, 'scripts', 'skill-surface-wire.sh')
const ROLLBACK = join(REPO, 'scripts', 'skill-surface-rollback.sh')

function profile({ bundles = ['dsh-base'], extraDeps = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-profile-'))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'tmp-profile',
    dependencies: { ...extraDeps },
    dsh: { profile: { bundles } },
  }, null, 2) + '\n')
  return dir
}

function seeded(dir) {
  const doc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  doc.dependencies['dsh-skill-surface'] = 'link:/nowhere'
  doc.dsh.profile.bundles.push('dsh-skill-surface')
  writeFileSync(join(dir, 'package.json'), JSON.stringify(doc, null, 2) + '\n')
}

function run(script, args, env = {}) {
  try {
    const stdout = execFileSync('bash', [script, ...args], { encoding: 'utf8', env: { ...process.env, DSH_HOME: '', ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    return { code: 0, stdout }
  } catch (error) {
    return { code: error.status ?? 1, stdout: String(error.stdout ?? '') + String(error.stderr ?? '') }
  }
}

test('C1: --dry-run plans without touching the manifest', () => {
  const dir = profile()
  const before = readFileSync(join(dir, 'package.json'), 'utf8')
  const result = run(WIRE, ['--dry-run', '--profile', dir])
  assert.equal(result.code, 0, result.stdout)
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before, 'dry-run must not write')
  assert.match(result.stdout, /would add dependency dsh-skill-surface/)
})

test('C1b: --dry-run tells the truth once the profile is already wired', () => {
  const dir = profile()
  seeded(dir)
  writeFileSync(join(dir, 'package.json.no-skill-surface.bak'), '{}')
  const result = run(WIRE, ['--dry-run', '--profile', dir])
  assert.match(result.stdout, /already wired/, 'must not claim it would append again')
  assert.doesNotMatch(result.stdout, /would add dependency/)
})

test('C2: systemctl is never called without --restart', () => {
  const dir = profile()
  const marker = join(dir, 'systemctl-called')
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'systemctl'), '#!/bin/sh\necho "$@" >> ' + JSON.stringify(marker) + '\nexit 0\n')
  chmodSync(join(bin, 'systemctl'), 0o755)
  const env = { PATH: bin + ':' + process.env.PATH }
  run(WIRE, ['--dry-run', '--profile', dir, '--restart'], env)
  assert.throws(() => readFileSync(marker), 'a dry-run must not restart even with --restart')
})

test('C3: a baseline that is not a profile manifest is refused', () => {
  const dir = profile()
  const bogus = join(dir, 'bogus.json')
  writeFileSync(bogus, JSON.stringify({ hello: 'world' }))
  const result = run(ROLLBACK, ['--dry-run', '--baseline', bogus, '--profile', dir])
  assert.equal(result.code, 1, result.stdout)
  assert.match(result.stdout, /not a DSH profile manifest/)
})

test('C4: an already-wired profile is never captured as the rollback baseline', () => {
  const dir = profile()
  seeded(dir)
  const result = run(WIRE, ['--profile', dir, '--force'], { PATH: process.env.PATH })
  assert.equal(result.code, 1, result.stdout)
  assert.match(result.stdout, /ALREADY wired but .* is missing/)
  assert.equal(existsSync(join(dir, 'package.json.no-skill-surface.bak')), false, 'no baseline may be written for an already-wired profile')
})

test('a valid restore only plans without --yes, and reports what it would discard', () => {
  const dir = profile()
  copyFileSync(join(dir, 'package.json'), join(dir, 'package.json.no-skill-surface.bak'))
  seeded(dir)
  const before = readFileSync(join(dir, 'package.json'), 'utf8')
  const result = run(ROLLBACK, ['--profile', dir])
  assert.equal(result.code, 0, result.stdout)
  assert.match(result.stdout, /bundles added since baseline:\s+dsh-skill-surface/)
  assert.equal(readFileSync(join(dir, 'package.json'), 'utf8'), before, 'without --yes nothing may be written')
})
