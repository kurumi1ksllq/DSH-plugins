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
 *   runtime-skill — registered at runtime, no directory → off and locked
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
    workspaces: [
      {
        id: 'ws-1',
        title: 'Demo Workspace',
        path: 'D:/demo',
        available: true,
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
    if (candidate.props?.style?.padding !== '5px 0') return false
    return (candidate.children ?? []).some((child) => child.type === 'span' && textOf(child) === name)
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

  // 总览 is the default tab: no workspace card and no switch yet.
  assert.equal(findNode(tree(), (node) => node.props?.role === 'switch'), null, 'overview must not render switches')

  findNode(tree(), (node) => node.type === 'button' && textOf(node) === '工作区').props.onClick()

  let current = tree()
  assert.match(textOf(current), /Demo Workspace/, 'workspace card missing')
  assert.match(textOf(current), /D:\/demo/, 'workspace path missing from the card')
  assert.match(textOf(current), /MCP 1/, 'declared MCP count missing')
  assert.match(textOf(current), /技能 2/, 'project skill count missing')
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
  // Every row carries a switch.
  for (const name of ['officecli', 'codegraph', 'context7', 'proj-skill', 'copied-skill', 'runtime-skill']) {
    const row = rowOf(current, name)
    assert.ok(row, `row for ${name} is missing`)
    assert.ok(switchIn(row), `row for ${name} has no switch`)
  }

  // Global and not declared: already available to every workspace, nothing to
  // switch off — but the badge says so instead of relying on the disabled state.
  const globalRow = rowOf(current, 'context7')
  assert.equal(switchIn(globalRow).props['aria-checked'], 'true', 'a global server reads as on')
  assert.equal(switchIn(globalRow).props.disabled, true, 'a global server cannot be switched off')
  assert.match(textOf(globalRow), /全局已挂载/, 'a global server must be flagged')

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
  assert.equal(switchIn(copiedRow).props['aria-checked'], 'true')
  assert.equal(switchIn(copiedRow).props.disabled, true, 'a non-link skill cannot be switched off')
  assert.match(textOf(copiedRow), /非本页链接/)

  // Runtime registration: no directory, so it cannot be switched on.
  const runtimeRow = rowOf(current, 'runtime-skill')
  assert.equal(switchIn(runtimeRow).props['aria-checked'], 'false')
  assert.equal(switchIn(runtimeRow).props.disabled, true, 'a runtime skill cannot be switched on')
  assert.match(textOf(runtimeRow), /运行时注册/)

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

  // Inside a section body, nesting is rows and controls only: no bordered
  // container. Pills (badges, switches) are controls, not containers.
  const bodies = []
  eachNode(current, (node) => {
    if (node.props?.style?.padding === '2px 14px 8px') bodies.push(node)
  })
  assert.ok(bodies.length >= 2, 'detail page must render both section bodies')
  for (const body of bodies) {
    let nestedBoxes = 0
    eachNode(body, (node) => {
      const style = node.props?.style
      if (style === undefined || style === null) return
      if (typeof style.border === 'string' && style.borderRadius !== '999px' && style.height !== '18px') nestedBoxes += 1
    })
    assert.equal(nestedBoxes, 0, `no bordered container may nest inside a section body, found ${nestedBoxes}`)
  }

  // The switch is a 34×18 pill track with a round knob.
  const control = switchIn(rowOf(current, 'codegraph'))
  assert.ok(control, 'switch missing on the detail page')
  assert.equal(control.props.style.borderRadius, '999px')
  assert.equal(control.props.style.width, '34px')
  assert.equal(control.props.style.height, '18px')

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
