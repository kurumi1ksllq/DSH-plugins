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
  // Props carry rendered text as well (`sub`, `badges`, `title`, `right`).
  // Walking only `children` is why a prop-level regression (a "current" badge
  // applied to the wrong branch) could never fail a text assertion.
  walkProps(node.props, out, depth + 1)
}

function walkProps(props, out, depth) {
  if (props === null || typeof props !== 'object' || depth > MAX_DEPTH) return
  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || key === 'style' || key === 'key') continue
    if (typeof value === 'string' || typeof value === 'number') out.push(String(value))
    else if (value !== null && typeof value === 'object') walk(value, out, depth + 1)
  }
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
  if (node.props && typeof node.props === 'object') {
    for (const [key, value] of Object.entries(node.props)) {
      if (key === 'children' || key === 'style' || key === 'key') continue
      if (value !== null && typeof value === 'object') findAll(value, typeName, out)
    }
  }
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
// ---- prop-level regressions (review of PR #23) -----------------------------

/**
 * Expand the rendered tree: every element whose `type` is a component is run
 * with its props, exactly like React does at render time.
 */
function expand(node, depth = 0) {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return []
  if (Array.isArray(node)) return node.flatMap((child) => expand(child, depth))
  if (typeof node.type === 'function') return expand(node.type(node.props), depth + 1)
  return [{ type: node.type, props: node.props }].concat(expand(node.children, depth + 1))
}

/**
 * Find every element of a COMPONENT type by its name, expanding components as
 * it walks. The stubbed `createElement` stores children in `props.children`,
 * so that is the branch to follow.
 */
function findByTypeName(node, name, out = [], depth = 0) {
  if (depth > MAX_DEPTH || node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findByTypeName(child, name, out, depth)
    return out
  }
  if (typeof node.type === 'function') {
    if (node.type.name === name) out.push(node)
    else findByTypeName(node.type(node.props), name, out, depth + 1)
    return out
  }
  const children = node.props?.children ?? node.children
  for (const child of Array.isArray(children) ? children : [children]) {
    findByTypeName(child, name, out, depth + 1)
  }
  return out
}

/** Rendered rows with their prop-level badges (branch rows in this panel). */
function branchRows(snap) {
  return findByTypeName(renderPanel(snap), 'Row').map((el) => ({
    text: textOf({ type: el.type, props: el.props, children: el.props.children }),
    badges: (el.props.badges ?? []).map((b) => b.text),
  }))
}

/** Rows of the Branches card, in render order, as `{ text, badges }`. */

test('P0-3 the "current" marker stays on the current branch, not on a list index', () => {
  const snap = structuredClone(SNAP)
  snap.git.branches = [
    { name: 'feat/x', current: false, remote: false, upstream: 'origin/feat/x', ahead: 1, behind: 0, gone: false, lastCommitDate: null, lastCommitSubject: null },
    { name: 'main', current: true, remote: false, upstream: 'origin/main', ahead: 0, behind: 0, gone: false, lastCommitDate: null, lastCommitSubject: null },
    { name: 'old', current: false, remote: false, upstream: null, ahead: null, behind: null, gone: false, lastCommitDate: null, lastCommitSubject: null },
  ]
  const rows = branchRows(snap)
  // Branch rows render both halves of the name (the label above the copy
  // button); the repo card's own row only mentions the current branch once.
  // The repo card also names the current branch, so match the row that ends
  // with the branch's own GitHub link (the per-branch affordance).
  const rowFor = (name) => rows.find((r) => r.text.includes(`/tree/${name.replace('/', '%2F')}`) || r.text.includes(`/tree/${name} `))
  const byName = { 'feat/x': rowFor('feat/x'), main: rowFor('main'), old: rowFor('old') }
  assert.ok(byName['feat/x'], 'feat/x row found')
  assert.ok(byName.main, 'main row found')
  // Arrays are built inside the vm sandbox, so they are not deepEqual to a
  // host-realm [] — compare their contents.
  assert.equal(byName['feat/x'].badges.length, 0, 'no badge on a non-current branch')
  assert.equal(byName.main.badges.length, 0, 'the current marker is not a list badge any more')
  assert.match(byName.main.text, /当前/, 'the current marker is rendered on the main row')
  assert.doesNotMatch(byName['feat/x'].text, /当前/)
  assert.doesNotMatch(byName.old.text, /当前/)
})

test('P0-3 a branch in sync with its upstream is not "no upstream"', () => {
  const snap = structuredClone(SNAP)
  snap.git.branches = [
    { name: 'feat/x', current: true, remote: false, upstream: 'origin/feat/x', ahead: 0, behind: 0, gone: false, lastCommitDate: null, lastCommitSubject: null },
    { name: 'lonely', current: false, remote: false, upstream: null, ahead: null, behind: null, gone: false, lastCommitDate: null, lastCommitSubject: null },
  ]
  const rows = branchRows(snap)
  const isBranchRow = (name) => (r) => r.text.includes(`/tree/${name.replace('/', '%2F')}`)
  const feat = rows.find(isBranchRow('feat/x')).text
  const lonely = rows.find(isBranchRow('lonely')).text
  assert.match(feat, /origin\/feat\/x/, 'the upstream name is shown')
  assert.doesNotMatch(feat, /未设置上游/, 'in sync with upstream is not "no upstream"')
  assert.match(lonely, /未设置上游/, 'a branch with no upstream still says so')
})

test('a remote URL carrying a token is never rendered verbatim', () => {
  const snap = structuredClone(SNAP)
  snap.git.remotes = [{ name: 'origin', url: 'https://user:ghp_S3CRET@github.com/me/repo.git' }]
  const text = textOf(renderPanel(snap))
  assert.equal(text.includes('ghp_S3CRET'), false, 'the token must not reach the DOM')
  assert.match(text, /github\.com\/me\/repo\.git/, 'the repository is still identifiable')
})

test('gh.source is rendered when the host reports it (issue #16)', () => {
  const snap = structuredClone(SNAP)
  // The PR card only renders once the forge gate is open.
  snap.gh = { available: true, loggedIn: true, reason: null, source: 'gh_token' }
  snap.forgeHint = null
  snap.prs = [{
    number: 23, title: 'feat: panel', author: { login: 'me' }, headRefName: 'feat/x',
    baseRefName: 'main', isDraft: false, mergeable: 'MERGEABLE', url: 'https://github.com/me/repo/pull/23',
  }]
  const text = textOf(renderPanel(snap))
  assert.match(text, /已认证/, 'the authentication source is shown')
  assert.match(text, /gh_token/)
  assert.match(text, /#23 feat: panel/, 'PRs still render next to it')
})

test('a non-GitHub repo gets no GitHub links at all', () => {
  const snap = structuredClone(SNAP)
  snap.repoSlug = null
  const hrefs = findAll(renderPanel(snap), 'a').map((a) => a.props.href).filter(Boolean)
  assert.deepEqual(hrefs.filter((h) => h.includes('github.com')), [], 'no github.com deep links without a slug')
})

test('the diff preview asks for the rendered status hash', () => {
  const snap = structuredClone(SNAP)
  snap.git.statusSha = 'sha-of-the-list'
  const panel = renderPanel(snap)
  const diffViews = findAll(panel, 'DiffView')
  assert.equal(diffViews.length, 0, 'diffs stay collapsed until a row is opened')
  const clickable = findAll(panel, 'div').filter((d) => typeof d.props.onClick === 'function')
  assert.ok(clickable.length >= 4, 'changed-file rows are clickable')
  assert.ok(textOf(panel).includes('loose.txt'))
})
