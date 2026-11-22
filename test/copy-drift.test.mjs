// issue-234:仓库内重复实现的契约测试。
//
// 背景:五份 isForbiddenOrigin(inventory/failover/vault/dev-flow)与两份
// defineTool 兜底实现(vault/task-dispatcher)是各自 bundle 独立安装的必然结果
// ——各 bundle 不能跨包共享模块。但重复意味着「一处改安全逻辑、其余不动」的风险。
//
// 本测试把风险变成测试时的失败:
//   - http-guard 按 discipline-copy 的惯例,把五份实现体的源码逐字钉死;
//   - define-tool 做行为等价契约:两份兜底都必须在工具体执行前校验必填参数,
//     且错误形态一致。改坏任一份,对应断言立刻变红。

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

/** http-guard 五份拷贝的相对路径。 */
const HTTP_GUARDS = [
  'packages/dsh-inventory/lib/http-guard.js',
  'packages/dsh-websearch-failover/lib/http.mjs',
  'packages/dsh-credential-vault/lib/http.mjs',
  'packages/dev-flow/lib-git-status/http-guard.js',
  // issue-234: the governor settings route was the one state-changing route in
  // the repo WITHOUT this check; its copy joins the contract so a future fix
  // cannot land in four of five.
  'packages/dsh-deep-ptc-mode/lib/governor-apply.mjs',
]

/**
 * 从一段源码里取出 `export function isForbiddenOrigin` 的整个实现体
 * (含签名,到第一个顶格的 `}` 为止)。
 */
function isForbiddenOriginSource(text) {
  // governor-apply declares it without `export` (the file uses a single-line
  // export list because its test loader strips `export` per line).
  const marker = text.indexOf('function isForbiddenOrigin')
  assert.ok(marker >= 0, '缺 function isForbiddenOrigin')
  const start = text.lastIndexOf('export ', marker) >= 0 && marker - text.lastIndexOf('export ', marker) < 8
    ? text.lastIndexOf('export ', marker)
    : marker
  const after = text.slice(start).replace(/^export /, '')
  const end = after.indexOf('\n}', 2)
  assert.ok(end >= 0, 'isForbiddenOrigin 实现体不完整')
  return normalizeCopy(after.slice(0, end + 2))
}

/**
 * Normalize one implementation body for cross-file comparison.
 *
 * The copies live in files with different house styles (governor-* use tabs,
 * double quotes and semicolons; the http-guard modules use two spaces, single
 * quotes and no semicolons), so a byte-for-byte comparison would flag style
 * rather than drift. Comparing the token stream (whitespace, quotation
 * characters and statement semicolons removed) keeps the check semantic: any changed condition,
 * removed check, different return value or reordered branch still fails it.
 * @param {string} source
 * @returns {string}
 */
function normalizeCopy(source) {
  return source.replace(/\s+/g, '').replace(/['"]/g, '').replace(/;/g, '')
}

test('五份 isForbiddenOrigin 实现体逐字一致(改坏任一份即红)', () => {
  const sources = HTTP_GUARDS.map((rel) => isForbiddenOriginSource(readFileSync(join(repoRoot, rel), 'utf8')))
  for (let index = 1; index < sources.length; index += 1) {
    assert.equal(sources[index], sources[0], `${HTTP_GUARDS[index]} 的 isForbiddenOrigin 与其他副本漂移`)
  }
})

test('五份 isForbiddenOrigin 实现体都保留 cross-site 与 Origin 双重检查', () => {
  for (const rel of HTTP_GUARDS) {
    const source = isForbiddenOriginSource(readFileSync(join(repoRoot, rel), 'utf8'))
    assert.ok(source.includes('sec-fetch-site'), `${rel} 缺 cross-site 检查`)
    assert.ok(source.includes('origin'), `${rel} 缺 Origin 检查`)
  }
})

// ---- define-tool 行为等价契约 ----

/** 一份最小工具 spec,带必填参数。 */
function specWithRequired() {
  return {
    name: 'probe',
    description: 'probe',
    parameters: {
      query: { type: 'string', required: true },
      limit: { type: 'number' },
    },
    output: { schema: { type: 'string' } },
    execute: () => 'ran',
  }
}

/**
 * 通过工具体执行,报告这份定义是否在执行前拒绝缺参、错误形态如何。
 * @param {object} definition
 */
async function probeDefinition(definition) {
  try {
    const value = await definition.execute({ limit: 1 })
    return { rejected: false, value }
  } catch (error) {
    return { rejected: true, name: error.name, message: error.message }
  }
}

test('两份 define-tool 兜底行为等价:缺必填参数在执行前被拒、错误形态一致', async () => {
  const [vaultModule] = await Promise.all([
    import(join(repoRoot, 'packages/dsh-credential-vault/lib/define-tool.js')),
  ])
  const { registerRoleTools } = await import(
    join(repoRoot, 'packages/dsh-task-dispatcher/lib/role-tools.mjs')
  )

  // 1) vault 的 FALLBACK_DEFINE_TOOL:公开导出,直接驱动。
  const vaultFallback = vaultModule.FALLBACK_DEFINE_TOOL
  assert.equal(typeof vaultFallback, 'function', 'vault 应导出 FALLBACK_DEFINE_TOOL')
  const vaultResult = await probeDefinition(vaultFallback(specWithRequired()))
  assert.equal(vaultResult.rejected, true, 'vault 兜底必须在执行前拒绝缺参')
  assert.equal(vaultResult.name, 'ToolArgsError', 'vault 兜底的错误名应为 ToolArgsError')
  assert.match(vaultResult.message, /missing required property "query"/, 'vault 兜底应报告缺哪个参数')

  // 2) dispatcher 的兜底:通过其公开入口 registerRoleTools(ctx) 拿到注册的工具定义,
  //    再驱动工具体——测公开行为,不触碰私有符号。
  const registered = []
  const ctx = {
    effect: (fn) => fn(),
    tools: {
      register: (definition) => {
        registered.push(definition)
        return () => {}
      },
    },
  }
  registerRoleTools(ctx)
  assert.equal(registered.length, 2, 'dispatcher 应注册两个角色工具')

  const delegate = registered.find((definition) => definition.name === 'delegate_role')
  assert.ok(delegate, 'dispatcher 应注册 delegate_role')
  // delegate_role 的参数全部必填,缺 prompt 时应在执行前被拒。
  const dispatcherResult = await probeDefinition({ ...delegate, execute: delegate.execute })
  assert.equal(dispatcherResult.rejected, true, 'dispatcher 兜底必须在执行前拒绝缺参')
  assert.equal(dispatcherResult.name, 'ToolArgsError', 'dispatcher 兜底的错误名应为 ToolArgsError')
})
