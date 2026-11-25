/**
 * 回归测试:#238「没发布」判定被后续 404 覆盖 / #251 404 吞掉真实失败原因。
 *
 * 只测公开行为:`fetchManifestText` 返回什么、`syncStatus` / `syncApply` / `syncPublish`
 * 报什么。私有的 notFoundRaw / notFoundApi 标志不 import、不断言调用次数。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fetchManifestText } from '../lib/sync-remote.js'
import { syncApply, syncPublish, syncStatus } from '../lib/sync-service.js'

const SNAPSHOT = {
  packages: [{ name: 'dsh-ctx-guard', spec: 'link:E:/x', version: '0.1.1' }],
  mcp: [],
  skills: [],
}

/** 每次读取都显式给上限:默认 15s 会让这个文件每条用例多挂 15 秒。 */
const TIMEOUT_MS = 100

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

/**
 * GitHub 形状的 stub。
 *
 * `probeStatus` 是「用同一个 token 探仓库本身」的结果:200 表示这个凭据读得到仓库
 * (于是双 404 才等于「还没发布」),404 表示读不到(私有仓 / 过期 token / 无权限)。
 */
function githubStub({ rawStatus = 404, apiStatus = 404, probeStatus = 404, defaultBranch = 'main', rawByRef = null } = {}) {
  return async (url) => {
    const href = String(url)
    if (/^https:\/\/api\.github\.com\/repos\/[^/]+\/[^/]+$/.test(href)) {
      if (probeStatus === 200) return { ok: true, status: 200, json: async () => ({ default_branch: defaultBranch }) }
      return { ok: false, status: probeStatus, json: async () => ({}) }
    }
    if (href.includes('/contents/')) {
      return { ok: false, status: apiStatus, json: async () => ({}), text: async () => '' }
    }
    const ref = /raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/]+)\//.exec(href)?.[1]
    const status = rawByRef !== null && ref !== undefined && rawByRef[ref] !== undefined ? rawByRef[ref] : rawStatus
    return { ok: false, status, text: async () => '' }
  }
}

/** git 传输的一条硬失败(真 git 也只把首行交给调用方)。 */
function cloneFails(message) {
  return async () => {
    throw new Error(message)
  }
}

const AUTH_MESSAGE = "fatal: could not read Username for 'https://github.com': terminal prompts disabled"
/** 仓库读得到时用它:双 404 才是「还没发布」。 */
const READABLE = { probeStatus: 200 }

async function withHome(fn) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-home-251-'))
  const before = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    return await fn(home)
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

const readSyncState = (home) => {
  try {
    // $DSH_HOME/plugin-sync.json(lib/sync-state.js:71),与 profiles/ 同级。
    return JSON.parse(readFileSync(join(home, 'plugin-sync.json'), 'utf8'))
  } catch {
    return {}
  }
}

// ---- #238:每个传输各记各的 ------------------------------------------------

test('#238 raw 500 + contents 404 不算「没发布」', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', timeoutMs: TIMEOUT_MS, fetchImpl: githubStub({ rawStatus: 500 }), gitBin: 'definitely-not-git' },
  )
  assert.equal(result.text, undefined)
  assert.notEqual(result.notFound, true, 'raw 的 5xx 不能被后来的 404 覆盖成「没发布」')
  assert.match(result.error, /raw: HTTP 500/)
})

test('#238 raw 404 + contents 500 不算「没发布」', async () => {
  // 反向验证:旧实现里 api 的非 404 也会把共享标志置 false,但对「raw 404 + api 500」
  // 的结论与修后一致;真正会分叉的是「raw 404 + api 403」(见下一条)与「raw 500 + api 404」。
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', timeoutMs: TIMEOUT_MS, fetchImpl: githubStub({ apiStatus: 500 }), gitBin: 'definitely-not-git' },
  )
  assert.notEqual(result.notFound, true)
  assert.match(result.error, /api: HTTP 500/)
})

test('#238 raw 404 + contents 403 是权限问题,不是「文件不存在」', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', timeoutMs: TIMEOUT_MS, fetchImpl: githubStub({ apiStatus: 403 }), gitBin: 'definitely-not-git' },
  )
  assert.notEqual(result.notFound, true)
  assert.match(result.error, /api: HTTP 403/)
})

test('#238 只有每个传输都 404(且仓库读得到)才是「没发布」,且每次尝试都留在 error 里', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', timeoutMs: TIMEOUT_MS, fetchImpl: githubStub({ ...READABLE }), gitBin: 'definitely-not-git' },
  )
  assert.equal(result.notFound, true)
  assert.equal(result.missing, true)
  assert.equal(result.repoAccess, 'ok', '发布路径要用它确认空底座')
  assert.match(result.error, /raw: HTTP 404/)
  assert.match(result.error, /api: HTTP 404/)
})

test('#238 默认分支重试也没拿到时,retry 的 500 同样不算 404', async () => {
  // repo 探测说默认分支是 master,raw(main)=404 触发重试,raw(master)=500。
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    {
      ref: 'main',
      timeoutMs: TIMEOUT_MS,
      fetchImpl: githubStub({ probeStatus: 200, defaultBranch: 'master', rawByRef: { main: 404, master: 500 } }),
      gitBin: 'definitely-not-git',
    },
  )
  assert.notEqual(result.notFound, true, '重试那条传输说的是 500,不能被当成又一个 404')
  assert.match(result.error, /raw\(master\): HTTP 500/)
})

// ---- #251:404 不能再冒充「真的没发布」 ------------------------------------

test('#251 凭据为空 + 全 404 + clone 报鉴权错 → 报鉴权失败,不是「没发布」', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', timeoutMs: TIMEOUT_MS, token: '', fetchImpl: githubStub(), clone: cloneFails(AUTH_MESSAGE) },
  )
  assert.equal(result.text, undefined)
  assert.notEqual(result.notFound, true, 'clone 说读不到凭据,就不能断定文件不存在')
  assert.match(result.error, /鉴权|凭据/)
  assert.doesNotMatch(result.error, /尚未发布/)
})

test('#251 token 非空但仓库探测被拒 + 全 404 → 同样报鉴权失败(不是「没发布」)', async () => {
  // GitHub 对「私有仓 + 过期 token」在 raw 与 contents API 上都回 404;同一个 token 探
  // 仓库本身也回 404 —— 这一跳才是「凭据读不到」的直接证据。
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    {
      ref: 'main',
      timeoutMs: TIMEOUT_MS,
      token: 'stale-token',
      fetchImpl: githubStub({ probeStatus: 404 }),
      clone: cloneFails(AUTH_MESSAGE),
    },
  )
  assert.notEqual(result.notFound, true, '过期 token 的双 404 不能报「尚未发布」')
  assert.match(result.error, /鉴权|凭据/)
})

test('#251 本地 EACCES 不算鉴权失败', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    {
      ref: 'main',
      timeoutMs: TIMEOUT_MS,
      fetchImpl: githubStub({ ...READABLE }),
      clone: cloneFails("EACCES: permission denied, mkdtemp '/tmp/dsh-sync-abc'"),
    },
  )
  assert.doesNotMatch(String(result.error ?? ''), /鉴权|凭据/)
})

test('#251 clone 说分支不存在时也不报「没发布」,而是回到 ref 建议', async () => {
  const result = await fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', timeoutMs: TIMEOUT_MS, fetchImpl: githubStub({ ...READABLE }), clone: cloneFails('fatal: Remote branch main not found in upstream origin') },
  )
  assert.notEqual(result.notFound, true, 'ref 写错与「真的没发布」必须分开')
  assert.match(result.error, /ref/)
})

// ---- 服务层:#251 的结论要能到面板与安装路径 ------------------------------

test('#251 真的没发布时仍是空舰队,但状态里带上原因,并清掉上一次的失败横幅', async () => {
  await withHome(async (home) => {
    // 先用过期凭据失败一次,让失败横幅落盘。
    await syncStatus({
      snapshot: SNAPSHOT,
      state: state({ token: 'stale-token' }),
      options: { capabilities: caps(), fetchImpl: githubStub(), clone: cloneFails(AUTH_MESSAGE) },
    })
    assert.match(String(readSyncState(home).lastFetchError ?? ''), /鉴权|凭据/, '前提:失败横幅确实写进去了')

    const status = await syncStatus({
      snapshot: SNAPSHOT,
      state: state(),
      options: { capabilities: caps(), fetchImpl: githubStub({ ...READABLE }), gitBin: 'definitely-not-git', timeoutMs: TIMEOUT_MS },
    })
    assert.equal(status.empty, true)
    assert.equal(status.fetchError, undefined)
    assert.match(status.emptyReason, /尚未发布|文件不存在/, '空舰队也要说清是怎么判出来的')
    assert.equal(readSyncState(home).lastFetchError, '', '结论变了,旧横幅不能留着')
  })
})

test('#251 token 为空 + 全 404 + clone 鉴权错 → syncStatus 报鉴权失败而非空舰队', async () => {
  await withHome(async () => {
    const status = await syncStatus({
      snapshot: SNAPSHOT,
      state: state({ token: '' }),
      options: { capabilities: caps(), fetchImpl: githubStub(), clone: cloneFails(AUTH_MESSAGE), timeoutMs: TIMEOUT_MS },
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
      options: { capabilities: caps(), fetchImpl: githubStub({ ...READABLE }), gitBin: 'definitely-not-git', timeoutMs: TIMEOUT_MS },
    })
    assert.equal(result.ok, false)
    assert.deepEqual(result.results, [])
    assert.match(result.error, /尚未发布|文件不存在/)
  })
})

test('#251 发布路径不凭一个双 404 就按首次发布写入(空底座确认)', async () => {
  await withHome(async () => {
    const result = await syncPublish({
      snapshot: SNAPSHOT,
      state: state({ token: 'stale-token' }),
      options: { capabilities: caps(), fetchImpl: githubStub({ probeStatus: 404 }), clone: cloneFails(AUTH_MESSAGE), timeoutMs: TIMEOUT_MS },
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /鉴权|凭据|无法确认/)
  })
})
