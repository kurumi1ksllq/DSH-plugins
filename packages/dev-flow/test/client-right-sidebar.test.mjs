/**
 * The Git panel lives in the RIGHT sidebar (#197), not the left one.
 *
 * Why a dedicated case: the host's right-sidebar contract is a two-stage
 * registration (a tab TYPE plus a keyed BODY seat). A registration that names
 * the wrong seat, or whose body key does not equal the type's id, does not
 * throw - the tab simply never draws. That is the same silent-failure shape as
 * #161's unmounted patch rows, so the seat names, the key identity, and the
 * absence of the old left-sidebar registrations are all asserted here.
 */

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
          captured = factory((name) => (name === 'react'
            ? {
              createElement,
              useState: (v) => [v === true ? false : v, () => {}],
              useEffect: () => {},
              useCallback: (f) => f,
              useMemo: (f) => f(),
            }
            : {}))
        },
      },
      setTimeout: () => 0,
    },
    document: { createElement: () => ({ style: {}, setAttribute() {}, select() {} }), body: { appendChild() {}, removeChild() {} }, execCommand: () => true },
    navigator: {},
    fetch: () => Promise.reject(new Error('no network in test')),
    console: {},
  }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  return captured
}

const client = loadClient()

/**
 * The host's `translate()`, reproduced verbatim
 * (`@deepseek-ai/dsh-client-locale/lib/client.js:1711-1716`):
 *
 *   const template = lookup(ns, key) ?? key
 *   if (!params) return template
 *   return template.replace(/\{(\w+)\}/g, ...)
 *
 * Two consequences this stub must reproduce, because the panel depends on them:
 *   - a message entry is a FUNCTION, so `t(key)` hands back that function;
 *     only the caller can invoke it — `t(key, a, b)` would call `.replace` on a
 *     function and throw.
 *   - `params` is a single object, never positional arguments.
 *
 * A lenient stub that accepted both shapes certified a render-time TypeError as
 * green (review axis A, P1-1).
 */
function hostTranslate(dict) {
  return (key, params) => {
    const template = dict[key] ?? key
    if (!params) return template
    return String(template).replace(/\{(\w+)\}/g, (match, name) => (name in params ? String(params[name]) : match))
  }
}

/** Apply the bundle against a recording context: slot seats, tab types, dictionaries. */
function applyRecording() {
  const slots = []
  const types = []
  /** What each `ctx.effect` callback returned: a disposer, or nothing. */
  const disposers = []
  let dicts = null
  // Bound lazily: the dictionary only exists after `locale.register` runs.
  const resolve = (k, params) => hostTranslate(dicts?.zh ?? {})(k, params)
  client.apply({
    effect: (fn) => {
      const disposer = fn()
      disposers.push(disposer)
      return disposer
    },
    get: () => undefined,
    locale: { register: (_ns, d) => { dicts = d; return () => {} }, bind: () => resolve },
    slots: {
      inject: (name, run) => run(),
      register: (spec, comp) => {
        slots.push({ spec, comp })
        return () => {}
      },
    },
    sidebarRightTabs: {
      register: (definition) => {
        types.push(definition)
        return () => {}
      },
    },
  })
  return { slots, types, dicts, disposers }
}

const recorded = applyRecording()

/** `t` is the host's own translator; see `hostTranslate`. */
function translator() {
  return hostTranslate(recorded.dicts.zh)
}

function walk(node, out, depth = 0) {
  if (depth > 60 || node === null || node === undefined || node === true || node === false) return out
  if (typeof node === 'string' || typeof node === 'number') {
    out.push(String(node))
    return out
  }
  if (typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) walk(child, out, depth + 1)
    return out
  }
  if (typeof node.type === 'function') {
    walk(node.type(node.props), out, depth + 1)
    return out
  }
  walk(node.children, out, depth + 1)
  if (node.props && typeof node.props === 'object') {
    for (const [key, value] of Object.entries(node.props)) {
      if (key === 'children' || key === 'style' || key === 'key') continue
      if (typeof value === 'string' || typeof value === 'number') out.push(String(value))
      else if (value !== null && typeof value === 'object') walk(value, out, depth + 1)
    }
  }
  return out
}

const textOf = (node) => walk(node, []).join(' ')

/** Every element (expanding components) so a container's style can be inspected. */
function elements(node, out = [], depth = 0) {
  if (depth > 60 || node === null || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) elements(child, out, depth)
    return out
  }
  if (typeof node.type === 'function') {
    elements(node.type(node.props), out, depth + 1)
    return out
  }
  out.push(node)
  elements(node.children, out, depth + 1)
  return out
}

const SNAP = {
  workspace: '/repo',
  sessionCwd: '/repo',
  isGit: true,
  repoSlug: 'me/repo',
  forgeHint: null,
  gh: { available: true, loggedIn: true, source: 'cli' },
  prs: [],
  mergedPrs: [],
  issues: [],
  git: {
    status: { branch: 'issue-197-x', detached: false, dirty: 0, untracked: 0, conflicts: 0, changes: [], changesTotal: 0 },
    branches: [{ name: 'issue-197-x', current: true, remote: false, upstream: null, ahead: 1, behind: 0, gone: false }],
    commits: [],
    remotes: [],
    stashes: 0,
    stashList: [],
    aheadCommits: [],
    currentBranch: 'issue-197-x',
  },
  board: {
    columns: [
      { stage: 'intake', empty: 'no-unconfirmed-issue', cards: [] },
      { stage: 'spec', empty: 'no-spec-pending', cards: [{ issue: 197, title: '移右侧栏', grade: 'standard', columnCount: 8, stageIndex: 2, tickets: [], checks: 'green', prNumber: null, branchName: 'issue-197-x', ahead: 1, stale: false }] },
      { stage: 'dev', empty: 'nothing-in-tdd', cards: [] },
      { stage: 'pr', empty: 'no-branch-awaiting-push', cards: [] },
      { stage: 'ci', empty: 'no-pr-in-ci', cards: [] },
      { stage: 'review', empty: 'no-review-pending', cards: [] },
      { stage: 'merge', empty: 'no-pr-awaiting-merge', cards: [] },
      { stage: 'done', empty: 'nothing-merged-yet', cards: [] },
    ],
    needsUser: [{ kind: 'intake-confirm', issue: 197, prNumber: null }],
    offFlow: [{ reason: 'dirty-main', branch: 'main', issue: null, files: 2 }],
    forgeHint: null,
  },
}

/** The keyed body the host draws for this tab type. */
function body() {
  const entry = recorded.slots.find((r) => r.spec.name === 'sidebar.right.pane.tab')
  assert.ok(entry, 'a sidebar.right.pane.tab body must be registered')
  return entry
}

function renderBody(snap) {
  const t = translator()
  return body().comp({ t, sessionId: 's1', initialSnap: snap })
}

test('the panel is a right-sidebar tab type, not a left-sidebar page', () => {
  const names = recorded.slots.map((r) => r.spec.name)
  assert.equal(names.includes('sidebar.panellist'), false, 'the left-sidebar entry must be gone')
  assert.equal(names.includes('main'), false, 'the full-page main panel must be gone')
  assert.deepEqual([...client.inject].sort(), ['locale', 'sidebarRightTabs', 'slots'])
})

test('every registration is owned by an effect, so unloading releases it', () => {
  // A registration called outside `ctx.effect` still works and still draws —
  // it just never gets released, so a reload stacks a second copy of the tab
  // type and a second body seat. The host gives no warning for that, so the
  // disposers are what prove ownership.
  assert.equal(
    recorded.disposers.length,
    4,
    'dictionaries, the tab type, the body seat and the title seat are each effect-owned',
  )
  for (const [i, disposer] of recorded.disposers.entries()) {
    assert.equal(typeof disposer, 'function', 'effect #' + i + ' must return a disposer')
  }
})

test('the tab type declares an id, a kind, a chip title and a guide card', () => {
  assert.equal(recorded.types.length, 1, 'exactly one tab type')
  const [type] = recorded.types
  // README states this literal as the contract, so the literal is what is pinned.
  // Letting id degrade to the kind would silently undo the whole lesson of #197
  // (a body keyed by kind draws nothing) while every other assertion stays green.
  assert.equal(type.id, 'dev-flow/git-status')
  assert.notEqual(type.id, type.kind, 'the body key must not be the kind: a kind-keyed seat never draws')
  assert.equal(type.kind, 'git-status', 'the page kind is what openTab names')
  // The band that may take a builtin kind over later — the correct one for a
  // bundle installed from outside the product. 'builtin' would throw on a
  // future same-kind product type instead of being outranked.
  assert.equal(type.priority, 'extension', 'an out-of-product bundle declares the extension band')
  assert.equal(typeof type.title, 'function')
  assert.equal(type.title(), 'Git', 'the chip reads the localized label')
  assert.ok(Array.isArray(type.guide) && type.guide.length === 1, 'one guide entry box')
  const [entry] = type.guide
  assert.equal(entry.order, 40, 'README states 40; sits after files (10), terminal (20) and browser (30)')
  assert.equal(entry.title(), 'Git', 'the guide card shows the same label')
  assert.equal(typeof entry.description, 'function')
})

test('the body and the chip title register under the type id, not the kind', () => {
  const [type] = recorded.types
  const seat = body()
  const chip = recorded.slots.find((r) => r.spec.name === 'sidebar.right.pane.tab.title')
  assert.ok(chip, 'a chip title seat keeps the tab readable while a title is live')
  assert.equal(seat.spec.key, type.id, 'the keyed seat dispatches on the definition id')
  assert.equal(chip.spec.key, type.id)
})

test('the body still renders the whole task board', () => {
  const text = textOf(renderBody(SNAP))
  for (const column of ['待处理', '方案中', '开发中', '待 PR', 'CI', '待 review', '待 merge', '已完成']) {
    assert.ok(text.includes(column), 'missing column ' + column)
  }
  assert.match(text, /需要你出手/, 'the needs-you strip survives the move')
  assert.match(text, /未进流程/, 'the off-flow banner survives the move')
  assert.match(text, /#197 移右侧栏/, 'cards render with issue number and title')
  assert.match(text, /当前仓库/, 'repo facts stay available')
})

test('the board stacks vertically so eight columns fit a narrow column', () => {
  // Anchored on the board container ITSELF, not on "some container in the tree
  // is a column": the first version of this test passed while the board had
  // already gone back to a horizontal scroller, because any other column
  // container satisfied it (review axis B, P1-1).
  const boards = elements(renderBody(SNAP)).filter((el) => el.props?.['data-board'] === 'columns')
  assert.equal(boards.length, 1, 'the board renders exactly one column stack')
  const style = boards[0].props.style
  assert.equal(style.flexDirection, 'column', 'the board reads top-down in a 300px column')
  assert.equal(style.overflowX, undefined, 'the board must not scroll horizontally')
  // The page owns the only scroll axis, and it is vertical.
  const scrollers = elements(renderBody(SNAP)).filter((el) => el.props?.style?.overflowX === 'auto' || el.props?.style?.overflowX === 'scroll')
  assert.deepEqual(scrollers, [], 'nothing in this panel scrolls horizontally')
})

test('every message key renders through the host translator without throwing', () => {
  // The panel calls message entries in two shapes. Only ONE is supported by the
  // host: `t(key)` returns the entry FUNCTION, and `t(key, a, b)` makes
  // `translate()` call `.replace` on that function (TypeError, caught by the
  // renderer's error boundary, which leaves an empty shell — the exact symptom
  // this PR exists to remove). This snapshot drives EVERY message path: ticket
  // progress, the stale tip, the needs-you strip, the off-flow banner and a
  // card action line.
  const busy = structuredClone(SNAP)
  busy.board.columns[1].cards = [{
    issue: 197,
    title: '移右侧栏',
    grade: 'standard',
    columnCount: 8,
    stageIndex: 2,
    tickets: [
      { id: 1, title: '改挂', state: 'done' },
      { id: 2, title: '夹具', state: 'done' },
      { id: 3, title: '文档', state: 'todo' },
    ],
    checks: 'red',
    prNumber: 198,
    branchName: 'issue-197-git-panel-right-sidebar',
    ahead: 1,
    stale: true,
    flowStage: 'dev',
    ci: { run: 1, max: 2 },
    review: { state: 'pending-decision' },
    action: { kind: 'merge-gate', prNumber: 198 },
  }]

  let text
  assert.doesNotThrow(() => { text = textOf(renderBody(busy)) }, 'no message key may crash the host translator')
  // The parameterised copy actually reached the screen with its arguments.
  assert.match(text, /ticket 2\/3/, 'ticket progress is formatted')
  assert.match(text, /状态文件写着 dev/, 'the stale tip is formatted')
  assert.match(text, /#197 已建档但还没建分支/, 'the needs-you line is formatted')
  assert.match(text, /在 main 上有未提交改动/, 'the off-flow line is formatted')
  assert.match(text, /PR #198\(issue #197\)等你答是否合并/, 'the card action line is formatted')
})

test('a tab with no Session says so instead of showing another repository', () => {
  // Without a Session id the host answers from the web process's launch
  // directory. That is a DIFFERENT repository rendered as if it were yours, so
  // silence is the failure mode to prevent.
  const t = translator()
  const withSession = textOf(body().comp({ t, sessionId: 's1', initialSnap: SNAP }))
  const withoutSession = textOf(body().comp({ t, sessionId: '', initialSnap: SNAP }))
  assert.equal(withSession.includes('没拿到这个标签页属于哪个会话'), false, 'a bound Session shows no warning')
  assert.match(withoutSession, /没拿到这个标签页属于哪个会话/, 'an unbound tab warns that the repository may be wrong')
})

test('long branch names wrap instead of scrolling the column sideways', () => {
  // A branch name is one unbreakable token. `overflowY: auto` makes the other
  // axis compute to `auto` too, so a 300px column would gain a horizontal
  // scrollbar. Two defences, both asserted: the meta line can break anywhere,
  // and no page root scrolls sideways.
  for (const [label, snap] of [['the board', SNAP], ['the not-a-git empty state', { isGit: false }]]) {
    const roots = elements(renderBody(snap)).filter((el) => el.props?.style?.overflowY === 'auto')
    assert.ok(roots.length > 0, label + ' renders a page root')
    for (const root of roots) {
      assert.equal(root.props.style.overflowX, 'hidden', label + ': the page root never scrolls sideways')
    }
  }
  const metas = elements(renderBody(SNAP)).filter((el) => el.props?.style?.overflowWrap === 'anywhere')
  assert.ok(metas.length > 0, 'the card meta line can break a long token')
})

test('the non-git empty state survives the move', () => {
  assert.match(textOf(renderBody({ isGit: false })), /不是 git 项目/)
})

test('every state owns a scroll container, because the tab body clips', () => {
  // The host draws a tab body inside a pane with `overflow: hidden` (dock kit
  // owns the pane, the body may not scroll it). A panel root that does not
  // scroll itself is silently clipped — the board would be cut off mid-column
  // with no scrollbar anywhere, which looks like "the tab is empty".
  for (const [label, snap] of [
    ['the board', SNAP],
    ['the not-a-git empty state', { isGit: false }],
  ]) {
    const roots = elements(renderBody(snap)).filter((el) => el.props?.style?.overflowY === 'auto')
    assert.ok(roots.length > 0, label + ' must render a vertical scroll container')
  }
})

test('the manifest declares the services the client actually injects', () => {
  // The host resolves a bundle's browser-side dependencies from
  // `dsh.client.inject` (see dsh-client-modules), NOT from this file's own
  // `inject` export. A manifest that still names the left sidebar while the code
  // asks for the right one loads nothing and reports nothing, so the two lists
  // are compared instead of trusted.
  const manifest = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'))
  const declared = manifest.dsh.client.inject

  // Set equality, not "contains": an extra package mounts a module nobody uses
  // and a missing one breaks the load, so both directions are failures. This is
  // the same strength as dsh-inventory's guard over its own inject list.
  assert.deepEqual(
    [...declared].sort(),
    ['@deepseek-ai/dsh-client-locale', '@deepseek-ai/dsh-client-ui-sidebar-right'],
    'dsh.client.inject must be exactly the services this client needs',
  )
})
