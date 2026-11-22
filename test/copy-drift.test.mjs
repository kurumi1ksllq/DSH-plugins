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
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, sep } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..')

/**
 * Every file in this repository that defines `isForbiddenOrigin`, pinned.
 *
 * dsh-inventory carries TWO copies (its HTTP guard and the prompt-inject
 * half-module). The first version of this list missed the second one — the very
 * shape this contract exists to catch — so the scan test below now refuses a
 * list that does not equal the repository's actual set.
 */
const HTTP_GUARDS = [
  'packages/dsh-inventory/lib/http-guard.js',
  'packages/dsh-inventory/lib-prompt-inject.js',
  'packages/dsh-websearch-failover/lib/http.mjs',
  'packages/dsh-credential-vault/lib/http.mjs',
  'packages/dev-flow/lib-git-status/http-guard.js',
  // issue-234: the governor settings route was the one state-changing route in
  // the repo WITHOUT this check; its copy joins the contract.
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
  return source
    // Comments are style, not behaviour: an explanatory line inside the body
    // must not turn the comparison red.
    .replace(/\/\/[^\n]*/g, '')
    // Quote STYLE is normalised (double → single) but quotes are kept: deleting
    // them would make `originHost !== host` and `originHost !== "host"` compare
    // equal, and the second is a real defect (always true → same-origin requests
    // refused on every call).
    .replace(/"/g, "'")
    .replace(/\s+/g, '')
    .replace(/;/g, '')
}

test('the pinned copy list matches every definition in the repository', () => {
  const found = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.git')) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(mjs|js|ts)$/.test(entry.name)) continue
      const text = readFileSync(full, 'utf8')
      if (!text.includes('function isForbiddenOrigin')) continue
      found.push(full.slice(repoRoot.length + 1).split(sep).join('/'))
    }
  }
  walk(join(repoRoot, 'packages'))
  assert.deepEqual(found.sort(), [...HTTP_GUARDS].sort(),
    'a new isForbiddenOrigin copy appeared (or one was deleted): add/remove it in HTTP_GUARDS so it is covered')
})

test('every isForbiddenOrigin copy is behaviourally identical (change one, it fails)', () => {
  const sources = HTTP_GUARDS.map((rel) => isForbiddenOriginSource(readFileSync(join(repoRoot, rel), 'utf8')))
  for (let index = 1; index < sources.length; index += 1) {
    assert.equal(sources[index], sources[0], `${HTTP_GUARDS[index]} 的 isForbiddenOrigin 与其他副本漂移`)
  }
})

test('every isForbiddenOrigin copy keeps the cross-site and Origin checks', () => {
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
  return probeDefinitionWith(definition, { limit: 1 })
}

/** Drive one definition with explicit args and report the outcome. */
async function probeDefinitionWith(definition, args) {
  try {
    const value = await definition.execute(args)
    return { rejected: false, value }
  } catch (error) {
    return { rejected: true, name: error.name, message: error.message }
  }
}

test('both define-tool stand-ins reject the same inputs (input matrix, not one case)', async () => {
  const [vaultModule] = await Promise.all([
    import(join(repoRoot, 'packages/dsh-credential-vault/lib/define-tool.js')),
  ])
  const { registerRoleTools } = await import(
    join(repoRoot, 'packages/dsh-task-dispatcher/lib/role-tools.mjs')
  )

  const vaultFallback = vaultModule.FALLBACK_DEFINE_TOOL
  const registered = []
  registerRoleTools({
    effect: (fn) => fn(),
    tools: { register: (definition) => { registered.push(definition); return () => {} } },
  })
  const delegate = registered.find((definition) => definition.name === 'delegate_role')
  assert.ok(delegate, 'dispatcher 应注册 delegate_role')

  const vaultDefinition = vaultFallback(specWithRequired())
  const dispatcherDefinition = { ...delegate, execute: delegate.execute }

  // The SAME input shapes against both stand-ins, derived from each one's own
  // required list (vault: query; dispatcher: role+prompt). The first version of
  // this test only checked "missing undefined is rejected", which hid a real
  // divergence: the vault copy accepted whitespace-only while the dispatcher
  // copy rejected it. Both now trim().
  const casesFor = (definition) => {
    const required = definition.parameters?.required ?? []
    const valid = Object.fromEntries(required.map((name) => [name, 'x']))
    const blank = Object.fromEntries(required.map((name) => [name, '   ']))
    const nulled = Object.fromEntries(required.map((name) => [name, null]))
    return [
      { label: 'missing', args: {}, rejected: true },
      { label: 'null', args: nulled, rejected: true },
      { label: 'whitespace-only', args: blank, rejected: true },
      { label: 'valid', args: valid, rejected: false },
    ]
  }

  for (const [name, definition] of [['vault', vaultDefinition], ['dispatcher', dispatcherDefinition]]) {
    for (const testCase of casesFor(definition)) {
      const outcome = await probeDefinitionWith(definition, testCase.args)
      if (testCase.rejected) {
        assert.equal(outcome.rejected, true,
          `${name} stand-in disagreed on "${testCase.label}": expected a validation rejection, got success`)
        assert.equal(outcome.name, 'ToolArgsError', `${name} stand-in must reject with ToolArgsError`)
      } else {
        // A valid call may still fail later in the real body (the dispatcher
        // needs a calling agent); what this matrix pins is that it got PAST
        // argument validation.
        assert.notEqual(outcome.name, 'ToolArgsError',
          `${name} stand-in rejected valid arguments: ${outcome.message ?? ''}`)
      }
    }
  }
})
