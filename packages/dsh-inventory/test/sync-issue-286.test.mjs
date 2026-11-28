/**
 * 回归测试 #286(原始 #265):clone 传输读清单时 path 没约束在克隆根内 ——
 * 配置写 ../../etc/passwd 或绝对路径,就能读到仓库外的文件;克隆内容里的符号链接
 * 指向外部也一样。
 *
 * 只测公开入口 fetchManifestText:clone 是注入的 seam,由它按真 clone 的约定
 * (最后一个参数是目标目录)在临时目录里造出文件/符号链接。私有的判定函数不 import。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { fetchManifestText } from '../lib/sync-remote.js'

const MANIFEST = '{"manifestVersion":1,"plugins":[],"mcp":[],"skills":[]}'

/** 每次读取都显式给上限:默认 15s 会让这个文件每条用例多挂 15 秒。 */
const TIMEOUT_MS = 100

/** 网络全挂:raw 与 contents API 都 404,逼出最后那一跳 git。 */
const deadFetch = async () => ({ ok: false, status: 404, text: async () => '', json: async () => ({}) })

/** 假 clone:真 clone 用最后一个参数拿目标目录,这里照抄。 */
function cloneThat(build) {
  return async (args) => {
    const dir = args[args.length - 1]
    mkdirSync(dir, { recursive: true })
    build(dir)
  }
}

async function read(path, build = () => {}) {
  return fetchManifestText(
    { owner: 'o', repo: 'r' },
    { ref: 'main', path, timeoutMs: TIMEOUT_MS, fetchImpl: deadFetch, clone: cloneThat(build) },
  )
}

/** 克隆根外的「机密」文件,用来证明越界/软链确实能读到仓库外的东西。 */
function withOutsideSecret(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-286-out-'))
  const file = join(dir, 'secret.txt')
  writeFileSync(file, 'SECRET')
  return Promise.resolve(fn(file)).finally(() => rmSync(dir, { recursive: true, force: true }))
}

/** 被拒绝的共同特征:没读到内容,也不许降级成「没发布」。 */
function assertRejected(result, pattern) {
  assert.equal(result.text, undefined, '越界路径不能读出内容')
  assert.notEqual(result.notFound, true, '越界是配置错误,不能被说成「没发布」')
  assert.match(result.error, pattern)
}

test('#286 相对路径 ../x 越出克隆根 → 拒绝', async () => {
  const result = await read('../x')
  assertRejected(result, /越出克隆根/)
  assert.equal(result.error.includes("../x"), true)
})

test('#286 ../../etc/passwd 越出克隆根 → 拒绝', async () => {
  const result = await read('../../etc/passwd')
  assertRejected(result, /越出克隆根/)
})

test('#286 绝对路径 /etc/passwd 越出克隆根 → 拒绝', async () => {
  const result = await read('/etc/passwd')
  assertRejected(result, /越出克隆根/)
})

test('#286 克隆内容里指向外部的符号链接 → 拒绝', async () => {
  await withOutsideSecret(async (secret) => {
    const result = await read('dsh-manifest.json', (dir) => {
      symlinkSync(secret, join(dir, 'dsh-manifest.json'))
    })
    assertRejected(result, /符号链接/)
    assert.match(result.error, /克隆根之外/)
  })
})

test('#286 正常相对路径照旧可读', async () => {
  const result = await read('dsh-manifest.json', (dir) => writeFileSync(join(dir, 'dsh-manifest.json'), MANIFEST))
  assert.equal(result.via, 'git')
  assert.equal(result.text, MANIFEST)
})

test('#286 子目录里的清单照旧可读(只挡越界,不挡子路径)', async () => {
  const result = await read('sub/dsh-manifest.json', (dir) => {
    mkdirSync(join(dir, 'sub'), { recursive: true })
    writeFileSync(join(dir, 'sub', 'dsh-manifest.json'), MANIFEST)
  })
  assert.equal(result.via, 'git')
  assert.equal(result.text, MANIFEST)
})
