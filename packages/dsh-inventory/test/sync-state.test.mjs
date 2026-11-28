import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  STATE_DEFAULTS,
  STATE_FILE,
  dshHome,
  publicState,
  readState,
  statePath,
  writeState,
} from '../lib/sync-state.js'
import { LEGACY_ID } from '../lib/fleet.js'

// #145: every scratch directory this file makes is registered and removed at the
// end of the run. Leaving them behind accumulated hundreds of dsh-* trees in the
// OS temp dir on every full test run.
const scratchRegistry = []
after(() => {
  for (const dir of scratchRegistry) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // Windows may still hold a handle; a temp leftover is harmless.
    }
  }
})

/** Register a directory for cleanup at the end of the run. */
function track(dir) {
  scratchRegistry.push(dir)
  return dir
}

function scratchHome() {
  return track(mkdtempSync(join(tmpdir(), 'dsh-state-')))
}

/** 家目录里该状态文件的损坏备份:只按名字前缀找,不假设时间戳格式。 */
function corruptBackups(home) {
  return readdirSync(home).filter((name) => name.startsWith(`${STATE_FILE}.corrupt-`))
}

/** `STATE_DEFAULTS` minus the fields a read is allowed to fill in for us. */
function withoutMachineId(defaults) {
  const { machineId, ...rest } = defaults
  return rest
}

test('dshHome honours DSH_HOME and falls back to ~/.dsh', () => {
  assert.equal(dshHome({ DSH_HOME: '/custom' }), '/custom')
  assert.equal(dshHome({ HOME: '/home/u' }), join('/home/u', '.dsh'))
  assert.equal(dshHome({ USERPROFILE: 'C:\\Users\\u' }), join('C:\\Users\\u', '.dsh'))
  // No env override: the shared resolver in dsh-home.js falls back to os.homedir(),
  // so an empty env still resolves (never null) — same value for every module.
  const resolved = dshHome({})
  assert.equal(typeof resolved, 'string')
  assert.equal(resolved.endsWith(join('.dsh')), true)
})

test('readState mints a machineId when the file is absent', () => {
  const env = { DSH_HOME: scratchHome() }
  const state = readState(env)
  // Everything except the minted id is still the documented default.
  const { machineId, ...rest } = state
  assert.deepEqual(rest, withoutMachineId({ ...STATE_DEFAULTS }))
  assert.equal(typeof machineId, 'string')
  assert.equal(machineId.length > 0, true)
  assert.notEqual(machineId, LEGACY_ID)
  // Minted once and persisted: a second read returns the same id.
  assert.equal(readState(env).machineId, machineId)
})

test('readState mints a machineId when the file is garbage', () => {
  const home = scratchHome()
  const env = { DSH_HOME: home }
  writeFileSync(statePath(env), 'not json')
  const state = readState(env)
  const { machineId, corrupt, ...rest } = state
  // #288: 坏文件不再无声回退,必须报「状态文件损坏」。
  assert.equal(corrupt, true)
  assert.deepEqual(rest, withoutMachineId({ ...STATE_DEFAULTS }))
  assert.equal(typeof machineId, 'string')
  assert.equal(machineId.length > 0, true)
})

// ---- #288:坏状态文件不许被默认值覆盖 ----------------------------------------

test('#288 截断的 JSON 改名为 .corrupt-<时间戳> 备份,repo/token 不被清零', () => {
  const home = scratchHome()
  const env = { DSH_HOME: home }
  const original = '{"repo":"o/r","token":"secret-token",'
  writeFileSync(statePath(env), original)
  const state = readState(env)
  // 返回值是默认值 + 损坏标记(调用方据此提示用户去修)。
  assert.equal(state.corrupt, true)
  assert.equal(state.repo, '')
  const backups = corruptBackups(home)
  assert.equal(backups.length, 1, '损坏文件必须改名保留一份备份')
  // 备份里一个字节都不能少:repo/token 是这里唯一无法重新获取的东西。
  assert.equal(readFileSync(join(home, backups[0]), 'utf8'), original)
  assert.equal(state.machineId.length > 0, true)
})

test('#288 合法 JSON 但不是对象同样按损坏处理', () => {
  const home = scratchHome()
  const env = { DSH_HOME: home }
  const original = '[1,2,3]'
  writeFileSync(statePath(env), original)
  const state = readState(env)
  assert.equal(state.corrupt, true)
  const backups = corruptBackups(home)
  assert.equal(backups.length, 1)
  assert.equal(readFileSync(join(home, backups[0]), 'utf8'), original)
})

test('#288 只有个别字段类型错时不清零可救的 repo/token,也不留备份', () => {
  const home = scratchHome()
  const env = { DSH_HOME: home }
  const original = JSON.stringify({ repo: 'o/r', token: 'secret-token', machineId: 'box-a', lastPullAt: 'yesterday' })
  writeFileSync(statePath(env), original)
  const state = readState(env)
  assert.equal(state.repo, 'o/r')
  assert.equal(state.token, 'secret-token')
  assert.equal(state.lastPullAt, 0)
  // 可救的文件不算损坏:备份它反而会把还能用的 repo/token 挪走。
  assert.notEqual(state.corrupt, true)
  assert.equal(corruptBackups(home).length, 0)
  assert.equal(readFileSync(statePath(env), 'utf8'), original)
})

test('#288 备份改名失败时不抛错,也不拿默认值覆盖原文件', () => {
  const home = scratchHome()
  const env = { DSH_HOME: home }
  const original = '{"repo":"o/r","token":"secret-token",'
  writeFileSync(statePath(env), original)
  // 用固定时钟 + 预先占住备份名(同名目录)逼 rename 失败:chmod 那招在 root 下无效。
  // 这里刻意钉住时间戳格式 —— 它正是验收里写明的「<原文件名>.corrupt-<时间戳>」。
  const stamp = '2026-01-01T00-00-00-000Z'
  mkdirSync(join(home, `${STATE_FILE}.corrupt-${stamp}`))
  const RealDate = globalThis.Date
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? ['2026-01-01T00:00:00.000Z'] : args))
    }
  }
  try {
    const state = readState(env)
    assert.equal(state.corrupt, true)
    assert.equal(state.machineId.length > 0, true)
    assert.equal(readFileSync(statePath(env), 'utf8'), original, '原文件必须原样留着')
  } finally {
    globalThis.Date = RealDate
  }
})

test('readState keeps an existing machineId across reads', () => {
  const home = scratchHome()
  const env = { DSH_HOME: home }
  writeFileSync(statePath(env), JSON.stringify({ repo: 'o/r', machineId: 'box-a' }))
  assert.equal(readState(env).machineId, 'box-a')
})

test('writeState persists and merges partial updates', async () => {
  const env = { DSH_HOME: scratchHome() }
  await writeState({ repo: 'o/r', token: 'secret' }, env)
  await writeState({ lastPullAt: 42 }, env)
  const state = readState(env)
  assert.equal(state.repo, 'o/r')
  // A later partial write must not erase the token.
  assert.equal(state.token, 'secret')
  assert.equal(state.lastPullAt, 42)
})

test('writeState creates the file with owner-only permissions', async () => {
  const env = { DSH_HOME: scratchHome() }
  await writeState({ token: 't' }, env)
  if (process.platform !== 'win32') {
    const mode = statSync(statePath(env)).mode & 0o777
    assert.equal(mode, 0o600)
  }
  const raw = JSON.parse(readFileSync(statePath(env), 'utf8'))
  assert.equal(raw.token, 't')
})

test('writeState serializes concurrent partial updates', async () => {
  const env = { DSH_HOME: scratchHome() }
  // 50 concurrent partial writes, each its own field: without the queue the
  // read→merge→write of one call would clobber the others' keys.
  const patches = []
  for (let i = 0; i < 50; i += 1) {
    patches.push({ [`annotations`]: { ...(patches[i - 1]?.annotations ?? {}), [`k${i}`]: i } })
  }
  // Also mix in plain top-level fields to catch merges of scalars.
  patches.push({ lastPullAt: 7 }, { lastPushAt: 8 }, { repo: 'o/r' })
  await Promise.all(patches.map((patch) => writeState(patch, env)))
  const state = readState(env)
  for (let i = 0; i < 50; i += 1) {
    assert.equal(state.annotations[`k${i}`], i, `annotations.k${i} must survive`)
  }
  assert.equal(state.lastPullAt, 7)
  assert.equal(state.lastPushAt, 8)
  assert.equal(state.repo, 'o/r')
})

test('publicState never exposes the token', () => {
  const state = { ...STATE_DEFAULTS, repo: 'o/r', token: 'secret-value' }
  const pub = publicState(state)
  assert.equal(pub.hasToken, true)
  assert.equal('token' in pub, false)
  assert.equal(JSON.stringify(pub).includes('secret-value'), false)
})

test('publicState reports no token when empty', () => {
  assert.equal(publicState({ ...STATE_DEFAULTS }).hasToken, false)
})

test('statePath falls back to os.homedir() when env has no home', () => {
  // dsh-home.js never returns null: an empty env resolves via os.homedir().
  const resolved = statePath({})
  assert.equal(typeof resolved, 'string')
  assert.equal(resolved.endsWith(join('.dsh', 'plugin-sync.json')), true)
})
