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

test('client 真挂载冒烟:factory 执行 + slots.register 组件可渲染(引用完整性,反向验证)', () => {
  // 字符串级测试抓不住「引用了未定义组件」这类运行时错误(曾实际发生:slot 注册行
  // 引用 StepGovernorPanel 而定义是 StallGovernorPanel,挂载即 ReferenceError)。
  // 这里用 stub React/slots 真跑一遍壳 → apply → 组件渲染。
  const reactStub = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (initial) => [initial, () => {}],
    useEffect: () => {}
  }
  const requireStub = (name) => (name === 'react' ? reactStub : {})
  let loaded = null
  globalThis.window = { __ModuleLoader__: { load: (config) => { loaded = config } } }
  try {
    new Function('require', client)(requireStub)
    assert.ok(loaded && typeof loaded.factory === 'function', 'ModuleLoader 壳捕获 config')
    const registered = []
    const slots = { inject: (name, fn) => fn(), register: (slot, component) => registered.push({ slot, component }) }
    loaded.factory(requireStub).apply({ slots })
    assert.equal(registered.length, 1, 'settings.section 注册一次')
    assert.equal(registered[0].slot.id, 'stall-governor')
    assert.equal(registered[0].slot.order, 997)
    const element = registered[0].component()
    assert.ok(element && typeof element === 'object', '面板组件可渲染(无未定义引用)')
  } finally {
    delete globalThis.window
  }
})
