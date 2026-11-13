import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import vm from 'node:vm'

import { buildTaskBoard } from '../lib-git-status/task-board.js'

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
    sidebarRightTabs: { register: () => () => {} },
  })
  DICT = dicts.zh
}

/**
 * Find the panel component the client registers into the right sidebar's keyed
 * body seat (#197). The body is keyed by the tab type's id, so a seat keyed by
 * the kind — which the host silently never draws — fails here instead.
 */
function panel() {
  const registered = []
  const types = []
  const ctx = {
    effect: (fn) => fn(),
    locale: { register: () => {}, bind: () => (key) => key },
    slots: { inject: (name, fn) => fn(), register: (spec, comp) => registered.push({ spec, comp }) },
    sidebarRightTabs: { register: (definition) => { types.push(definition); return () => {} } },
  }
  client.apply(ctx)
  const seat = registered.find((r) => r.spec.name === 'sidebar.right.pane.tab')
  assert.ok(seat, 'the panel registers as a right-sidebar tab body')
  assert.equal(seat.spec.key, types[0].id, 'the body seat is keyed by the tab type id')
  return seat.comp
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
  // 宿主与客户端同包同发:面板只信宿主预计算的 board(镜像已砍,#110 P3b)。
  // 测试用真实的 lib-git-status/task-board.js 计算板面,与生产数据流一致。
  const withBoard = snap && !snap.board ? { ...snap, board: buildTaskBoard(snap) } : snap
  return Panel({ t, sessionId: 's1', initialSnap: withBoard })
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
  assert.ok(out.includes('等你答是否合并'))
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

// ---- review findings on the render layer -----------------------------------

test('a card in the merge gate renders its own action line', () => {
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
  assert.ok(out.includes('需要你'), 'the card must carry its own action line')
  assert.ok(out.includes('等你答是否合并'))
})

test('#157 states stay visible on the card now that the strip no longer lists them', () => {
  // The strip asks only about intent and merge. Everything else moved to the
  // card's evidence line — this is the assertion that keeps it there.
  const s = snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a', { ahead: 1 })] },
    issues: [issue(26)],
    prs: [pr(5, 'issue-26-a')],
    // A repository with no CI has no self-repair round either: run 2/2 + 'none'
    // is a state that cannot exist, and asserting both on one card would test a
    // combination no user can ever see.
    checks: { 5: 'none' },
    flowStates: new Map([[26, {
      issue: 26, grade: 'standard', stage: 'review', tickets: [],
      ci: null, review: { state: 'pending-decision', axes: 2 }, merge: { authorized: false },
    }]]),
  })
  const out = textOf(s)
  assert.ok(out.includes('无 CI'), 'missing CI is a card fact now')
  assert.ok(!out.includes('CI 2/2'), 'a repository with no CI has no repair rounds')
  assert.ok(out.includes('review 待裁决'), 'a review waiting on the agent must not disappear')
  // The strip's own title is the only honest marker: '需要你:' never renders
  // (the strip title is '需要你出手', the card action is '需要你回话'), so
  // asserting its absence was an assertion that could never fail.
  assert.ok(!out.includes('需要你出手'), 'none of the three may reach the strip')
})

test('a card with nothing pending renders no action line', () => {
  const s = snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a')] },
    issues: [issue(26)],
  })
  assert.ok(!textOf(s).includes('需要你:'))
})

test('the host-provided board is what gets rendered', () => {
  // The browser must trust the API's board instead of re-deriving a second copy.
  const board = {
    columns: [
      { stage: 'intake', cards: [], empty: 'no-unconfirmed-issue' },
      { stage: 'spec', cards: [], empty: 'no-spec-pending' },
      { stage: 'dev', cards: [], empty: 'nothing-in-tdd' },
      { stage: 'pr', cards: [], empty: 'no-branch-awaiting-push' },
      {
        stage: 'ci',
        cards: [{
          issue: 77, title: 'from the host', url: null, grade: 'standard', stage: 'ci',
          stageIndex: 4, columnCount: 8, stale: false, flowStage: 'ci', hasBranch: true,
          branchName: 'issue-77-x', ahead: 1, prNumber: 9, prUrl: null, prDraft: false,
          checks: 'green', tickets: [], ci: { run: 1, max: 2, status: 'green' },
          review: { state: 'done', axes: 2 }, merge: { authorized: false },
          action: { kind: 'merge-gate', issue: 77, prNumber: 9 },
        }],
        empty: 'no-pr-in-ci',
      },
      { stage: 'review', cards: [], empty: 'no-review-pending' },
      { stage: 'merge', cards: [], empty: 'no-pr-awaiting-merge' },
      { stage: 'done', cards: [], empty: 'nothing-merged-yet' },
    ],
    needsUser: [{ kind: 'merge-gate', issue: 77, prNumber: 9, severity: 'blocker' }],
    offFlow: [],
    forgeHint: null,
  }
  const out = textOf(snap({ board }))
  assert.ok(out.includes('from the host'), 'must render the board it was given')
  assert.ok(out.includes('#77'))
  assert.ok(out.includes('等你答是否合并'), 'the action line must render the item the host supplied')
  assert.ok(out.includes('CI 绿'), 'the evidence line must render the CI state it was given')
})

test('flow state arriving as a plain object (the HTTP shape) is honoured', () => {
  // Over HTTP a Map is serialised to `{}`; here the state must be read from the
  // plain object and still drive the grade badge.
  const s = snap({
    git: { branches: [branch('main', { current: true }), branch('issue-26-a')] },
    issues: [issue(26)],
    flowStates: { 26: { issue: 26, grade: 'trivial', stage: 'dev', tickets: [], ci: null, review: null, merge: null } },
  })
  assert.ok(textOf(s).includes('trivial'))
})
