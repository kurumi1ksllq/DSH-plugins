// 客户端半边契约测试(源自上游事故:裸顶层 return 会炸 client bundle → 整页
// 「Failed to load plugins」,故壳形态与语法可解析是硬契约)。
// #112 后 governor 的 client 段并入 dsh-deep-ptc-mode/lib/client.js 的第二模块
// (单文件双 ModuleLoader.load),这里的断言全部对准该段的段内文本。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'lib', 'client.js')
const client = readFileSync(clientPath, 'utf8')

// 第二模块段:从「吸收自」注释行起(它正好在 governor 的 load 壳之前)
const govMark = client.indexOf('// ---- 吸收自 dsh-stall-governor')
const gov = govMark === -1 ? client : client.slice(govMark)

test('client 语法可解析(node --check)', () => {
  const res = spawnSync('node', ['--check', clientPath], { encoding: 'utf8' })
  assert.equal(res.status, 0, res.stderr || 'client.js syntax check failed')
})

test('ModuleLoader 壳完整:裸顶层 return 会炸 client bundle', () => {
  assert.ok(gov.includes("window.__ModuleLoader__.load({"), '必须手写 ModuleLoader 壳')
  assert.ok(gov.includes('return module.exports'), 'factory 必须以 return module.exports 收尾(壳内 return)')
  const bare = gov.split('\n').filter((line) => /^return /.test(line))
  assert.deepEqual(bare, [], '顶层裸 return 会落在脚本顶层作用域')
})

test('仅使用 --dsw-alias-* 主题变量并带兜底值', () => {
  const vars = [...gov.matchAll(/var\(([^),]+)/g)].map((m) => m[1])
  assert.ok(vars.length > 0, 'client 必须引用主题变量')
  for (const v of vars) {
    assert.ok(v.startsWith('--dsw-alias-'), `非 dsw-alias 主题变量: ${v}`)
  }
})

test('设置页挂载:section order 997,无 harvest 残留', () => {
  assert.ok(client.includes("SETTINGS_API = '/plugins/stall-governor/settings'"), 'API 前缀')
  assert.ok(gov.includes("id: 'stall-governor'"), 'settings.section 槽位 id')
  assert.ok(gov.includes('order: 997'), 'section order 997(两上游 998/996 避让)')
  assert.ok(gov.includes('renderCapabilityBanner'), '能力横幅三态展示')
  assert.equal(gov.includes('HARVEST'), false, 'harvest UI 已砍(#96 §6-3)')
  assert.equal(gov.includes('pendingDependencies'), false, 'PENDING_DEPENDENCIES 已摘除(#96 §6-5)')
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
    new Function('require', gov)(requireStub)
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

test('#132 en 环境:navigator.language 非 zh 时,SHELL.en 生效(en 渲染断言)', () => {
	// node v24 全局 navigator.language 默认 'en-US' → UI_LOCALE='en';
	// 断言注册 slot 的 label 取自 SHELL.en.section。若宿主环境是 zh locale,
	// 此测试临时改 navigator.language 模拟 en(渲染行为一致)。
	const original = globalThis.navigator?.language
	const fakeNav = { language: 'en-US' }
	let restored = false
	try {
		Object.defineProperty(globalThis, 'navigator', { value: fakeNav, configurable: true })
		const reactStub = {
			createElement: (type, props, ...children) => ({ type, props, children }),
			useState: (initial) => [initial, () => {}],
			useEffect: () => {}
		}
		const requireStub = (name) => (name === 'react' ? reactStub : {})
		let loaded = null
		globalThis.window = { __ModuleLoader__: { load: (config) => { loaded = config } } }
		try {
			new Function('require', gov)(requireStub)
			const registered = []
			const slots = { inject: (name, fn) => fn(), register: (slot, component) => registered.push({ slot, component }) }
			loaded.factory(requireStub).apply({ slots })
			assert.equal(registered[0].slot.label, 'Stall governor', 'en 环境下 section label 取 SHELL.en.section')
			const element = registered[0].component()
			assert.ok(element && typeof element === 'object', 'en 环境组件可渲染')
		} finally {
			delete globalThis.window
		}
		restored = true
	} finally {
		if (!restored && original !== undefined) {
			Object.defineProperty(globalThis, 'navigator', { value: { language: original }, configurable: true })
		}
	}
});

test('#132 pick 语义:{zh,en} 对象按 locale 选侧,zh 缺 en 回退 zh(字符串级)', () => {
	// pick 是壳内闭包,无法直接 import;以源码形态断言其三分支(选侧/回退/字符串透传)
	assert.match(gov, /function pick\(value\)/, 'pick 函数存在')
	assert.match(gov, /UI_LOCALE === 'en' \? value\.en : value\.zh/, 'en 选 en、zh 选 zh')
	assert.match(gov, /return text \|\| value\.zh \|\| value\.en \|\| ''/, '缺失侧回退另一侧')
	assert.match(gov, /return value\n/, '字符串透传(向后兼容)')
});
