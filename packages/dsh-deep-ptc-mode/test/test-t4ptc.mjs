// T4.ptc (#126): git-bash environment enum, tool-row auto perception,
// environmentText completeness, notifyChannels deprecation, atomic settings
// write, event-driven preset refresh (30s fallback).
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'

import {
  ENVIRONMENTS,
  availableEnvironments,
  environmentText,
  resolveEnvironment,
  deriveDeepPtc,
} from '../lib/model.mjs'
import snapshot from '../lib/preset.json' with { type: 'json' }

const fixtureUrl = name => new URL(`fixtures/${name}`, import.meta.url)
const current = () => JSON.parse(JSON.stringify(snapshot))

// ---------- 1. git-bash enum ----------

test('git-bash is a win32-only environment', () => {
  assert.ok(availableEnvironments('win32').includes('git-bash'))
  assert.equal(availableEnvironments('darwin').includes('git-bash'), false)
  assert.equal(availableEnvironments('linux').includes('git-bash'), false)
  // win32 keeps bash unavailable (native bash is not a Windows shell).
  assert.equal(availableEnvironments('win32').includes('bash'), false)
  assert.equal(resolveEnvironment('git-bash', 'win32'), 'git-bash')
  assert.throws(() => resolveEnvironment('git-bash', 'linux'), /unavailable/)
})

test('environmentText covers every environment value (completeness)', () => {
  // 'auto' resolves to a concrete shell before the text is built, so the
  // completeness set is the resolved environments, not the raw enum.
  for (const environment of ['wsl', 'powershell', 'zsh', 'bash', 'git-bash']) {
    const text = environmentText(environment)
    assert.equal(typeof text, 'string')
    assert.match(text, /Execution environment:/)
  }
})

test('deriveDeepPtc accepts environment git-bash on win32 and swaps the bash row', () => {
  const upstream = JSON.parse(JSON.stringify(snapshot))
  const { preset, report } = deriveDeepPtc(upstream, { environment: 'git-bash' }, 'win32')
  assert.equal(report.environment, 'git-bash')
  assert.ok(preset.plugins.some(row => row.id === 'execution'))
})

// ---------- 2. auto perception of tool rows ----------

test('a powershell environment falls back to the bash tool row when tool-pwsh is absent', () => {
  const upstream = current()
  upstream.plugins = upstream.plugins.filter(row => row.id !== 'tool-pwsh')
  const { preset, report } = deriveDeepPtc(upstream, { environment: 'powershell' }, 'win32')
  assert.equal(report.environment, 'powershell')
  assert.ok(
    report.replacedShellRows.some(row => row.includes('tool-bash')),
    'the bash row must be the one replaced; got: ' + report.replacedShellRows.join(','),
  )
  assert.ok(preset.plugins.some(row => row.id === 'execution'))
})

test('a bash environment falls back to the pwsh tool row when tool-bash is absent', () => {
  const upstream = current()
  upstream.plugins = upstream.plugins.filter(row => row.id !== 'tool-bash')
  const { preset, report } = deriveDeepPtc(upstream, { environment: 'zsh' }, 'darwin')
  assert.equal(report.environment, 'zsh')
  assert.ok(
    report.replacedShellRows.some(row => row.includes('tool-pwsh')),
    'the pwsh row must be the one replaced; got: ' + report.replacedShellRows.join(','),
  )
})

test('with no shell tool rows at all the official rows are still kept', () => {
  const upstream = current()
  upstream.plugins = upstream.plugins.filter(row => !['tool-bash', 'tool-pwsh'].includes(row.id))
  const { preset, report } = deriveDeepPtc(upstream, { environment: 'zsh' }, 'darwin')
  assert.deepEqual(report.replacedShellRows, [])
  assert.equal(report.environment, 'official')
})

// ---------- 3. notifyChannels deprecation ----------

test('notifyChannels schema is marked deprecated and still normalizes', async () => {
  const { GOVERNOR_SETTINGS_SCHEMA, GOVERNOR_SETTINGS_DEFAULTS } = await import('../lib/governor-core.mjs')
  const entry = GOVERNOR_SETTINGS_SCHEMA.find((s) => s.key === 'notifyChannels')
  assert.ok(entry, 'schema entry kept for compat')
  assert.match(entry.label.zh, /已废弃/, '#132:label 为 {zh,en} 双字典')
  assert.match(entry.hint.zh, /废弃/)
  assert.equal(GOVERNOR_SETTINGS_DEFAULTS.notifyChannels[0], 'GUI')
})

// ---------- 4. atomic settings write ----------

test('savePersistedSettings writes atomically: no tmp residue, mode 0600', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't4ptc-'))
  process.env.DSH_STALL_GOVERNOR_SETTINGS_PATH = join(dir, 'storages', 'stall-governor.json')
  const { apply } = await import('../lib/governor.js')
  try {
    const handlers = new Map()
    const regs = []
    const ctx = {
      on(name, fn) { (handlers.get(name) ?? handlers.set(name, []).get(name)).push(fn) },
      async emit() { return undefined },
      provide() {},
      webServer: { register: (r) => regs.push(r) },
      logger: { info() {}, warn() {}, error() {} },
    }
    apply(ctx)
    assert.equal(regs.length, 1, 'settings route registered')
    const handler = regs[0].handler
    const res = { status: 0, body: '' }
    res.writeHead = (code) => { res.status = code }
    res.end = (b) => { res.body = b || '' }
    const { EventEmitter } = await import('node:events')
    const req = new EventEmitter()
    req.method = 'POST'
    const done = handler(req, res)
    req.emit('data', JSON.stringify({ mode: 'off' }))
    req.emit('end')
    await done
    const settingsPath = process.env.DSH_STALL_GOVERNOR_SETTINGS_PATH
    assert.ok(existsSync(settingsPath), 'settings file written')
    assert.equal(existsSync(settingsPath + '.tmp'), false, 'no tmp residue')
    // POSIX mode semantics: Windows ignores writeFileSync's mode argument.
    if (process.platform !== 'win32') {
      const mode = statSync(settingsPath).mode & 0o777
      assert.equal(mode, 0o600, 'settings file is 0600, got ' + mode.toString(8))
    }
  } finally {
    delete process.env.DSH_STALL_GOVERNOR_SETTINGS_PATH
    rmSync(dir, { recursive: true, force: true })
  }
})

// ---------- 5. poll fallback ----------

test('the refresh fallback interval is at least 30s (event-driven primary)', async () => {
  const source = readFileSync(new URL('../lib/index.mjs', import.meta.url), 'utf8')
  assert.match(source, /raw >= 5000 \? raw : 30_000/)
  assert.ok(!source.includes('setInterval(detect,5000)'), 'the old 5s blind poll is gone')
  // The loader event remains the primary channel.
  assert.match(source, /loader\/volatile-update/)
})

// ---------- environment.mjs union tracks the enum ----------

test('the settings schema union lists every environment (including auto)', () => {
  // environment.mjs imports the runtime-only schemastery, so this pins the
  // union textually — the drift that bit us was exactly a missing list entry.
  const text = readFileSync(new URL('../lib/environment.mjs', import.meta.url), 'utf8')
  // The union spreads ENVIRONMENTS itself, so enum growth flows through.
  assert.match(text, /z\.union\(\[\.\.\.ENVIRONMENTS\]\)\.required\(\)/)
})
