import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'


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
  assert.equal(sidebar.spec.label(), '工具管理')
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
  const button = findNode(readyTree, (node) => node.type === 'button' && (node.props?.['aria-label'] === '刷新' || textOf(node) === '刷新'))
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

/**
 * Theme-token guard.
 *
 * --dsw-alias-brand-primary is a *contrast* colour in this design system:
 * #f9fafb in the dark theme, #1f2328 in the light one. Painting a control with
 * it and writing white on top produced a white pill with white text, which
 * showed up as "the selected tab turns all white". Fills use fill tokens.
 */
test('the panel never paints with the contrast token', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  assert.equal(
    source.includes('--dsw-alias-brand-primary'),
    false,
    'brand-primary is a contrast colour, not a fill: use button-info-fill / ghost-active-fill',
  )
})

/**
 * Snapshot for the two-level workspace navigation tests. One workspace that
 * declares `officecli` (which is also globally mounted), plus:
 *   codegraph  — installed, not declared, not global → switchable on
 *   context7   — globally mounted, not declared → on but locked
 *   proj-skill — linked into the workspace → switchable off
 *   copied-skill — hand-copied directory (linked:false) → on but locked
 *   runtime-skill — registered at runtime: never listed, never counted
 */
function workspaceSnapshot() {
  return {
    ...SNAPSHOT,
    mcp: [
      { entryId: 'mcp-officecli', server: 'officecli', transport: 'stdio', status: 'connected', toolCount: 1, toolNames: [] },
      { entryId: 'mcp-codegraph', server: 'codegraph', transport: 'stdio', command: 'codegraph.exe', status: 'connected', toolCount: 2, toolNames: [] },
      { entryId: 'mcp-context7', server: 'context7', transport: 'http', url: 'https://context7.example/mcp', status: 'connected', toolCount: 2, toolNames: [] },
    ],
    skills: [
      { name: 'codegraph-explore', description: 'graph queries', source: 'user-dsh', edges: [] },
      { name: 'proj-skill', description: 'project skill', source: 'user-dsh', edges: [] },
      { name: 'copied-skill', description: 'hand copied', source: 'project-dsh', edges: [] },
      { name: 'runtime-skill', description: 'runtime only', source: 'runtime', edges: [] },
    ],
    workspaceRegistryAvailable: true,
    globalMcp: ['officecli', 'context7'],
    gateServerNameSuffix: '-ws',
    defaultWorkspaceId: 'ws-1',
    workspaces: [
      {
        id: 'ws-1',
        title: 'Demo Workspace',
        path: 'D:/demo',
        available: true,
        default: true,
        mcp: {
          status: 'ok',
          file: 'D:/demo/.dsh/mcp.json',
          servers: [{ name: 'officecli', mountedAs: 'officecli-ws', transport: 'stdio', detail: 'officecli.exe' }],
        },
        skills: [
          {
            source: 'project-dsh',
            dir: 'D:/demo/.dsh/skills',
            rank: 100,
            exists: true,
            // `linked` is the host's lstat verdict: only links this page created
            // may be switched off; a hand-copied directory must not be.
            skills: [
              { name: 'proj-skill', description: 'project skill', shadowed: false, linked: true },
              { name: 'copied-skill', description: 'hand copied', shadowed: false, linked: false },
            ],
            diagnostics: [],
          },
        ],
        counts: { declared: 1, projectSkills: 2, sharedSkills: 0 },
      },
      {
        id: 'ws-2',
        title: 'Second Workspace',
        path: 'D:/second',
        available: true,
        mcp: { status: 'missing', servers: [] },
        skills: [],
        counts: { declared: 0, projectSkills: 0, sharedSkills: 5 },
      },
    ],
  }
}

/** Boot the panel against `snapshot` and return its render helpers. */
async function bootPanel(snapshot, { version = 'nav-case', post } = {}) {
  const { React, render } = makeReactRuntime()
  let loaded = null
  globalThis.window = { __ModuleLoader__: { load: (definition) => (loaded = definition) } }
  await import(new URL(`../client.js?v=${version}`, import.meta.url).href)
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

  const calls = []
  const state = { post: post ?? (async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) })) }
  globalThis.fetch = async (url, options = {}) => {
    const method = String(options.method ?? 'GET').toUpperCase()
    calls.push({ url: String(url), method, body: options.body })
    if (method === 'POST') return state.post(url, options)
    return { ok: true, status: 200, json: async () => snapshot }
  }

  const injected = main.spec.inject()
  render(main.component, injected)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const tree = () => resolveTree(render(main.component, injected))
  return { calls, tree, setPost: (impl) => (state.post = impl) }
}

/** The row whose own name span is exactly `name`. */
function rowOf(node, name) {
  return findNode(node, (candidate) => {
    if (candidate.props?.style?.minHeight !== '44px') return false
    return findNode(candidate, (child) => child.type === 'span' && textOf(child) === name) !== null
  })
}

/** The `role="switch"` button inside a row. */
function switchIn(row) {
  return (row?.children ?? []).find((child) => child.type === 'button' && child.props?.role === 'switch') ?? null
}

/** Every switch in the tree. */
function switchesIn(tree) {
  const found = []
  eachNode(tree, (node) => {
    if (node.props?.role === 'switch') found.push(node)
  })
  return found
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Two-level navigation: the 工作区 tab lists workspaces as cards (no rows, no
 * switches), a card opens the detail page, and the back link returns to the
 * list. Folding is gone — the list is short because it only holds titles.
 */
test('workspace tab lists workspaces, opens a detail page, and goes back', async () => {
  const { tree } = await bootPanel(workspaceSnapshot(), { version: 'nav-case' })

  // 总览 is the default tab: its MCP rows carry the global switch now. The
  // workspace list below must still render no switches.
  const overviewSwitches = switchesIn(tree())
  assert.ok(overviewSwitches.length > 0, 'overview must render switches')
  for (const node of overviewSwitches) {
    assert.equal(typeof node.props['aria-label'], 'string', 'every overview switch must be named after its row')
  }

  findNode(tree(), (node) => node.type === 'button' && textOf(node) === '工作区').props.onClick()

  let current = tree()
  assert.match(textOf(current), /Demo Workspace/, 'workspace card missing')
  assert.match(textOf(current), /D:\/demo/, 'workspace path missing from the card')
  assert.match(textOf(current), /MCP 1/, 'declared MCP count missing')
  assert.match(textOf(current), /技能 2\/3/, 'the card must read like the page: how many are on, out of all')
  // The list is a list: no rows and no switches leak into it.
  assert.equal(findNode(current, (node) => node.props?.role === 'switch'), null, 'the list must not render switches')
  assert.doesNotMatch(textOf(current), /officecli/, 'the list must not render MCP rows')

  // The whole card is the click target.
  findNode(current, (node) => node.props?.role === 'button' && textOf(node).includes('Demo Workspace')).props.onClick()

  current = tree()
  assert.match(textOf(current), /MCP 服务器/, 'detail page has no MCP section')
  assert.match(textOf(current), /技能/, 'detail page has no skills section')
  assert.match(textOf(current), /officecli/)
  assert.match(textOf(current), /proj-skill/)
  assert.ok(
    findNode(current, (node) => node.type === 'button' && textOf(node).includes('工作区列表')),
    'detail page has no back link',
  )
  assert.equal(switchesIn(current).length > 0, true, 'detail rows have no switches')

  // Back to the list.
  findNode(current, (node) => node.type === 'button' && textOf(node).includes('工作区列表')).props.onClick()
  current = tree()
  assert.match(textOf(current), /Demo Workspace/)
  assert.equal(findNode(current, (node) => node.props?.role === 'switch'), null, 'back must return to the list')
})

/**
 * Switch semantics. The panel must post the documented contract to
 * `/inventory/workspace`, force a snapshot reload afterwards (the host drops its
 * cache on write), keep every switch disabled while one request is in flight,
 * and leave locked rows (global MCP, hand-copied skill, runtime skill) alone.
 */
test('workspace detail switches POST the contract and respect locked rows', async () => {
  const panel = await bootPanel(workspaceSnapshot(), { version: 'switch-case' })
  const { tree, calls } = panel

  findNode(tree(), (node) => node.type === 'button' && textOf(node) === '工作区').props.onClick()
  findNode(tree(), (node) => node.props?.role === 'button' && textOf(node).includes('Demo Workspace')).props.onClick()

  let current = tree()
  // Switchable rows carry a switch named after the row; locked rows state why
  // instead of offering a disabled switch that still reads as "on".
  for (const name of ['officecli', 'codegraph', 'proj-skill']) {
    const row = rowOf(current, name)
    assert.ok(row, `row for ${name} is missing`)
    assert.ok(switchIn(row), `row for ${name} has no switch`)
    assert.equal(switchIn(row).props['aria-label'], name, 'the switch must be named after its row')
  }
  for (const name of ['context7', 'copied-skill']) {
    const row = rowOf(current, name)
    assert.ok(row, `row for ${name} is missing`)
    assert.equal(switchIn(row), null, `row for ${name} must not offer a switch`)
  }
  // A runtime registration has no directory and nothing on disk: it is not a
  // skill this page can show or count.
  assert.equal(rowOf(current, 'runtime-skill'), null, 'runtime skills must never be listed')

  // Global and not declared: already available to every workspace, nothing to
  // switch off — the row says so instead of relying on a disabled state.
  const globalRow = rowOf(current, 'context7')
  assert.match(textOf(globalRow), /全局已挂载/, 'a global server must be flagged')
  assert.match(textOf(globalRow), /对所有工作区生效/, 'a global server must say why it is locked')

  // Declared: on and switchable (it is also global, so closing removes the
  // duplicate mount).
  const declaredRow = rowOf(current, 'officecli')
  assert.equal(switchIn(declaredRow).props['aria-checked'], 'true')
  assert.equal(switchIn(declaredRow).props.disabled, false, 'a declared server must be switchable')

  // Installed, not declared, not global: off and switchable.
  assert.equal(switchIn(rowOf(current, 'codegraph')).props['aria-checked'], 'false')
  assert.equal(switchIn(rowOf(current, 'codegraph')).props.disabled, false)

  // Hand-copied directory: assigned but not ours to unlink.
  const copiedRow = rowOf(current, 'copied-skill')
  assert.equal(switchIn(copiedRow), null, 'a non-link skill must not offer a switch')
  assert.match(textOf(copiedRow), /非本页链接/)
  assert.match(textOf(copiedRow), /手工复制/)

  // Runtime registration: no directory, so it cannot be switched on — and it is
  // not listed at all.
  assert.equal(rowOf(current, 'runtime-skill'), null, 'a runtime skill must not be listed')

  // Switching an unassigned server on: POST, then a forced snapshot reload.
  let release
  panel.setPost(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ ok: true, status: 200, json: async () => ({ ok: true }) })
      }),
  )
  const getsBefore = calls.filter((call) => call.method === 'GET').length
  switchIn(rowOf(current, 'codegraph')).props.onClick()
  await tick()

  current = tree()
  const allSwitches = switchesIn(current)
  assert.ok(allSwitches.length > 0, 'no switches rendered')
  for (const node of allSwitches) {
    assert.equal(node.props.disabled, true, 'every switch must be disabled while one request is in flight')
  }

  const addPost = calls.find((call) => call.method === 'POST')
  assert.ok(addPost, 'no POST was issued')
  assert.equal(addPost.url, '/inventory/workspace')
  assert.deepEqual(JSON.parse(addPost.body), { workspace: 'D:/demo', kind: 'mcp', action: 'add', name: 'codegraph' })

  release()
  await tick()
  await tick()
  assert.ok(
    calls
      .filter((call) => call.method === 'GET')
      .slice(getsBefore)
      .some((call) => call.url.includes('refresh=1')),
    'a successful write must force a snapshot reload',
  )

  // Switching a declared server off sends action: remove.
  panel.setPost(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }))
  current = tree()
  switchIn(rowOf(current, 'officecli')).props.onClick()
  await tick()
  const posts = calls.filter((call) => call.method === 'POST')
  assert.equal(posts.length, 2, 'one POST per switch click')
  assert.deepEqual(JSON.parse(posts[1].body), { workspace: 'D:/demo', kind: 'mcp', action: 'remove', name: 'officecli' })

  // A rejected write shows the host's message in a dismissible bar.
  panel.setPost(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, error: '写不进去' }) }))
  current = tree()
  switchIn(rowOf(current, 'codegraph')).props.onClick()
  await tick()
  current = tree()
  const failedText = textOf(current)
  assert.match(failedText, /写不进去/, 'host error message is not rendered')
  assert.match(failedText, /操作失败/, 'error bar has no heading')
  const dismiss = findNode(current, (node) => node.type === 'button' && textOf(node) === '关闭')
  assert.ok(dismiss, 'error bar is not dismissible')
  dismiss.props.onClick()
  assert.doesNotMatch(textOf(tree()), /写不进去/, 'dismissing the error bar must clear it')
})

/**
 * Layout contract on the detail page: the panel is the only scroll container, its
 * children never shrink, rows separate with a hairline (no nested boxes), and the
 * switch is a pill control rather than a container.
 */
test('workspace detail keeps rows on hairlines and the panel scrollable', async () => {
  const { tree } = await bootPanel(workspaceSnapshot(), { version: 'hierarchy-case' })

  findNode(tree(), (node) => node.type === 'button' && textOf(node) === '工作区').props.onClick()
  findNode(tree(), (node) => node.props?.role === 'button' && textOf(node).includes('Demo Workspace')).props.onClick()

  const current = tree()
  // The panel itself is the scroll container.
  const root = findNode(current, (node) => node.props?.style?.overflowY === 'auto')
  assert.ok(root, 'panel root is not the scroll container')
  for (const child of root.children) {
    assert.equal(child.props.style.flexShrink, 0, `root child ${String(child.type)} may shrink and clip its own rows`)
  }

  // Baseline alignment hangs a badge below the text beside it.
  eachNode(current, (node) => {
    assert.notEqual(node.props?.style?.alignItems, 'baseline', `baseline alignment on ${String(node.type)}`)
  })

  // Inside a grouped card, nesting is rows and controls only: no second bordered
  // container. Pills (badges, switches) are controls, not containers.
  const cards = []
  eachNode(current, (node) => {
    const style = node.props?.style
    if (style?.borderRadius === '14px' && typeof style?.border === 'string') cards.push(node)
  })
  assert.ok(cards.length >= 2, 'detail page must render both grouped cards')
  for (const card of cards) {
    let nestedBoxes = 0
    for (const child of card.children) {
      eachNode(child, (node) => {
        const style = node.props?.style
        if (style === undefined || style === null) return
        if (typeof style.border === 'string' && style.border !== 'none' && style.borderRadius !== '999px' && style.height !== '31px') nestedBoxes += 1
      })
    }
    assert.equal(nestedBoxes, 0, `no bordered container may nest inside a grouped card, found ${nestedBoxes}`)
  }

  // The switch is a 51×31 iOS track with a round knob.
  const control = switchIn(rowOf(current, 'codegraph'))
  assert.ok(control, 'switch missing on the detail page')
  assert.equal(control.props.style.borderRadius, '999px')
  assert.equal(control.props.style.width, '51px')
  assert.equal(control.props.style.height, '31px')

  // Rows must separate with a hairline, never a box.
  let boxedRows = 0
  eachNode(current, (node) => {
    const style = node.props?.style
    if (style?.borderBottom === undefined && typeof style?.border === 'string' && style?.padding === '6px 8px') {
      boxedRows += 1
    }
  })
  assert.equal(boxedRows, 0, 'list rows must not be drawn as boxes')
})

test('expandable rows answer the keyboard and expose aria-expanded', async () => {
  const { tree } = await bootPanel(SNAPSHOT, { version: 'keyboard-case' })
  let current = tree()

  // A native button: the browser fires click on Enter/Space, so the panel must
  // not also handle the key itself (that would toggle twice).
  const header = findNode(
    current,
    (node) => node.type === 'button' && node.props?.['aria-expanded'] !== undefined && textOf(node).includes('插件包'),
  )
  assert.ok(header, 'no expandable section header')
  assert.equal(header.props['aria-expanded'], 'true')
  assert.equal(header.props.onKeyDown, undefined, 'a native button must not double-handle Enter')
  header.props.onClick()
  current = tree()
  const collapsed = findNode(
    current,
    (node) => node.type === 'button' && node.props?.['aria-expanded'] !== undefined && textOf(node).includes('插件包'),
  )
  assert.equal(collapsed.props['aria-expanded'], 'false', 'the header must collapse')

  // The MCP row is a div with role=button, so it has to handle Enter itself.
  const row = findNode(
    current,
    (node) => node.props?.role === 'button' && node.props?.['aria-expanded'] === 'false' && textOf(node).includes('officecli'),
  )
  assert.ok(row, 'MCP row is not an expandable button')
  assert.equal(typeof row.props.onKeyDown, 'function', 'a div row must handle its own keys')
  row.props.onKeyDown({ key: 'Enter', preventDefault() {} })
  assert.match(textOf(tree()), /mcp__officecli__officecli/, 'Enter must expand the row')
})

test('workspace detail search narrows rows and keeps the section headers', async () => {
  const { tree } = await bootPanel(workspaceSnapshot(), { version: 'detail-search-case' })
  findNode(tree(), (node) => node.type === 'button' && textOf(node) === '工作区').props.onClick()
  findNode(tree(), (node) => node.props?.role === 'button' && textOf(node).includes('Demo Workspace')).props.onClick()

  let current = tree()
  const input = findNode(current, (node) => node.type === 'input' && node.props?.['aria-label'] === '搜索 MCP 与技能')
  assert.ok(input, 'detail page has no search field')
  input.props.onChange({ target: { value: 'proj' } })

  current = tree()
  const text = textOf(current)
  assert.match(text, /proj-skill/)
  assert.doesNotMatch(text, /codegraph/)
  assert.match(text, /MCP 服务器/, 'filtering must not drop the section headers')
})

test('the workspace card reads 已开启/总数 for the same set the detail page lists', async () => {
  const { tree } = await bootPanel(workspaceSnapshot(), { version: 'shared-count-case' })
  findNode(tree(), (node) => node.type === 'button' && textOf(node) === '工作区').props.onClick()
  // Both cards report "on/total" over the merged set (installed ∪ own), even a
  // workspace whose own roots are empty: shared skills are not reported as zero.
  const cards = []
  eachNode(tree(), (node) => {
    if (node.props?.role === 'button' && /Workspace/.test(textOf(node))) cards.push(textOf(node))
  })
  assert.equal(cards.length, 2, 'workspace cards missing')
  for (const card of cards) assert.match(card, /技能 \d\/3/, `card does not read on/total: ${card}`)
  // Demo links two of the three; the fixture's installed skills carry no `global`
  // flag, so the second workspace has nothing switched on.
  assert.match(cards.find((card) => card.includes('Demo')), /技能 2\/3/)
  assert.match(cards.find((card) => card.includes('Second')), /技能 0\/3/)

  const input = findNode(tree(), (node) => node.type === 'input' && node.props?.['aria-label'] === '搜索工作区')
  assert.ok(input, 'the workspace list has no search field')
  input.props.onChange({ target: { value: 'second' } })
  const filtered = textOf(tree())
  assert.match(filtered, /Second Workspace/)
  assert.doesNotMatch(filtered, /Demo Workspace/, 'the list filter must narrow the rows')
})

// ---- global MCP / skill switches on the overview -------------------------

function mcpRow(server, overrides = {}) {
  return {
    entryId: `mcp-${server}`,
    server,
    transport: 'stdio',
    status: 'connected',
    toolCount: 1,
    toolNames: [],
    enabled: true,
    toggleable: true,
    disabledReason: null,
    ...overrides,
  }
}

function skillRow(name, overrides = {}) {
  return {
    name,
    description: `${name} fixture`,
    source: 'user-dsh',
    disabled: false,
    global: true,
    toggleable: true,
    disabledReason: null,
    edges: [],
    ...overrides,
  }
}

/** Overview fixture: unsorted, half enabled, with the global toggle capability on. */
function toggleSnapshot({ mcp, skills, globalToggle } = {}) {
  return {
    ...SNAPSHOT,
    globalToggle: globalToggle ?? { mcp: true, skill: true },
    mcp: mcp ?? [
      mcpRow('zeta', { enabled: false }),
      mcpRow('alpha', { enabled: true }),
      mcpRow('beta', { enabled: false }),
      mcpRow('gamma', { enabled: true }),
    ],
    skills: skills ?? [
      skillRow('s-zulu', { disabled: false }),
      skillRow('s-alpha', { disabled: true }),
      skillRow('s-bravo', { disabled: false }),
      skillRow('s-yankee', { disabled: true }),
    ],
  }
}

/** The switch named after `label`, anywhere in the tree. */
function switchNamed(tree, label) {
  return findNode(tree, (node) => node.props?.role === 'switch' && node.props['aria-label'] === label)
}

/** Open the 技能 section on the overview and return the re-rendered tree. */
function openSkillSection(panel) {
  const header = findNode(
    panel.tree(),
    (node) => node.type === 'button' && node.props?.['aria-expanded'] !== undefined && textOf(node).includes('技能'),
  )
  assert.ok(header, 'skills section header missing')
  header.props.onClick()
  return panel.tree()
}

test('overview sorts enabled MCP servers and skills above disabled ones', async () => {
  const panel = await bootPanel(toggleSnapshot(), { version: 'global-sort-case' })
  const current = openSkillSection(panel)

  const labels = switchesIn(current).map((node) => node.props['aria-label'])
  assert.deepEqual(labels, [
    // enabled first (alpha, gamma), then disabled (beta, zeta); name ascending inside each group
    'alpha',
    'gamma',
    'beta',
    'zeta',
    // skills: model-invocable first (s-bravo, s-zulu), then shadowed (s-alpha, s-yankee)
    's-bravo',
    's-zulu',
    's-alpha',
    's-yankee',
  ])
})

test('one skill hides from its own row and the chip in the controls brings it back', async () => {
  const panel = await bootPanel(toggleSnapshot(), { version: 'hide-skill-case' })
  openSkillSection(panel)

  const hideButton = (name) =>
    findNode(panel.tree(), (node) => node.type === 'button' && node.props?.['aria-label'] === `隐藏此技能 ${name}`)
  const rowOfSkill = (name) => findNode(panel.tree(), (node) => node.props?.role === 'switch' && node.props['aria-label'] === name)

  assert.ok(rowOfSkill('s-zulu'), 's-zulu row missing before hiding')
  hideButton('s-zulu').props.onClick({ stopPropagation() {} })

  // Only that row is gone; its neighbour and the section itself stay.
  assert.equal(rowOfSkill('s-zulu'), null, 'the hidden skill is still listed')
  assert.ok(rowOfSkill('s-bravo'), 'hiding one skill must not drop the others')
  assert.ok(findNode(panel.tree(), (node) => node.type === 'button' && node.props?.['aria-expanded'] !== undefined && textOf(node).includes('技能')), 'the section must stay')

  // The chip says how many are hidden and reveals them, dimmed with an unhide button.
  const chip = findNode(panel.tree(), (node) => node.type === 'button' && textOf(node) === '显示已隐藏 1')
  assert.ok(chip, 'the controls do not offer to reveal hidden skills')
  chip.props.onClick()
  assert.ok(rowOfSkill('s-zulu'), 'revealing must list the hidden skill again')
  const unhide = findNode(panel.tree(), (node) => node.type === 'button' && node.props?.['aria-label'] === '取消隐藏 s-zulu')
  assert.ok(unhide, 'a revealed row has no unhide button')

  unhide.props.onClick({ stopPropagation() {} })
  assert.equal(findNode(panel.tree(), (node) => node.type === 'button' && textOf(node) === '显示已隐藏 1'), null, 'the chip must go once nothing is hidden')
  assert.ok(rowOfSkill('s-zulu'), 'unhiding must keep the row')
})

test('a skill hidden on the overview is hidden on the workspace page too', async () => {
  const panel = await bootPanel(workspaceSnapshot(), { version: 'hide-skill-workspace-case' })
  findNode(panel.tree(), (node) => node.type === 'button' && textOf(node) === '工作区').props.onClick()
  findNode(panel.tree(), (node) => node.props?.role === 'button' && textOf(node).includes('Demo Workspace')).props.onClick()

  const detailRow = (name) => findNode(panel.tree(), (node) => node.props?.role === 'switch' && node.props['aria-label'] === name)
  assert.ok(detailRow('proj-skill'), 'proj-skill row missing on the detail page')
  const hide = findNode(panel.tree(), (node) => node.type === 'button' && node.props?.['aria-label'] === '隐藏此技能 proj-skill')
  assert.ok(hide, 'the detail page has no per-skill hide button')
  hide.props.onClick({ stopPropagation() {} })
  assert.equal(detailRow('proj-skill'), null, 'the hidden skill is still listed on the detail page')

  // Same hidden set: the overview chip counts it too.
  findNode(panel.tree(), (node) => node.type === 'button' && textOf(node).includes('工作区列表')).props.onClick()
  assert.ok(findNode(panel.tree(), (node) => node.type === 'button' && textOf(node) === '显示已隐藏 1'), 'the hidden set is not shared with the overview')
})

test('runtime-registered skills are never listed or counted', async () => {
  const snapshot = toggleSnapshot()
  snapshot.skills = [...snapshot.skills, { name: 'bsk-browser', description: 'runtime registration', source: 'runtime', edges: [] }]
  const panel = await bootPanel(snapshot, { version: 'runtime-skill-case' })
  openSkillSection(panel)
  assert.doesNotMatch(textOf(panel.tree()), /bsk-browser/, 'a runtime skill must not be listed')
  // Stats card: only the four disk fixtures count.
  assert.ok(findNode(panel.tree(), (node) => textOf(node) === '4 技能'), 'the stats card must not count runtime skills')
})

test('the workspace card and the detail page report the same skill count', async () => {
  const panel = await bootPanel(workspaceSnapshot(), { version: 'count-match-case' })
  findNode(panel.tree(), (node) => node.type === 'button' && textOf(node) === '工作区').props.onClick()
  assert.match(textOf(panel.tree()), /技能 2\/3/, 'the card must read like the page: how many are on, out of all')

  findNode(panel.tree(), (node) => node.props?.role === 'button' && textOf(node).includes('Demo Workspace')).props.onClick()
  const skillsHeader = findNode(
    panel.tree(),
    (node) => node.type === 'button' && node.props?.['aria-expanded'] !== undefined && textOf(node).trim().startsWith('技能'),
  )
  assert.ok(skillsHeader, 'skills section header missing')
  assert.match(textOf(skillsHeader), /3 项/, 'the section must count what the card counted')
  assert.match(textOf(skillsHeader), /已开启 2\/3/)
})

test('overview MCP switch posts the inverted state to /inventory/global', async () => {
  const panel = await bootPanel(toggleSnapshot(), { version: 'global-mcp-post-case' })

  switchNamed(panel.tree(), 'alpha').props.onClick({ stopPropagation() {} })
  await tick()
  await tick()
  switchNamed(panel.tree(), 'zeta').props.onClick({ stopPropagation() {} })
  await tick()
  await tick()

  const posts = panel.calls.filter((call) => call.method === 'POST')
  assert.equal(posts.length, 2, 'one POST per switch click')
  for (const post of posts) assert.equal(post.url, '/inventory/global')
  assert.deepEqual(JSON.parse(posts[0].body), { kind: 'mcp', name: 'alpha', enabled: false })
  assert.deepEqual(JSON.parse(posts[1].body), { kind: 'mcp', name: 'zeta', enabled: true })
})

test('overview skill switch posts enabled:true for a shadowed skill', async () => {
  const panel = await bootPanel(toggleSnapshot(), { version: 'global-skill-post-case' })
  const current = openSkillSection(panel)

  switchNamed(current, 's-alpha').props.onClick({ stopPropagation() {} })
  await tick()
  await tick()

  const post = panel.calls.find((call) => call.method === 'POST')
  assert.ok(post, 'no POST issued')
  assert.equal(post.url, '/inventory/global')
  assert.deepEqual(JSON.parse(post.body), { kind: 'skill', name: 's-alpha', enabled: true })
})

test('rows the host cannot toggle render a disabled switch and the reason', async () => {
  const panel = await bootPanel(
    toggleSnapshot({
      mcp: [mcpRow('locked-mcp', { toggleable: false, disabledReason: 'no-writable-profile' })],
      skills: [
        { ...skillRow('runtime-only', { disabled: true, global: false, toggleable: false, disabledReason: 'runtime' }), source: 'runtime' },
        skillRow('project-only', { disabled: false, global: false, toggleable: false, disabledReason: 'project-scope' }),
      ],
    }),
    { version: 'global-locked-case' },
  )

  let current = panel.tree()
  const mcpSwitch = switchNamed(current, 'locked-mcp')
  assert.ok(mcpSwitch, 'locked MCP row has no switch')
  assert.equal(mcpSwitch.props.disabled, true, 'a non-toggleable MCP row must not be switchable')
  assert.match(textOf(rowOf(current, 'locked-mcp')), /该条目无法持久化开关/)

  current = openSkillSection(panel)
  // Runtime registrations are never listed, so there is no row to explain.
  assert.equal(switchNamed(current, 'runtime-only'), null, 'a runtime skill must not be listed')
  const projectSwitch = switchNamed(current, 'project-only')
  assert.ok(projectSwitch, 'project skill row has no switch')
  assert.equal(projectSwitch.props.disabled, true)
  assert.match(textOf(rowOf(current, 'project-only')), /项目级技能/)

  // A disabled switch must not issue a request.
  projectSwitch.props.onClick({ stopPropagation() {} })
  await tick()
  assert.equal(panel.calls.filter((call) => call.method === 'POST').length, 0)
})

test('a false globalToggle capability disables that whole section', async () => {
  const mcpLocked = await bootPanel(toggleSnapshot({ globalToggle: { mcp: false, skill: true } }), {
    version: 'global-lock-mcp-case',
  })
  let current = mcpLocked.tree()
  assert.ok(switchesIn(current).length > 0, 'no MCP switches rendered')
  for (const node of switchesIn(current)) {
    assert.equal(node.props.disabled, true, `MCP switch ${node.props['aria-label']} must be disabled`)
  }
  current = openSkillSection(mcpLocked)
  assert.equal(switchNamed(current, 's-bravo').props.disabled, false, 'skills stay switchable when only MCP is locked')

  const skillLocked = await bootPanel(toggleSnapshot({ globalToggle: { mcp: true, skill: false } }), {
    version: 'global-lock-skill-case',
  })
  const lockedTree = openSkillSection(skillLocked)
  const skillSwitches = switchesIn(lockedTree).filter((node) => String(node.props['aria-label']).startsWith('s-'))
  assert.ok(skillSwitches.length > 0, 'no skill switches rendered')
  for (const node of skillSwitches) {
    assert.equal(node.props.disabled, true, `skill switch ${node.props['aria-label']} must be disabled`)
  }
  assert.equal(switchNamed(lockedTree, 'alpha').props.disabled, false, 'MCP stays switchable when only skills are locked')
})

test('clicking a switch does not expand the row underneath it', async () => {
  const panel = await bootPanel(toggleSnapshot(), { version: 'global-no-expand-case' })

  const stopped = []
  const control = switchNamed(panel.tree(), 'alpha')
  control.props.onClick({ stopPropagation: () => stopped.push(true) })
  assert.equal(stopped.length, 1, 'a switch click must stop propagation to the row')

  await tick()
  await tick()
  const current = panel.tree()
  const header = findParent(current, switchNamed(current, 'alpha'))
  assert.ok(header, 'row header missing')
  assert.equal(header.props['aria-expanded'], 'false', 'clicking the switch must not expand the row')
  assert.equal(panel.calls.filter((call) => call.method === 'POST').length, 1)
})

test('a rejected global toggle shows the host message in a toast', async () => {
  const panel = await bootPanel(toggleSnapshot(), { version: 'global-error-case' })
  panel.setPost(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: '写不进去' }) }))

  switchNamed(panel.tree(), 'alpha').props.onClick({ stopPropagation() {} })
  await tick()
  await tick()

  const current = panel.tree()
  assert.match(textOf(current), /全局开关失败: 写不进去/)
  const dismiss = findNode(current, (node) => node.type === 'button' && textOf(node) === '关闭')
  assert.ok(dismiss, 'toast is not dismissible')
  dismiss.props.onClick()
  assert.doesNotMatch(textOf(panel.tree()), /全局开关失败/)
})

test('a patch-only toggle says it applies on the next start', async () => {
  const panel = await bootPanel(toggleSnapshot(), { version: 'global-notice-case' })
  panel.setPost(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, live: false }) }))

  switchNamed(panel.tree(), 'alpha').props.onClick({ stopPropagation() {} })
  await tick()
  await tick()
  assert.match(textOf(panel.tree()), /下次启动生效/)

  // A live write shows no such notice.
  const livePanel = await bootPanel(toggleSnapshot(), { version: 'global-live-case' })
  switchNamed(livePanel.tree(), 'alpha').props.onClick({ stopPropagation() {} })
  await tick()
  await tick()
  assert.doesNotMatch(textOf(livePanel.tree()), /下次启动生效/)
})

// ---- skill vault on the overview -----------------------------------------

/** Overview fixture: one global skill, one vaulted skill, one project skill, and a registered-only MCP. */
function vaultSnapshot() {
  return {
    ...SNAPSHOT,
    globalToggle: { mcp: true, skill: true },
    mcp: [mcpRow('officecli', { enabled: true }), mcpRow('legacy', { enabled: false, status: 'disabled', toolCount: 0 })],
    skills: [
      skillRow('global-skill', { global: true, vaulted: false, toggleable: true }),
      skillRow('vault-skill', {
        source: 'vault',
        global: false,
        vaulted: true,
        toggleable: false,
        disabledReason: 'vaulted',
      }),
      skillRow('project-skill', { global: false, vaulted: false, toggleable: false, disabledReason: 'project-scope' }),
    ],
    vault: { dir: 'C:/home/.dsh/inventory/skills', count: 1 },
  }
}

/** The button whose whole text is `label`. */
function buttonNamed(tree, label) {
  return findNode(tree, (node) => node.type === 'button' && textOf(node) === label)
}

test('a vaulted skill offers move-out instead of a global switch', async () => {
  const panel = await bootPanel(vaultSnapshot(), { version: 'vault-row-case' })
  const current = openSkillSection(panel)

  const row = rowOf(current, 'vault-skill')
  assert.ok(row, 'vaulted skill row missing')
  assert.equal(switchNamed(current, 'vault-skill'), null, 'a vaulted skill must not render a global switch')
  assert.equal(switchesIn(row).length, 0, 'no switch may leak into the vaulted row')
  const moveOut = buttonNamed(row, '移回全局根')
  assert.ok(moveOut, 'vaulted row has no move-out button')
  assert.equal(moveOut.props.disabled, false)
  assert.match(textOf(row), /仓库内技能只在启用的工作区里加载/, 'vaulted row must explain where it loads')

  moveOut.props.onClick()
  await tick()
  await tick()
  const post = panel.calls.find((call) => call.method === 'POST')
  assert.ok(post, 'no POST issued')
  assert.equal(post.url, '/inventory/vault')
  assert.deepEqual(JSON.parse(post.body), { action: 'out', name: 'vault-skill' })
})

test('a global skill keeps its switch and gains a move-in button', async () => {
  const panel = await bootPanel(vaultSnapshot(), { version: 'vault-in-case' })
  const current = openSkillSection(panel)

  const row = rowOf(current, 'global-skill')
  assert.ok(row, 'global skill row missing')
  const control = switchNamed(current, 'global-skill')
  assert.ok(control, 'a global skill must keep its global switch')
  assert.equal(control.props.disabled, false)
  const moveIn = buttonNamed(row, '收进仓库')
  assert.ok(moveIn, 'global skill row has no move-in button')

  moveIn.props.onClick()
  await tick()
  await tick()
  const post = panel.calls.find((call) => call.method === 'POST')
  assert.equal(post.url, '/inventory/vault')
  assert.deepEqual(JSON.parse(post.body), { action: 'in', name: 'global-skill' })

  // A project skill is neither globally switchable nor movable.
  const projectRow = rowOf(current, 'project-skill')
  assert.ok(projectRow, 'project skill row missing')
  assert.equal(buttonNamed(projectRow, '收进仓库'), null, 'a project skill must not offer move-in')
})

test('move-all posts in-all once and reports the moved count', async () => {
  const panel = await bootPanel(vaultSnapshot(), { version: 'vault-all-case' })
  panel.setPost(async () => ({ ok: true, status: 200, json: async () => ({ ok: true, moved: ['global-skill'], skipped: [] }) }))
  const current = openSkillSection(panel)

  const moveAll = buttonNamed(current, '全部收进仓库')
  assert.ok(moveAll, 'move-all button missing')
  moveAll.props.onClick()
  await tick()
  await tick()

  const posts = panel.calls.filter((call) => call.method === 'POST')
  assert.equal(posts.length, 1, 'one POST per move-all click')
  assert.equal(posts[0].url, '/inventory/vault')
  assert.deepEqual(JSON.parse(posts[0].body), { action: 'in-all' })
  assert.match(textOf(panel.tree()), /已移动 1 个/)
})

test('a registered-only MCP row says so instead of reading as mounted', async () => {
  const panel = await bootPanel(vaultSnapshot(), { version: 'registry-only-case' })
  const current = panel.tree()

  const row = rowOf(current, 'legacy')
  assert.ok(row, 'disabled MCP row missing')
  assert.match(textOf(row), /仅注册/)
  assert.match(textOf(row), /停用全局挂载后，在工作区页按工作区启用/)

  const control = switchNamed(current, 'legacy')
  assert.ok(control, 'the registered-only row must still offer a switch to turn it on')
  assert.equal(control.props['aria-checked'], 'false')
  assert.equal(control.props.disabled, false)
})

test('the default workspace is badged in the list and on its detail page', async () => {
  const { tree } = await bootPanel(workspaceSnapshot(), { version: 'default-workspace-case' })
  findNode(tree(), (node) => node.type === 'button' && textOf(node) === '工作区').props.onClick()

  let current = tree()
  const defaultCard = findNode(current, (node) => node.props?.role === 'button' && textOf(node).includes('Demo Workspace'))
  assert.ok(defaultCard, 'default workspace card missing')
  assert.match(textOf(defaultCard), /默认工作区/, 'the default card must carry the badge')
  const otherCard = findNode(current, (node) => node.props?.role === 'button' && textOf(node).includes('Second Workspace'))
  assert.ok(otherCard, 'second workspace card missing')
  assert.doesNotMatch(textOf(otherCard), /默认工作区/, 'a non-default card must not carry the badge')

  defaultCard.props.onClick()
  current = tree()
  const title = findNode(current, (node) => node.type === 'h3' && textOf(node) === 'Demo Workspace')
  assert.ok(title, 'detail title missing')
  const hero = findParent(current, title)
  assert.ok(hero, 'detail hero missing')
  assert.match(textOf(hero), /默认工作区/, 'the detail title must carry the default badge')
})

/**
 * The panel answers "what did I install". First-party entries — `@deepseek-ai/*`
 * bundles, their loader rows, and the app's builtin tools — are noise there, so
 * they stay hidden until the toolbar switch is on. The switch must bring them
 * back and hide them again within the same session.
 */
test('official DSH entries are hidden until the toolbar switch is turned on', async () => {
  const snapshot = {
    ...SNAPSHOT,
    packages: [
      { name: '@deepseek-ai/dsh-base', declaredBy: ['bundles'], installed: true, loaded: true, orphan: false },
      { name: 'dsh-tool-search', version: '0.1.8', declaredBy: ['dependencies', 'bundles'], installed: true, loaded: true, orphan: false },
    ],
    rows: [
      { id: 'base', name: '@deepseek-ai/dsh-base', enabled: true, fiberPhase: 'active', group: false },
      { id: 'tool-search', name: 'dsh-tool-search', enabled: true, fiberPhase: 'active', group: false },
    ],
    tools: [
      { name: 'pwsh', descLen: 10, deferred: false, owner: { kind: 'builtin', ref: 'deepseek-harness' } },
      { name: 'tool_search', descLen: 10, deferred: false, owner: { kind: 'plugin', ref: 'dsh-tool-search' } },
    ],
  }
  const { tree } = await bootPanel(snapshot, { version: 'official-case' })

  let current = tree()
  assert.doesNotMatch(textOf(current), /@deepseek-ai\/dsh-base/, 'official package must be hidden by default')
  assert.match(textOf(current), /dsh-tool-search/, 'third-party package must stay visible')

  // The tools section starts collapsed; open it so its rows render at all.
  const toolsHead = findNode(
    current,
    (node) =>
      node.type === 'button' &&
      (node.children ?? []).some((child) => child.type === 'span' && textOf(child) === '工具'),
  )
  assert.ok(toolsHead, 'tools section header missing')
  toolsHead.props.onClick()

  current = tree()
  assert.match(textOf(current), /tool_search/, 'third-party tool must stay visible')
  assert.doesNotMatch(textOf(current), /\bpwsh\b/, 'builtin tool must be hidden by default')

  findNode(current, (node) => node.type === 'button' && textOf(node) === '显示官方').props.onClick()
  current = tree()
  assert.match(textOf(current), /@deepseek-ai\/dsh-base/, 'the switch must bring official packages back')
  assert.match(textOf(current), /\bpwsh\b/, 'the switch must bring builtin tools back')

  findNode(current, (node) => node.type === 'button' && textOf(node) === '隐藏官方').props.onClick()
  assert.doesNotMatch(textOf(tree()), /@deepseek-ai\/dsh-base/, 'the switch must hide them again')
})

/**
 * A skill on a machine-wide root already reaches every workspace. The detail
 * page must say so and lock the row: linking it into the project root only
 * duplicated the skill, and for a globally shadowed skill the switch read "on"
 * while the model still could not see it. Only vaulted skills — which no root
 * scans — keep a workspace switch.
 */
test('workspace detail locks globally reachable skills and only switches vault skills', async () => {
  const snapshot = workspaceSnapshot()
  snapshot.skills = [
    ...snapshot.skills,
    { name: 'office', description: 'office router', source: 'user-dsh', global: true, vaulted: false, disabled: false, edges: [] },
    { name: 'office-docx', description: 'stub', source: 'user-dsh', global: true, vaulted: false, disabled: true, edges: [] },
    { name: 'vault-skill', description: 'parked', source: 'vault', global: false, vaulted: true, disabled: false, edges: [] },
  ]
  const panel = await bootPanel(snapshot, { version: 'global-skill-case' })
  findNode(panel.tree(), (node) => node.type === 'button' && textOf(node) === '工作区').props.onClick()
  findNode(panel.tree(), (node) => node.props?.role === 'button' && textOf(node).includes('Demo Workspace')).props.onClick()
  const current = panel.tree()

  const officeRow = rowOf(current, 'office')
  assert.ok(officeRow, 'global skill row missing')
  assert.equal(switchIn(officeRow), null, 'a globally available skill must not offer a workspace switch')
  assert.match(textOf(officeRow), /全局可用/)
  assert.match(textOf(officeRow), /总览/)

  const stubRow = rowOf(current, 'office-docx')
  assert.ok(stubRow, 'globally shadowed skill row missing')
  assert.equal(switchIn(stubRow), null, 'a globally shadowed skill must not offer a switch that cannot work')
  assert.match(textOf(stubRow), /全局已禁用/)
  assert.match(textOf(stubRow), /已屏蔽/)

  const vaultRow = rowOf(current, 'vault-skill')
  assert.ok(vaultRow, 'vault skill row missing')
  const vaultSwitch = switchIn(vaultRow)
  assert.ok(vaultSwitch, 'a vaulted skill must keep its workspace switch')
  assert.equal(vaultSwitch.props['aria-checked'], 'false')

  // The header counts a globally available skill as on and reports the global share.
  assert.match(textOf(current), /已开启 3\/6 · 全局 1/)

  vaultSwitch.props.onClick()
  await tick()
  const post = panel.calls.find((call) => call.method === 'POST')
  assert.ok(post, 'switching a vault skill must POST')
  assert.deepEqual(JSON.parse(post.body), { workspace: 'D:/demo', kind: 'skill', action: 'add', name: 'vault-skill' })
})
