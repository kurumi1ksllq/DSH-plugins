/**
 * Render smoke test for the browser half (issues #18/#19/#20/#22).
 * The client is a DSH module-loader bundle that expects `react` and a
 * `window.__ModuleLoader__`; both are stubbed here so the rendered element
 * tree can be inspected without a browser.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')

/** Minimal createElement that keeps a plain tree we can walk. */
/**
 * React-compatible createElement: array children are flattened into the child
 * list exactly like React does, so `h('div', props, someArray)` yields the
 * same shape a browser render would.
 */
function createElement(type, props, ...children) {
  const kids = children.flat(Infinity).filter((c) => c !== null && c !== undefined && c !== false)
  // React puts children in props too — components destructure `{ children }`.
  // An explicitly passed `children` prop wins when no child args were given.
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
          captured = factory((name) => (name === 'react' ? { createElement, useState: (v) => [initialStateFor(v), () => {}], useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f() } : {}))
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

function textOf(node) {
  const out = []
  walk(node, out, 0)
  return out.join(' ')
}

const MAX_DEPTH = 40

function walk(node, out, depth) {
  if (depth > MAX_DEPTH) return
  if (node === null || node === undefined || node === false || node === true) return
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return
  }
  if (typeof node !== 'object') return
  // `Array.isArray` is realm-safe, but a flat list may also arrive as an
  // array-like from the sandbox, so both shapes are accepted.
  if (Array.isArray(node) || (typeof node.length === 'number' && typeof node.type === 'undefined')) {
    for (let i = 0; i < node.length; i += 1) walk(node[i], out, depth + 1)
    return
  }
  // An element whose `type` is a component: run it and descend into its output.
  if (typeof node.type === 'function') {
    walk(node.type(node.props), out, depth + 1)
    return
  }
  walk(node.children, out, depth + 1)
}



/**
 * The panel's `loading` state starts true; in a static render that would show
 * the spinner forever, so the pending flag is resolved immediately.
 */
function initialStateFor(value) {
  return value === true ? false : value
}

/** Walk the rendered tree and collect every element of one type. */
function findAll(node, typeName, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, typeName, out)
    return out
  }
  if (node.type === typeName) out.push(node)
  if (typeof node.type === 'function') {
    findAll(node.type(node.props), typeName, out)
    return out
  }
  findAll(node.children, typeName, out)
  return out
}

/** Render the main panel for one snapshot through the real component tree. */
function renderPanel(snap) {
  let mainComponent = null
  const fakeCtx = {
    locale: { register: () => {}, bind: () => (k) => (typeof k === 'string' ? k : String(k)) },
    layout: { selectPanel: () => {} },
    effect: (fn) => fn(),
    get: () => undefined,
    slots: {
      inject: (_name, run) => run(),
      register: (opts, Component) => {
        if (opts?.name === 'main') mainComponent = Component
        return {}
      },
    },
  }
  bundle.apply(fakeCtx)
  assert.ok(mainComponent, 'main panel registered')
  // `t` must answer both plain keys and the parameterised messages
  // (`lastCommit(when, subject)`), which the component calls as functions.
  const t = (k) => (typeof DICT[k] === 'function' ? (...a) => DICT[k](...a) : k in DICT ? DICT[k] : String(k))
  return mainComponent({ t, sessionId: 's1', initialSnap: snap })
}

let DICT = {}
let DICT_KEYS = new Set()

/** Capture the real dictionaries so `t` behaves like the live locale bind. */
function captureDictionary() {
  let dicts = null
  bundle.apply({
    locale: { register: (_ns, d) => { dicts = d }, bind: () => (k) => k },
    layout: { selectPanel: () => {} },
    effect: (fn) => fn(),
    get: () => undefined,
    // `slots.inject` must RUN the callback, exactly like the real slot system,
    // otherwise `register` is never reached and nothing is captured.
    slots: { inject: (_name, run) => run(), register: () => ({}) },
  })
  DICT = dicts.zh
  DICT_KEYS = new Set(Object.keys(dicts.zh))
}

const bundle = loadClient()

captureDictionary()

test('client bundle exports the expected shape', () => {
  assert.equal(bundle.name, 'dsh-git-status')
  assert.deepEqual([...bundle.inject], ['slots', 'locale', 'layout'])
})

test('both locales carry every new key', () => {
  const dicts = []
  const fakeCtx = {
    locale: { register: (_ns, dict) => dicts.push(dict), bind: () => (k) => k },
    slots: { inject: () => {}, register: () => {} },
    effect: (fn) => fn(),
  }
  bundle.apply(fakeCtx)
  assert.equal(dicts.length, 1)
  const { zh, en } = dicts[0]
  for (const key of ['conflicts', 'sectionChanges', 'changeStaged', 'sectionStash', 'sectionAhead', 'viewDiff', 'copy', 'openOnGithub']) {
    assert.ok(key in zh, `zh.${key}`)
    assert.ok(key in en, `en.${key}`)
  }
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(zhKeys, enKeys, 'zh and en stay in sync')
})

const SNAP = {
  workspace: '/repo', sessionCwd: '/repo', isGit: true, repoSlug: 'me/repo', forgeHint: 'no-remote',
  gh: { available: true, loggedIn: true, source: 'cli' },
  prs: [], mergedPrs: [], issues: [],
  git: {
    status: {
      branch: 'feat/x', detached: false, dirty: 4, changed: 1, untracked: 2, conflicts: 1,
      staged: 1, unstaged: 0, changesTotal: 4, changesTruncated: true,
      changes: [
        { path: 'conflicted.txt', origPath: null, index: 'U', worktree: 'U', kind: 'conflict', untracked: false, conflict: true, staged: false },
        { path: 'staged.txt', origPath: null, index: 'M', worktree: '.', kind: 'staged', untracked: false, conflict: false, staged: true },
        { path: 'loose.txt', origPath: null, index: '?', worktree: '?', kind: 'untracked', untracked: true, conflict: false, staged: false },
        { path: 'other.txt', origPath: null, index: '?', worktree: '?', kind: 'untracked', untracked: true, conflict: false, staged: false },
      ],
    },
    branches: [{ name: 'feat/x', current: true, remote: false, upstream: null, ahead: 2, behind: 0, gone: false, lastCommitDate: '3 hours ago', lastCommitSubject: 'Fix: thing' }],
    commits: [{ hash: 'abc1234', fullHash: 'abc1234deadbeef', author: 'me', date: '1 day ago', subject: 'init' }],
    remotes: [],
    stashes: 1,
    stashList: [{ ref: 'stash@{0}', when: '2 hours ago', subject: 'On main: wip' }],
    aheadCommits: [{ hash: 'def5678', fullHash: 'def5678deadbeef', subject: 'local work' }],
    currentBranch: 'feat/x',
  },
}

test('panel renders conflict banner, file list, stash, ahead and copy controls', () => {
  const panel = renderPanel(SNAP)
  const text = textOf(panel)

  assert.match(text, /未解决的合并冲突/, 'conflict banner is rendered')
  assert.match(text, /改动文件/, 'changed-files card is rendered')
  assert.match(text, /conflicted\.txt/, 'conflicted path listed')
  assert.match(text, /staged\.txt/, 'staged path listed')
  assert.match(text, /loose\.txt/, 'untracked path listed')
  assert.match(text, /只显示前 4 项,共 4 项/, 'truncation is reported')
  assert.match(text, /未跟踪: 2/, 'untracked count stays separate from conflicts')
  assert.match(text, /冲突: 1/, 'conflict count is reported separately')
  assert.match(text, /2 hours ago · On main: wip/, 'stash keeps its time and message')
  assert.match(text, /local work/, 'ahead commits are listed')
  assert.match(text, /3 hours ago · Fix: thing/, 'branch tip gives time + subject')
  assert.match(text, /UU/, 'porcelain status codes are shown')

  const hrefs = findAll(panel, 'a').map((a) => a.props.href)
  assert.deepEqual(hrefs, [
    'https://github.com/me/repo/feat/x',
    'https://github.com/me/repo/commit/abc1234deadbeef',
    'https://github.com/me/repo/commit/def5678deadbeef',
    'https://github.com/me/repo/tree/feat%2Fx',
  ], 'GitHub deep links for branch, commits and branch tree')

  assert.match(text, /复制/, 'copy affordance exists')
  assert.match(text, /查看 diff/, 'diff toggle exists')
})
