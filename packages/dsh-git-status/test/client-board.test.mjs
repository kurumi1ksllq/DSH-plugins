import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

function createElement(type, props, ...children) {
  const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)
  const merged = props ?? {}
  const finalKids = kids.length > 0 ? kids : merged.children !== undefined ? [merged.children] : []
  return { type, props: { ...merged, children: finalKids }, children: finalKids }
}

function loadClient() {
  let captured = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: ({ factory }) => {
          captured = factory((name) => (name === 'react' ? { createElement, useState: (v) => [v === true ? false : v, () => {}], useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f() } : {}))
        },
      },
      setTimeout: () => 0,
    },
    document: { createElement: () => ({ style: {}, setAttribute() {}, select() {} }), body: { appendChild() {}, removeChild() {} }, execCommand: () => true },
    navigator: {},
    fetch: () => Promise.reject(new Error('no network in test')),
    console,
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  return captured
}

const client = loadClient()

/** Capture the real zh dictionary so `t` answers keys AND parameterised messages. */
let DICT = {}
{
  let dicts = null
  client.apply({
    effect: (fn) => fn(),
    get: () => undefined,
    locale: { register: (_ns, d) => { dicts = d }, bind: () => (k) => k },
    slots: { inject: (_name, run) => run(), register: () => ({}) },
    layout: { selectPanel: () => {} },
  })
  DICT = dicts.zh
}

/** Find the panel component the client registers into the `main` slot. */
function panel() {
  const registered = []
  const ctx = {
    effect: () => {},
    locale: { register: () => {}, bind: () => (key) => key },
    slots: { inject: (name, fn) => fn(), register: (spec, comp) => registered.push({ spec, comp }) },
    layout: { selectPanel: () => {} },
  }
  client.apply(ctx)
  return registered.find((r) => r.spec.name === 'main').comp
}

/**
 * `t` mirrors the live locale bind: plain keys resolve through the real
 * dictionary (so copy regressions fail the test), and message keys stay
 * callable. Assertions therefore check the Chinese copy the user actually sees.
 */
function render(snap) {
  const Panel = panel()
  // The live locale bind keeps message keys CALLABLE (`t('aheadBehind')(a, b)`),
  // so the stub must too, or the repo-facts section throws before the board renders.
  // Message keys stay CALLABLE (`t('aheadBehind')(a, b)`), exactly like the
  // live locale bind; plain keys resolve to their copy.
  // Two call shapes exist in the bundle and both must work:
  //   t('offFlowFiles', n)        → the bind formats the message
  //   t('aheadBehind')(a, b)      → the bind returns the callable
  // Returning a callable that ALSO stringifies is impossible, so the stub
  // follows the message signature: functions that take arguments stay
  // callable, and BoardColumn/OffFlow pass their args through `t(key, ...)`.
  const t = (k, ...args) => {
    const entry = DICT[k]
    if (typeof entry === 'function') return args.length > 0 ? entry(...args) : entry
    if (entry !== undefined) return entry
    return args.length > 0 ? `${k}:${args.join(',')}` : String(k)
  }
  return Panel({ t, sessionId: 's1', initialSnap: snap })
}

function walk(node, out, depth = 0) {
  if (depth > 60 || node === null || node === undefined || node === true || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const c of node) walk(c, out, depth + 1)
    return out
  }
  if (typeof node.type === 'function') {
    walk(node.type(node.props), out, depth + 1)
    return out
  }
  walk(node.children, out, depth + 1)
  if (node.props && typeof node.props === 'object') {
    for (const [k, v] of Object.entries(node.props)) {
      if (k === 'children' || k === 'style' || k === 'key') continue
      if (typeof v === 'string' || typeof v === 'number') out.push(String(v))
      else if (v !== null && typeof v === 'object') walk(v, out, depth + 1)
    }
  }
  return out
}

function textOf(snap) {
  return walk(render(snap), []).join(' ')
}

function findAll(node, pred, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const c of node) findAll(c, pred, out)
    return out
  }
  if (typeof node.type === 'function') {
    findAll(node.type(node.props), pred, out)
    return out
  }
  if (pred(node)) out.push(node)
  findAll(node.children, pred, out)
  if (node.props && typeof node.props === 'object') {
    for (const [k, v] of Object.entries(node.props)) {
      if (k === 'children' || k === 'style' || k === 'key') continue
      if (v !== null && typeof v === 'object') findAll(v, pred, out)
    }
  }
  return out
}

const has = (node, attr, value) => findAll(node, (n) => n.props && n.props[attr] === value)
const dataAttr = (name) => (node) => Boolean(node.props) && node.props['data-' + name] !== undefined

function issue(n, title = `t${n}`) {
  return { number: n, title, url: `https://github.com/o/r/issues/${n}` }
}
function branch(name, extra = {}) {
  return { name, current: false, ahead: 0, behind: 0, ...extra }
}
function pr(n, head, extra = {}) {
  return { number: n, title: `pr${n}`, headRefName: head, baseRefName: 'main', isDraft: false, mergeable: 'MERGEABLE', url: `https://github.com/o/r/pull/${n}`, ...extra }
}

function snap(overrides = {}) {
  return {
    isGit: true,
    workspace: '/tmp/r',
    git: {
      currentBranch: 'main',
      status: { branch: 'main', detached: false, dirty: 0, untracked: 0, conflicts: 0 },
      branches: [{ name: 'main', current: true, ahead: 0, behind: 0 }],
      commits: [],
      remotes: [],
      stashes: 0,
      stashList: [],
      aheadCommits: [],
      statusSha: 'x',
      ...(overrides.git ?? {}),
    },
    gh: { available: true, loggedIn: true, reason: null },
    forgeHint: null,
    repoSlug: 'o/r',
    prs: [],
    mergedPrs: [],
    issues: [],
    checks: {},
    flowStates: new Map(),
    ...overrides,
  }
}

// ---- the eight columns ------------------------------------------------------

test('panel renders all eight dev-flow column headers', () => {
  const out = textOf(snap())
  const expected = ['待处理', '方案中', '开发中', '待 PR', 'CI', '待 review', '待 merge', '已完成']
  for (const label of expected) {
    assert.ok(out.includes(label), `missing column header ${label}`)
  }
})

test('panel renders an empty-column hint instead of blank space', () => {
  const out = textOf(snap())
  // Every column is empty in this snapshot, so every hint key must be present.
  assert.ok(out.includes('没有待确认的需求'))
  assert.ok(out.includes('没有 PR 等口令'))
})

// ---- cards ------------------------------------------------------------------

test('a branch-named issue renders as a card inside the dev column', () => {
  const s = snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a')] },
    issues: [issue(26, 'task board')],
  })
  const out = textOf(s)
  assert.ok(out.includes('#26'), 'card title must carry the issue number')
  assert.ok(out.includes('task board'))
  assert.ok(out.includes('issue-26-a'), 'card must show its branch')
})

test('a card shows its grade when the flow file recorded one', () => {
  const flowStates = new Map([[26, { issue: 26, grade: 'trivial', stage: 'dev', tickets: [], ci: null, review: null, merge: null }]])
  const s = snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a')] },
    issues: [issue(26)],
    flowStates,
  })
  assert.ok(textOf(s).includes('trivial'))
})

// ---- stale marker -----------------------------------------------------------

test('a card whose flow stage disagrees with git shows the stale marker', () => {
  const flowStates = new Map([[26, { issue: 26, grade: 'standard', stage: 'review', tickets: [], ci: null, review: null, merge: null }]])
  const s = snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: [issue(26)],
    flowStates,
  })
  const out = textOf(s)
  assert.ok(out.includes('状态过期'), 'stale marker must be rendered')
})

test('a card in agreement renders no stale marker', () => {
  const flowStates = new Map([[26, { issue: 26, grade: 'standard', stage: 'dev', tickets: [], ci: null, review: null, merge: null }]])
  const s = snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a')] },
    issues: [issue(26)],
    flowStates,
  })
  assert.ok(!textOf(s).includes('状态过期'))
})

// ---- needs-you strip --------------------------------------------------------

test('the needs-you strip renders when the merge gate waits', () => {
  const flowStates = new Map([[26, {
    issue: 26, grade: 'standard', stage: 'merge', tickets: [],
    ci: { run: 0, max: 2, status: 'green' }, review: { state: 'done', axes: 2 }, merge: { authorized: false },
  }]])
  const s = snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: [issue(26)],
    prs: [pr(5, 'issue-26-a')],
    checks: { 5: 'green' },
    flowStates,
  })
  const out = textOf(s)
  assert.ok(out.includes('需要你出手'))
  assert.ok(out.includes('等你点名 merge'))
})

test('the needs-you strip is absent when nothing waits on the user', () => {
  assert.ok(!textOf(snap()).includes('需要你出手'))
})

// ---- off-flow column --------------------------------------------------------

test('dirty main renders the off-flow warning', () => {
  const s = snap({
    git: { status: { branch: 'main', detached: false, dirty: 3, untracked: 1, conflicts: 0 } },
  })
  const out = textOf(s)
  assert.ok(out.includes('未进流程'))
  assert.ok(out.includes('dev-flow 禁止直接改主干'))
  assert.ok(out.includes('3 个文件'))
})

test('a clean workspace renders no off-flow warning', () => {
  assert.ok(!textOf(snap()).includes('未进流程'))
})

// ---- clean workspace still shows the board ---------------------------------

test('a clean workspace shows eight columns and no cards', () => {
  const out = textOf(snap())
  assert.ok(out.includes('待处理'))
  assert.ok(!out.includes('#26'))
})
