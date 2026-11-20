/**
 * The update's side effects, exercised on throwaway repositories (issue #60).
 *
 * These live here, and not in the route test, because the route handler resolves
 * the checkout the *running plugin* was loaded from: a test that POSTs to it runs
 * `git fetch` against the real repository and writes the real
 * `$DSH_HOME/plugin-update/last.json`. One such test overwrote a user's genuine
 * update result, so the panel's "last outcome" was really a test artifact — and it
 * was briefly read as a product bug.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { performUpdate, readLastOutcome, runUpdate } from '../lib/plugin-update.js'

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

function git(dir, ...args) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8' })
}

/**
 * A checkout with an `origin` it can actually fetch from, plus the commit that
 * origin is one step ahead with.
 */
function makeWorld() {
  const origin = track(mkdtempSync(join(tmpdir(), 'pu60-origin-')))
  git(origin, 'init', '-q', '-b', 'main')
  git(origin, 'config', 'user.email', 't@example.com')
  git(origin, 'config', 'user.name', 'T')
  mkdirSync(join(origin, 'packages', 'dsh-one'), { recursive: true })
  writeFileSync(join(origin, 'packages', 'dsh-one', 'package.json'), JSON.stringify({ name: 'dsh-one', version: '0.1.0' }))
  writeFileSync(join(origin, 'packages', 'dsh-one', 'index.js'), 'export const one = 1\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '-q', '-m', 'one')

  const repo = track(mkdtempSync(join(tmpdir(), 'pu60-repo-')))
  git(repo, 'clone', '-q', origin, repo)
  git(repo, 'config', 'user.email', 't@example.com')
  git(repo, 'config', 'user.name', 'T')

  // Origin moves one step ahead: a new version, a parseable entry.
  writeFileSync(join(origin, 'packages', 'dsh-one', 'package.json'), JSON.stringify({ name: 'dsh-one', version: '0.2.0' }))
  writeFileSync(join(origin, 'packages', 'dsh-one', 'index.js'), 'export const two = 2\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '-q', '-m', 'bump')

  const stateDir = track(mkdtempSync(join(tmpdir(), 'pu60-state-')))
  return { origin, repo, stateDir }
}

test('a refused update writes the reason and leaves HEAD where it was', async () => {
  const { repo, stateDir } = makeWorld()
  const before = git(repo, 'rev-parse', 'HEAD').trim()
  // Dirty the tree: the gate must refuse before touching anything.
  writeFileSync(join(repo, 'packages', 'dsh-one', 'loose.txt'), 'x\n')

  const answered = []
  const result = await performUpdate({ repo, stateDir, respond: (payload) => answered.push(payload) })

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'dirty-tree')
  assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), before, 'a refusal must not move HEAD')

  const last = readLastOutcome(stateDir)
  assert.equal(last.ok, false)
  assert.equal(last.reason, 'dirty-tree')
})

test('a successful update advances HEAD, records what changed, and answers first', async () => {
  const { repo, stateDir } = makeWorld()
  const before = git(repo, 'rev-parse', 'HEAD').trim()
  const order = []

  const result = await performUpdate({
    repo,
    stateDir,
    respond: () => order.push('respond'),
    reconcile: async () => {
      order.push('reconcile')
      return { warnings: [], pending: [] }
    },
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.changed, [{ name: 'dsh-one', from: '0.1.0', to: '0.2.0' }])
  assert.notEqual(git(repo, 'rev-parse', 'HEAD').trim(), before, 'the checkout must move')
  assert.deepEqual(order, ['respond', 'reconcile'], 'the answer must precede the recomposition')

  const last = readLastOutcome(stateDir)
  assert.equal(last.ok, true)
  assert.deepEqual(last.changed, [{ name: 'dsh-one', from: '0.1.0', to: '0.2.0' }])
  assert.deepEqual(last.restart, { application: 'applied' })
})

test('without an hmr service the update reports restart-required instead of pretending', async () => {
  const { repo, stateDir } = makeWorld()
  const result = await performUpdate({ repo, stateDir, respond: () => {} })
  assert.equal(result.ok, true)
  assert.deepEqual(result.restart, { application: 'restart-required', restartReason: 'no-hmr' })
  assert.deepEqual(readLastOutcome(stateDir).restart, { application: 'restart-required', restartReason: 'no-hmr' })
})

test('the last outcome lives under the directory it is given, never a global one', async () => {
  const { repo, stateDir } = makeWorld()
  await performUpdate({ repo, stateDir, respond: () => {} })
  assert.equal(existsSync(join(stateDir, 'last.json')), true)
  assert.equal(existsSync(join(stateDir, 'plugin-update', 'last.json')), false, 'performUpdate owns exactly one layout')
})

test('a broken entry in the target is refused before the checkout moves', async () => {
  const { origin, repo, stateDir } = makeWorld()
  writeFileSync(join(origin, 'packages', 'dsh-one', 'index.js'), 'export const =\n')
  git(origin, 'add', '.')
  git(origin, 'commit', '-q', '-m', 'break')
  const before = git(repo, 'rev-parse', 'HEAD').trim()

  const result = await performUpdate({ repo, stateDir, respond: () => {} })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'probe')
  assert.equal(git(repo, 'rev-parse', 'HEAD').trim(), before)
})

test('performUpdate keeps the event loop responsive while update work runs (issue-230)', async () => {
  const { repo, stateDir } = makeWorld()
  const answered = []
  // 记录每个 tick 的「实际-预定」延迟:事件循环被同步阻塞后,恢复时第一个回调的
  // 延迟至少等于阻塞时长 —— 这是 setTimeout 采样在阻塞下唯一稳定的信号
  // (相邻触发的 Date.now() 差在恢复后会被压缩,测不出阻塞)。
  const delays = []
  let scheduled = Date.now()
  const ticker = setInterval(() => {
    const now = Date.now()
    delays.push(now - scheduled)
    scheduled = now + 25
  }, 25)
  try {
    // runUpdate 是 performUpdate 内部的注入面:gate 直接过,moveCheckout 注入一个
    // 300ms 的同步阻塞阶段(真实场景是 pnpm install/build,上限 300s/180s,历史上
    // 用 execFileSync 实现会阻塞整个事件循环)。同步阻塞下恢复时第一个 timer 回调的
    // 「实际-预定」延迟 ≥275ms,本测试红;异步 spawn 下全部 <100ms。
    const result = await runUpdate({
      gate: { ok: true, changed: [] },
      moveCheckout: async () => {
        // 异步实现的替身:300ms 的非阻塞等待(真实场景是 spawn + 等待子进程)
        await new Promise((resolve) => setTimeout(resolve, 300))
        return { ok: true, changed: [], from: 'x', to: 'y' }
      },
      respond: (payload) => answered.push(payload),
    })
    assert.equal(result.ok, true)
    assert.equal(answered.length, 1)
    // 注入的阶段同步阻塞 300ms → 期间 timer 零触发(delays 为空)或恢复后首个 tick
    // 延迟 ≥275ms;异步实现下 tick 照常、延迟全部 <100ms。
    const worst = delays.length === 0 ? Number.POSITIVE_INFINITY : Math.max(...delays)
    assert.ok(delays.length >= 5 && worst < 100, `event loop stalled: ${delays.length} ticks, worst delay ${worst === Number.POSITIVE_INFINITY ? '∞' : worst + 'ms'} (injected phase blocks 300ms when sync)`)
  } finally {
    clearInterval(ticker)
  }
})
