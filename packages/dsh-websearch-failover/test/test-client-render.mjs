// Runtime smoke test for the browser half: executes plugin/client.js with a mini
// hook runtime + fake fetch, then asserts rendered text, bar widths, and every POST body.
import fs from 'node:fs'

const CLIENT = new URL("../plugin/client.js", import.meta.url)
const source = fs.readFileSync(CLIENT, 'utf8')

const CALLS = []
let serverState = buildState()
let failNextOrder = false

function buildState() {
  const now = Date.now()
  return {
    ok: true,
    generatedAt: now,
    providers: [
      {
        id: 'tavily', kind: 'tavily', label: 'Tavily', enabled: true, rank: 1, keyPresent: true,
        balance: {
          status: 'ok', remaining: 800, total: 1000, unit: 'credits', ratio: 0.8, fetchedAt: now, source: 'api', detail: '',
          resetKind: 'period-end', resetsAt: Date.parse('2026-11-17T03:43:17.842Z'),
        },
        cooldown: { active: false, until: 0, reason: '', message: '' },
        stats: { calls: 12, successes: 11, failures: 1, lastUsedAt: '2026-10-24T10:00:00.000Z' },
      },
      {
        id: 'exa', kind: 'exa', label: 'Exa', enabled: true, rank: 2, keyPresent: true,
        balance: {
          status: 'ok', remaining: 200, total: 500, unit: 'usd', ratio: null, fetchedAt: now, source: 'api', detail: '',
          resetKind: 'monthly-first', resetsAt: Date.parse('2026-11-01T00:00:00.000Z'),
        },
        cooldown: { active: true, until: now + 65000, reason: 'quota', message: 'quota exhausted' },
        stats: { calls: 3, successes: 2, failures: 1, lastUsedAt: null },
      },
      {
        id: 'brave', kind: 'brave', label: 'Brave', enabled: false, rank: 3, keyPresent: false,
        balance: {
          status: 'unknown', remaining: null, total: null, unit: 'unknown', ratio: null, fetchedAt: 0, source: '', detail: '',
          resetKind: 'none', resetsAt: null,
        },
        cooldown: { active: false, until: 0, reason: '', message: '' },
        stats: { calls: 0, successes: 0, failures: 0, lastUsedAt: null },
      },
      {
        id: 'parallel', kind: 'parallel', label: 'Parallel', enabled: true, rank: 4, keyPresent: true,
        balance: {
          status: 'ok', remaining: 300, total: null, unit: 'tokens', ratio: null, fetchedAt: now, source: 'api', detail: '',
        },
        cooldown: { active: false, until: 0, reason: '', message: '' },
        stats: { calls: 1, successes: 1, failures: 0, lastUsedAt: null },
      },
    ],
  }
}

function reply(ok, status, body) {
  return { ok, status, json: () => Promise.resolve(body) }
}

async function fakeFetch(url, init) {
  const method = (init && init.method) || 'GET'
  const body = init && init.body ? JSON.parse(init.body) : null
  CALLS.push({ url, method, body })

  if (method === 'GET' && url === '/websearch-failover/api/state') return reply(true, 200, serverState)

  if (method === 'POST' && url === '/websearch-failover/api/order') {
    if (failNextOrder) {
      failNextOrder = false
      return reply(false, 500, { error: 'order_persist_failed' })
    }
    const byId = {}
    serverState.providers.forEach((p) => { byId[p.id] = p })
    serverState = { ok: true, generatedAt: Date.now(), providers: body.order.map((id, i) => ({ ...byId[id], rank: i + 1 })) }
    return reply(true, 200, serverState)
  }

  if (method === 'POST' && url === '/websearch-failover/api/enable') {
    serverState = {
      ok: true,
      generatedAt: Date.now(),
      providers: serverState.providers.map((p) => (p.id === body.id ? { ...p, enabled: body.enabled } : p)),
    }
    return reply(true, 200, serverState)
  }

  if (method === 'POST' && url === '/websearch-failover/api/refresh') return reply(true, 200, buildState())

  return reply(false, 404, { error: 'not_found' })
}

/* -------------------------------- mini react ------------------------------ */

function createRuntime() {
  const slots = []
  let cursor = 0
  let dirty = false
  let tree = null
  let Component = null
  let lastProps = null

  const React = {
    createElement(type, props, ...children) {
      return { __el: true, type, props: props || {}, children }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { value: typeof initial === 'function' ? initial() : initial }
      const slot = slots[index]
      return [slot.value, function set(next) {
        const value = typeof next === 'function' ? next(slot.value) : next
        if (Object.is(value, slot.value)) return
        slot.value = value
        dirty = true
      }]
    },
    useEffect(fn, deps) {
      const index = cursor++
      if (!(index in slots)) slots[index] = {}
      slots[index].pending = { fn, deps }
    },
  }

  function runEffects() {
    for (let i = 0; i < slots.length; i += 1) {
      const slot = slots[i]
      if (!slot || !slot.pending) continue
      const pending = slot.pending
      slot.pending = null
      const previous = slot.deps
      const changed = !pending.deps || !previous || pending.deps.length !== previous.length ||
        pending.deps.some((d, k) => !Object.is(d, previous[k]))
      if (!changed) continue
      if (typeof slot.cleanup === 'function') slot.cleanup()
      slot.deps = pending.deps
      slot.cleanup = pending.fn()
    }
  }

  function renderNow() {
    cursor = 0
    tree = Component(lastProps)
    dirty = false
    runEffects()
  }

  return {
    React,
    mount(component, props) {
      Component = component
      lastProps = props
      renderNow()
      return tree
    },
    async pump(rounds = 60) {
      let idle = 0
      for (let i = 0; i < rounds; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (dirty) {
          renderNow()
          idle = 0
        } else {
          idle += 1
          if (idle > 5) return
        }
      }
    },
    tree() {
      return tree
    },
  }
}

function walk(el, visit) {
  if (el == null) return
  if (Array.isArray(el)) {
    el.forEach((child) => walk(child, visit))
    return
  }
  if (typeof el !== 'object' || el.__el !== true) return
  visit(el)
  if (typeof el.type === 'function') {
    walk(el.type({ ...el.props, children: el.children }), visit)
    return
  }
  el.children.forEach((child) => walk(child, visit))
}

function textOf(el) {
  if (el == null || el === true || el === false) return ''
  if (typeof el === 'string' || typeof el === 'number') return String(el)
  if (Array.isArray(el)) return el.map(textOf).join(' ')
  if (typeof el !== 'object' || el.__el !== true) return ''
  if (typeof el.type === 'function') return textOf(el.type({ ...el.props, children: el.children }))
  return el.children.map(textOf).join(' ')
}

const failures = []
function check(name, ok, detail) {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || !detail ? '' : ' :: ' + detail))
  if (!ok) failures.push(name)
}

/* ---------------------------------- boot ---------------------------------- */

const runtime = createRuntime()
const moduleLoads = []
const windowStub = { __ModuleLoader__: { load: (record) => moduleLoads.push(record) } }
const runSource = new Function('window', 'require', 'console', 'fetch', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', source)
runSource(windowStub, () => runtime.React, console, fakeFetch, setTimeout, clearTimeout, setInterval, clearInterval)

const record = moduleLoads[0]
check('module loader called once', moduleLoads.length === 1)
check('module id', record && record.id === 'dsh-websearch-failover')

const plugin = record.factory(() => runtime.React)

const ledger = { strings: null, bound: '', registered: [], selectedPanel: 'unset' }
const ctx = {
  effect(fn) { ledger.dispose = fn() },
  locale: {
    register(ns, defs) { ledger.ns = ns; ledger.strings = defs; return () => {} },
    bind(ns) {
      ledger.bound = ns
      return (key) => {
        const defs = ledger.strings
        return defs && defs.zh && typeof defs.zh[key] === 'string' ? defs.zh[key] : key
      }
    },
  },
  slots: {
    inject(name, factory) { ledger.registered.push(factory()); return () => {} },
    register(meta, component) { return { meta, component } },
  },
  layout: { selectPanel(value) { ledger.selectedPanel = value } },
}

plugin.apply(ctx)

const main = ledger.registered.find((entry) => entry.meta.name === 'main')
const props = main.meta.inject()
runtime.mount(main.component, props)
await runtime.pump()

let tree = runtime.tree()
let text = textOf(tree)

check('mounted and rendered provider labels', ['Tavily', 'Exa', 'Brave', 'Parallel'].every((label) => text.includes(label)), text.slice(0, 400))
check('rendered priority hint', text.includes('顺序即调用优先级'))
check('rendered credits amount + unit', text.includes('800 额度'))
check('rendered usd amount + unit', text.includes('200 美元'))
check('rendered neutral hint for unknown balance', text.includes('未提供余额接口'))
check('rendered tokens amount + unit', text.includes('300 tokens'), text.match(/\d+ tokens/g))
check('rendered key state for selected provider', text.includes('已配置密钥'))
check('rendered stats for selected provider', text.includes('调用次数') && text.includes('12') && text.includes('成功') && text.includes('失败'))
check('rendered local lastUsedAt', text.includes('2026-10-24T10:00:00.000Z'))
check('rendered reset label for selected provider', text.includes('重置'), text.slice(0, 400))
check('rendered period-end reset date', text.includes('2026-11-17') || text.includes('2026-11-16'), text.slice(0, 600))
check('state GET called once', CALLS.filter((c) => c.method === 'GET' && c.url.endsWith('/state')).length === 1)

// bar widths: Tavily 80% (ratio), Exa 25% (200 / max 800), Brave unknown -> no fill
const widths = []
walk(tree, (el) => {
  if (el.props && el.props.style && typeof el.props.style.width === 'string' && el.props.style.width.endsWith('%')) {
    widths.push(el.props.style.width)
  }
})
check('bar width from ratio = 80.00%', widths.includes('80.00%'), JSON.stringify(widths))
check('bar width normalised vs max = 25.00%', widths.includes('25.00%'), JSON.stringify(widths))
check('bar width tokens normalised = 37.50%', widths.includes('37.50%'), JSON.stringify(widths))
check('no NaN width', !widths.some((w) => w.includes('NaN')), JSON.stringify(widths))

function rows() {
  const list = []
  walk(runtime.tree(), (el) => {
    if (el.props && el.props.draggable === true) list.push(el)
  })
  return list
}
function buttons(label) {
  const list = []
  walk(runtime.tree(), (el) => {
    if (el.type === 'button' && textOf(el).trim() === label) list.push(el)
  })
  return list
}
function byAria(list, label) {
  return list.find((el) => String(el.props['aria-label'] || '').startsWith(label))
}
function ariaButtons(label) {
  const list = []
  walk(runtime.tree(), (el) => {
    if (el.type === 'button' && String(el.props['aria-label'] || '') === label) list.push(el)
  })
  return list
}
function buttonByText(label) {
  return buttons(label)[0]
}

const fakeEvent = {
  preventDefault() {},
  stopPropagation() {},
  dataTransfer: { setData() {}, getData: () => '', effectAllowed: '', dropEffect: '' },
}

let list = rows()
check('four draggable rows', list.length === 4, String(list.length))
check('disabled row dimmed', byAria(list, 'Brave').props.style.opacity === 0.55, String(byAria(list, 'Brave').props.style.opacity))

// select Exa: cooldown countdown + never-called lastUsedAt live in the detail pane
byAria(rows(), 'Exa').props.onClick(fakeEvent)
await runtime.pump()
text = textOf(runtime.tree())
check('cooldown countdown in detail', /1m \d+s/.test(text), (text.match(/1m \d+s/g) || []).join(','))
check('cooldown reason in detail', text.includes('quota exhausted'))
check('never-called detail', text.includes('从未调用'))
check('usd detail amount', text.includes('200 美元'))
check('known key detail', text.includes('已配置密钥'))
check('rendered monthly-first reset for exa', text.includes('每月 1 日重置'), text.slice(0, 600))

// arrow reorder: the first row's up button must be disabled
const ups = ariaButtons('上移，提高优先级')
check('four up buttons', ups.length === 4, String(ups.length))
check('first up button disabled', ups[0].props.disabled === true)
ups[1].props.onClick(fakeEvent)
await runtime.pump()
const orderPosts = CALLS.filter((c) => c.method === 'POST' && c.url.endsWith('/order'))
check('arrow reorder POSTs full id array', orderPosts.length === 1 && JSON.stringify(orderPosts[0].body.order) === JSON.stringify(['exa', 'tavily', 'brave', 'parallel']), JSON.stringify(orderPosts.map((p) => p.body)))
text = textOf(runtime.tree())
check('list shows Exa first', text.indexOf('Exa') < text.indexOf('Tavily'))

// drag Brave onto Tavily: [exa,tavily,brave] -> [exa,brave,tavily]
byAria(rows(), 'Brave').props.onDragStart({ ...fakeEvent, dataTransfer: { setData() {}, getData: () => 'brave', effectAllowed: '', dropEffect: '' } })
await runtime.pump()
const tavilyDrop = byAria(rows(), 'Tavily')
tavilyDrop.props.onDragOver({ ...fakeEvent, dataTransfer: { getData: () => 'brave' } })
tavilyDrop.props.onDrop({ ...fakeEvent, dataTransfer: { getData: () => 'brave' } })
await runtime.pump()
const orderPosts2 = CALLS.filter((c) => c.method === 'POST' && c.url.endsWith('/order'))
check('drag reorder POSTs new order', JSON.stringify(orderPosts2[orderPosts2.length - 1].body.order) === JSON.stringify(['exa', 'brave', 'tavily', 'parallel']), JSON.stringify(orderPosts2.map((p) => p.body)))

// failure rollback: server rejects the order, UI must restore the previous rows
failNextOrder = true
ariaButtons('下移，降低优先级')[0].props.onClick(fakeEvent)
await runtime.pump()
text = textOf(runtime.tree())
check('failed order rolled back', text.indexOf('Exa') < text.indexOf('Brave') && text.indexOf('Brave') < text.indexOf('Tavily'))
check('failure surfaces error code', text.includes('order_persist_failed'))

// enable toggle on the disabled provider (detail pane)
byAria(rows(), 'Brave').props.onClick(fakeEvent)
await runtime.pump()
const enableButton = buttonByText('启用')
check('enable button present on disabled provider', Boolean(enableButton))
enableButton.props.onClick(fakeEvent)
await runtime.pump()
const enablePosts = CALLS.filter((c) => c.method === 'POST' && c.url.endsWith('/enable'))
check('enable POST body', enablePosts.length === 1 && enablePosts[0].body.id === 'brave' && enablePosts[0].body.enabled === true, JSON.stringify(enablePosts.map((p) => p.body)))
check('button flips to disable after success', Boolean(buttonByText('停用')))

// refresh all + refresh one
buttonByText('刷新余额').props.onClick(fakeEvent)
await runtime.pump()
const refreshPosts = CALLS.filter((c) => c.method === 'POST' && c.url.endsWith('/refresh'))
check('refresh-all posts an empty body (all providers)', refreshPosts.length === 1 && !refreshPosts[0].body.ids, JSON.stringify(refreshPosts.map((p) => p.body)))
buttonByText('只刷新这一家').props.onClick(fakeEvent)
await runtime.pump()
const refreshPosts2 = CALLS.filter((c) => c.method === 'POST' && c.url.endsWith('/refresh'))
check('refresh-one posts ids array', refreshPosts2.length === 2 && Array.isArray(refreshPosts2[1].body.ids) && refreshPosts2[1].body.ids.length === 1, JSON.stringify(refreshPosts2.map((p) => p.body)))

// a host bundle that predates resetKind: the panel still knows the rule from the kind
byAria(rows(), 'Parallel').props.onClick(fakeEvent)
await runtime.pump()
text = textOf(runtime.tree())
check('kind-based reset fallback when the host sends no resetKind', text.includes('每月免费额度恢复'), text.slice(0, 600))

// back
buttonByText('返回对话').props.onClick(fakeEvent)
check('back selects no panel', ledger.selectedPanel === null, String(ledger.selectedPanel))

console.log('')
console.log(failures.length === 0 ? 'SMOKE OK' : 'SMOKE FAILURES: ' + failures.join(' | '))
process.exit(failures.length === 0 ? 0 : 1)
