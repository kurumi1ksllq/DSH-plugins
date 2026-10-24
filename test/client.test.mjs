import { test } from 'node:test'
import assert from 'node:assert/strict'


/**
 * Browser-half smoke test.
 *
 * `client.js` runs inside the DSH web app against `window.__ModuleLoader__` and
 * React. This test supplies a minimal hooks runtime, a stub module loader and a
 * stub Cordis context, so a broken registration or a render-time exception is
 * caught without opening a browser.
 */

const SNAPSHOT = {
  generatedAt: 1,
  profile: { dir: 'C:/p/desktop', bundles: ['dsh-inventory'] },
  packages: [
    { name: 'dsh-tool-search', version: '0.1.8', declaredBy: ['dependencies', 'bundles'], installed: true, loaded: true, orphan: false },
    { name: 'dsh-websearch-failover', declaredBy: ['bundles'], installed: false, loaded: false, orphan: true },
    { name: 'dsh-doublecheck', version: '0.9.29', declaredBy: ['dependencies'], installed: true, loaded: false, orphan: false, rowless: true },
  ],
  rows: [
    { id: 'inventory', name: 'dsh-inventory', enabled: true, fiberPhase: 'active', group: false },
    { id: 'mcp-officecli', name: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active', group: false, config: { serverName: 'officecli' } },
  ],
  mcp: [
    { entryId: 'mcp-officecli', server: 'officecli', transport: 'stdio', enabled: true, fiberPhase: 'active', status: 'connected', toolCount: 1, toolNames: ['mcp__officecli__officecli'] },
  ],
  skills: [
    {
      name: 'officecli',
      description: 'Office CLI',
      source: 'user-dsh',
      disabled: false,
      edges: [
        { skill: 'officecli', id: 'mcp__officecli__officecli', kind: 'tool', confidence: 'high', evidence: { sources: ['static'], count: 0, sample: 'use mcp__officecli__officecli' } },
        { skill: 'officecli', id: 'officecli', kind: 'mcp-server', confidence: 'medium', evidence: { sources: ['static', 'session'], count: 4, sample: 'officecli docx' } },
      ],
    },
    { name: 'office-docx', description: 'stub', source: 'user-dsh', disabled: true, edges: [] },
  ],
  tools: [
    { name: 'read', descLen: 10, deferred: false, owner: { kind: 'builtin', ref: 'deepseek-harness' } },
    { name: 'tool_search', descLen: 10, deferred: false, owner: { kind: 'plugin', ref: 'dsh-tool-search' } },
    { name: 'mcp__officecli__officecli', descLen: 10, deferred: true, owner: { kind: 'mcp', ref: 'officecli' } },
  ],
  edges: [
    { skill: 'officecli', id: 'mcp__officecli__officecli', kind: 'tool', confidence: 'high', evidence: { sources: ['static'], count: 0, sample: 'x' } },
  ],
  counts: { packages: 2, orphanPackages: 1, rows: 2, mcp: 1, mcpConnected: 1, skills: 2, shadowedSkills: 1, tools: 3, edges: 1 },
  warnings: [{ code: 'orphan-package', message: 'dsh-websearch-failover missing' }],
}

function makeReactRuntime() {
  const stateHooks = []
  const effectHooks = []
  const callbackHooks = []
  let stateCursor = 0
  let effectCursor = 0
  let callbackCursor = 0
  let dirty = false
  let effects = []

  const depsChanged = (prev, next) => {
    if (prev === undefined || next === undefined) return true
    if (prev.length !== next.length) return true
    return next.some((value, index) => !Object.is(value, prev[index]))
  }

  const React = {
    createElement(type, props, ...children) {
      return { type, props: props ?? {}, children: children.flat(Infinity).filter((child) => child !== null && child !== undefined && child !== false) }
    },
    useState(initial) {
      const index = stateCursor
      stateCursor += 1
      if (!(index in stateHooks)) stateHooks[index] = initial
      return [
        stateHooks[index],
        (next) => {
          stateHooks[index] = typeof next === 'function' ? next(stateHooks[index]) : next
          dirty = true
        },
      ]
    },
    useEffect(fn, deps) {
      const index = effectCursor
      effectCursor += 1
      const first = !(index in effectHooks)
      if (first || depsChanged(effectHooks[index], deps)) effects.push(fn)
      effectHooks[index] = deps
    },
    useCallback(fn, deps) {
      const index = callbackCursor
      callbackCursor += 1
      const prev = callbackHooks[index]
      if (prev !== undefined && !depsChanged(prev.deps, deps)) return prev.fn
      callbackHooks[index] = { fn, deps }
      return fn
    },
  }
  const render = (component, props) => {
    let tree
    for (let round = 0; round < 8; round += 1) {
      stateCursor = 0
      effectCursor = 0
      callbackCursor = 0
      dirty = false
      effects = []
      tree = component(props)
      for (const fn of effects) fn()
      if (!dirty) break
    }
    return tree
  }
  return { React, render }
}

function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  return textOf(node.children)
}

/** Depth-first search for a node matching a predicate. */
function findNode(node, predicate) {
  if (node === null || node === undefined || typeof node !== 'object') return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findNode(child, predicate)
      if (hit !== null) return hit
    }
    return null
  }
  if (predicate(node)) return node
  for (const child of node.children ?? []) {
    const hit = findNode(child, predicate)
    if (hit !== null) return hit
  }
  return null
}

/** Expand function components into their rendered element tree. */
function resolveTree(node) {
  if (node === null || node === undefined || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(resolveTree)
  if (typeof node.type === 'function') return resolveTree(node.type({ ...node.props, children: node.children }))
  return { ...node, children: (node.children ?? []).map(resolveTree) }
}

/** Depth-first walk with parent tracking. */
function eachNode(node, visit, parent = null) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) eachNode(child, visit, parent)
    return
  }
  visit(node, parent)
  for (const child of node.children ?? []) eachNode(child, visit, node)
}

/** The direct parent node of `target`, or null. */
function findParent(node, target) {
  let hit = null
  eachNode(node, (candidate, parent) => {
    if (hit === null && candidate === target) hit = parent
  })
  return hit
}

test('client registers a sidebar entry plus a main panel and renders both states', async () => {
  const { React, render } = makeReactRuntime()
  let loaded = null
  globalThis.window = {
    __ModuleLoader__: {
      load(definition) {
        loaded = definition
      },
    },
  }

  await import(new URL('../client.js', import.meta.url).href)
  assert.ok(loaded, 'client module did not call __ModuleLoader__.load')
  assert.equal(loaded.id, 'dsh-inventory')

  const module = loaded.factory((specifier) => {
    assert.equal(specifier, 'react')
    return React
  })
  assert.deepEqual(module.inject, ['slots', 'locale', 'layout'])

  const dictionary = {}
  const injections = []
  const registrations = []
  const selected = []
  const ctx = {
    effect(fn) {
      return fn()
    },
    locale: {
      register(namespace, dict) {
        Object.assign(dictionary, dict.zh)
        return () => {}
      },
      bind() {
        return (key) => dictionary[key] ?? key
      },
    },
    layout: {
      selectPanel(value) {
        selected.push(value)
      },
    },
    slots: {
      inject(name, factory) {
        injections.push({ name, factory })
      },
      register(spec, component) {
        registrations.push({ spec, component })
        return () => {}
      },
    },
  }
  module.apply(ctx)

  // A sidebar entry and its main panel, keyed together so selecting one routes
  // the shell to the other.
  assert.equal(injections.length, 2)
  assert.deepEqual(injections.map((injection) => injection.name), ['sidebar.panellist', 'main'])
  for (const injection of injections) injection.factory()
  assert.equal(registrations.length, 2)

  const sidebar = registrations.find((entry) => entry.spec.name === 'sidebar.panellist')
  const main = registrations.find((entry) => entry.spec.name === 'main')
  assert.ok(sidebar, 'sidebar entry not registered')
  assert.ok(main, 'main panel not registered')
  assert.equal(sidebar.spec.id, 'inventory')
  assert.equal(sidebar.spec.label(), '安装总览')
  assert.equal(main.spec.key, 'inventory')

  const injected = main.spec.inject()
  assert.equal(typeof injected.t, 'function')
  assert.equal(typeof injected.back, 'function')
  // Back returns to the conversation instead of leaving the shell on a dead panel.
  injected.back()
  assert.deepEqual(selected, [null])

  // loading state: no fetch has resolved yet.
  const requested = []
  globalThis.fetch = async (url) => {
    requested.push(String(url))
    return { ok: true, json: async () => SNAPSHOT }
  }
  const loadingTree = render(main.component, injected)
  assert.match(textOf(loadingTree), /正在汇总|loading/)
  // First load rides the host's 15s cache; only an explicit refresh forces recompute.
  assert.equal(requested.length, 1)
  assert.doesNotMatch(requested[0], /refresh=1/)

  // ready state: the effect's fetch resolves, then a re-render picks up data.
  await new Promise((resolve) => setTimeout(resolve, 0))
  const readyTree = render(main.component, injected)
  const text = textOf(readyTree)
  assert.match(text, /dsh-websearch-failover/)
  assert.match(text, /officecli/)
  assert.match(text, /未安装|orphan|missing/)
  assert.match(text, /dsh-websearch-failover missing/)
  // A bundle composed of sub-rows says so instead of implying it never loaded.
  const noRowBadge = findNode(readyTree, (node) => node.props?.label === '无自身加载行')
  assert.ok(noRowBadge, 'row-less package has no explanatory badge')

  // The refresh button is the only path that bypasses the cache.
  const button = findNode(readyTree, (node) => node.type === 'button' && textOf(node) === '刷新')
  assert.ok(button, 'refresh button not found')
  button.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.match(requested[requested.length - 1], /refresh=1/)

  // An MCP row expands into the tools that server contributes (grouped by server).
  const mcpToggle = findNode(readyTree, (node) => textOf(node).includes('officecli') && typeof node.props?.onClick === 'function')
  assert.ok(mcpToggle, 'MCP row is not expandable')
  mcpToggle.props.onClick()
  const expandedTree = render(main.component, injected)
  assert.match(textOf(expandedTree), /mcp__officecli__officecli/)

  // Search filters every section, not just the skills list.
  const input = findNode(expandedTree, (node) => node.type === 'input')
  assert.ok(input, 'search input not found')
  input.props.onChange({ target: { value: 'dsh-tool-search' } })
  const filteredTree = render(main.component, injected)
  const filteredText = textOf(filteredTree)
  assert.match(filteredText, /dsh-tool-search/)
  // The skill card and the orphan package row are filtered out; the warnings
  // block is intentionally unfiltered, so it still names the missing package.
  assert.doesNotMatch(filteredText, /Office CLI/)
  assert.doesNotMatch(filteredText, /dsh-websearch-failover 0|orphan package badge/)
})

test('panel rows stay whole and aligned once a lot is expanded', async () => {
  const { React, render } = makeReactRuntime()
  let loaded = null
  globalThis.window = { __ModuleLoader__: { load: (definition) => (loaded = definition) } }
  await import(new URL('../client.js?v=layout-case', import.meta.url).href)
  const module = loaded.factory(() => React)
  const dictionary = {}
  const injections = []
  const registrations = []
  module.apply({
    effect: (fn) => fn(),
    locale: { register: (ns, dict) => Object.assign(dictionary, dict.zh), bind: () => (key) => dictionary[key] ?? key },
    layout: { selectPanel() {} },
    slots: {
      inject: (name, factory) => injections.push({ name, factory }),
      register: (spec, component) => registrations.push({ spec, component }),
    },
  })
  for (const injection of injections) injection.factory()
  const main = registrations.find((entry) => entry.spec.name === 'main')
  assert.ok(main, 'main panel not registered')

  globalThis.fetch = async () => ({ ok: true, json: async () => SNAPSHOT })
  const injected = main.spec.inject()
  render(main.component, injected)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const tree = resolveTree(render(main.component, injected))

  // The panel itself is the scroll container.
  const root = findNode(tree, (node) => node.props?.style?.overflowY === 'auto')
  assert.ok(root, 'panel root is not the scroll container')

  // A column flex parent shrinks its children by default. A section that shrinks
  // below its content clips it away (overflow: hidden) and the scrollbar never
  // appears — the reported "expanded everything, cannot scroll" failure.
  for (const child of root.children) {
    assert.equal(child.props.style.flexShrink, 0, `root child ${String(child.type)} may shrink and clip its own rows`)
  }

  // Baseline alignment hangs a badge below the text beside it (the badge box is
  // taller than a text line), which reads as misaligned rows.
  eachNode(tree, (node) => {
    assert.notEqual(node.props?.style?.alignItems, 'baseline', `baseline alignment on ${String(node.type)}`)
  })

  // A package without a version must not render a zero-size span: it still eats
  // a gap slot, so rows drift a few pixels apart from their neighbours.
  const nameSpan = findNode(tree, (node) => node.type === 'span' && textOf(node) === 'dsh-websearch-failover')
  assert.ok(nameSpan, 'orphan package row not found')
  const row = findParent(tree, nameSpan)
  assert.ok(row, 'package row not found')
  const emptySpans = row.children.filter((child) => child.type === 'span' && textOf(child) === '')
  assert.equal(emptySpans.length, 0, 'empty version span still occupies a gap slot')
})

test('client renders an error box and a retry button when the snapshot fails', async () => {
  const { React, render } = makeReactRuntime()
  let loaded = null
  globalThis.window = { __ModuleLoader__: { load: (definition) => (loaded = definition) } }
  await import(new URL('../client.js?v=error-case', import.meta.url).href)
  const module = loaded.factory(() => React)
  const dictionary = {}
  const injections = []
  const registrations = []
  module.apply({
    effect: (fn) => fn(),
    locale: { register: (ns, dict) => Object.assign(dictionary, dict.zh), bind: () => (key) => dictionary[key] ?? key },
    layout: { selectPanel() {} },
    slots: {
      inject: (name, factory) => injections.push({ name, factory }),
      register: (spec, component) => registrations.push({ spec, component }),
    },
  })
  for (const injection of injections) injection.factory()
  const main = registrations.find((entry) => entry.spec.name === 'main')
  assert.ok(main, 'main panel not registered')

  globalThis.fetch = async () => {
    throw new Error('boom')
  }
  const injected = main.spec.inject()
  render(main.component, injected)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const tree = render(main.component, injected)
  assert.match(textOf(tree), /boom/)
  assert.match(textOf(tree), /重试|retry/)
})
