/**
 * 回归测试:#238「没发布」判定被后续 404 覆盖 / #251 404 吞掉真实失败原因。
 *
 * 只测公开行为:`fetchManifestText` 返回什么、`syncStatus` / `syncApply` 报什么。
 * 私有的 notFoundRaw / notFoundApi 标志不 import、不断言调用次数。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fetchManifestText } from '../lib/sync-remote.js'
import { syncApply, syncStatus } from '../lib/sync-service.js'

const SNAPSHOT = {
  packages: [{ name: 'dsh-ctx-guard', spec: 'link:E:/x', version: '0.1.1' }],
  mcp: [],
  skills: [],
}

function state(overrides = {}) {
  return {
    repo: 'o/r',
    ref: 'main',
    path: 'dsh-manifest.json',
    token: '',
    annotations: {},
    lastPullAt: 0,
    lastPushAt: 0,
    ...overrides,
  }
}

function caps() {
  return { platform: 'linux', hasCommand: () => false, gpu: false }
}

/** GitHub 形状:raw 与 contents API 各回各的状态码,仓库探测(默认分支)一律 404。 */
function githubStub({ rawStatus = 404, apiStatus = 404 } = {}) {
  return async (url) => {
    const href = String(url)
    if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(href)) {
      return { ok: false, status: 404, json: async () => ({}) }
    }
    if (href.includes('/contents/')) {
      return { ok: false, status: apiStatus, json: async () => ({}), text: async () => '' }
    }
    return { ok: false, status: rawStatus, text: async () => '' }
  }
}

/** git 传输的一条硬失败(真 git 也只把首行交给调用方)。 */
function cloneFails(message) {
  return async () => {
    throw new Error(message)
  }
}

const AUTH_MESSAGE = "fatal: could not read Username for 'https://github.com': terminal prompts disabled"

/** 服务层测试会写 plugin-sync.json,隔离 DSH_HOME 免得污染本机配置。 */
async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-251-'))
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await fn()
  } finally {
    if (before === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = before
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      // 残留临时目录无害。
    }
  }
}

// ---- #238:每个传输各记各的 ------------------------------------------------

test('#238 raw 500 + contents 404 不算「没发布」', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', fetchImpl: githubStub({ rawStatus: 500 }), gitBin: 'definitely-not-git' },
  )
  assert.equal(result.text, undefined)
  assert.notEqual(result.notFound, true, 'raw 的 5xx 不能被后来的 404 覆盖成「没发布」')
  assert.match(result.error, /raw: HTTP 500/)
})

test('#238 raw 404 + contents 403 不算「没发布」', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', fetchImpl: githubStub({ apiStatus: 403 }), gitBin: 'definitely-not-git' },
  )
  assert.notEqual(result.notFound, true, '403 是权限问题,不是「文件不存在」')
  assert.match(result.error, /api: HTTP 403/)
})

test('#238 只有每个传输都 404 才是「没发布」,且每次尝试都留在 error 里', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', fetchImpl: githubStub(), gitBin: 'definitely-not-git' },
  )
  assert.equal(result.notFound, true)
  assert.equal(result.missing, true)
  // #251:走到这个分支也不再丢掉每一次传输的实况。
  assert.match(result.error, /raw: HTTP 404/)
  assert.match(result.error, /api: HTTP 404/)
})

// ---- #251:404 不能再冒充「真的没发布」 ------------------------------------

test('#251 凭据为空 + 全 404 + clone 报鉴权错 → 报鉴权失败,不是「没发布」', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', token: '', fetchImpl: githubStub(), clone: cloneFails(AUTH_MESSAGE) },
  )
  assert.equal(result.text, undefined)
  assert.notEqual(result.notFound, true, 'clone 说读不到凭据,就不能断定文件不存在')
  assert.match(result.error, /鉴权|凭据/)
  assert.doesNotMatch(result.error, /尚未发布/)
})

test('#251 clone 说分支不存在时也不报「没发布」,而是回到 ref 建议', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', fetchImpl: githubStub(), clone: cloneFails('fatal: Remote branch main not found in upstream origin') },
  )
  assert.notEqual(result.notFound, true, 'ref 写错与「真的没发布」必须分开')
  assert.match(result.error, /ref/)
})

test('#251 真的没发布时仍是空舰队,但状态里带上原因', async () => {
  await withHome(async () => {
    const status = await syncStatus({
      snapshot: SNAPSHOT,
      state: state(),
      options: { capabilities: caps(), fetchImpl: githubStub(), gitBin: 'definitely-not-git' },
    })
    assert.equal(status.empty, true)
    assert.equal(status.fetchError, undefined)
    assert.match(status.emptyReason, /尚未发布|文件不存在/, '空舰队也要说清是怎么判出来的')
  })
})

test('#251 token 为空 + 全 404 + clone 鉴权错 → syncStatus 报鉴权失败而非空舰队', async () => {
  await withHome(async () => {
    const status = await syncStatus({
      snapshot: SNAPSHOT,
      state: state({ token: '' }),
      options: { capabilities: caps(), fetchImpl: githubStub(), clone: cloneFails(AUTH_MESSAGE) },
    })
    assert.equal(status.manifest, null)
    assert.notEqual(status.empty, true, '鉴权失败不能画成「尚未发布」的空舰队')
    assert.match(status.fetchError, /鉴权|凭据/)
  })
})

test('#251 syncApply 在远端没有清单时报原因,而不是逐项说「清单里没有这一项」', async () => {
  await withHome(async () => {
    const result = await syncApply({
      snapshot: SNAPSHOT,
      state: state(),
      selection: ['plugin:dsh-ctx-guard'],
      options: { capabilities: caps(), fetchImpl: githubStub(), gitBin: 'definitely-not-git' },
    })
    assert.equal(result.ok, false)
    assert.deepEqual(result.results, [])
    assert.match(result.error, /尚未发布|文件不存在/)
  })
})
