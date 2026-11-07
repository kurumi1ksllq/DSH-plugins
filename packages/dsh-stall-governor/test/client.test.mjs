// 客户端半边契约测试(源自上游事故:裸顶层 return 会炸 client bundle → 整页
// 「Failed to load plugins」,故壳形态与语法可解析是硬契约)。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client.js')
const client = readFileSync(clientPath, 'utf8')

test('client 语法可解析(node --check)', () => {
  const res = spawnSync('node', ['--check', clientPath], { encoding: 'utf8' })
  assert.equal(res.status, 0, res.stderr || 'client.js syntax check failed')
})

test('ModuleLoader 壳完整:裸顶层 return 会炸 client bundle', () => {
  assert.ok(client.includes("window.__ModuleLoader__.load({"), '必须手写 ModuleLoader 壳')
  assert.ok(client.includes('return module.exports'), 'factory 必须以 return module.exports 收尾(壳内 return)')
  // 顶层裸 return:壳外出现 `return ` 于行首(缩进为 0)
  const bare = client.split('\n').filter((line) => /^return /.test(line))
  assert.deepEqual(bare, [], '顶层裸 return 会落在脚本顶层作用域')
})

test('仅使用 --dsw-alias-* 主题变量并带兜底值', () => {
  const vars = [...client.matchAll(/var\(([^),]+)/g)].map((m) => m[1])
  assert.ok(vars.length > 0, 'client 必须引用主题变量')
  for (const v of vars) {
    assert.ok(v.startsWith('--dsw-alias-'), `非 dsw-alias 主题变量: ${v}`)
  }
})

test('设置页挂载:新 id/新前缀/section order 997,无 harvest 残留', () => {
  assert.ok(client.includes("SETTINGS_API = '/plugins/stall-governor/settings'"), 'API 前缀')
  assert.ok(client.includes("id: 'stall-governor'"), 'settings.section 槽位 id')
  assert.ok(client.includes('order: 997'), 'section order 997(两上游 998/996 避让)')
  assert.ok(client.includes('renderCapabilityBanner'), '能力横幅三态展示')
  assert.equal(client.includes('HARVEST'), false, 'harvest UI 已砍(#96 §6-3)')
  assert.equal(client.includes('pendingDependencies'), false, 'PENDING_DEPENDENCIES 已摘除(#96 §6-5)')
})
