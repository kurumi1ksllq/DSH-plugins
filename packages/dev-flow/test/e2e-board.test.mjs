import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'

import { getSnapshot, invalidateSnapshot } from '../lib-git-status/snapshot.js'

/**
 * The end-to-end contract the two halves actually share.
 *
 * Every other test stops at a boundary: the snapshot tests never render, and the
 * render tests are fed hand-written snapshots. That is how `flowStates` as a Map
 * shipped broken — both sides were green while the wire carried `{}`.
 *
 * So this test crosses every boundary in order:
 *   real git repo -> getSnapshot() -> JSON.stringify (the HTTP route) -> JSON.parse
 *   -> the REAL client bundle -> rendered text.
 */

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, '..', 'client.js'), 'utf8')
const GIT = process.env.GIT_IN_PATH ?? 'git'

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
          captured = factory((name) =>
            name === 'react'
              ? { createElement, useState: (v) => [v === true ? false : v, () => {}], useEffect: () => {}, useCallback: (f) => f, useMemo: (f) => f() }
              : {},
          )
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

function realDictionary() {
  let dicts = null
  client.apply({
    effect: (fn) => fn(),
    get: () => undefined,
    locale: { register: (_ns, d) => { dicts = d }, bind: () => (k) => k },
    slots: { inject: (_n, run) => run(), register: () => ({}) },
    layout: { selectPanel: () => {} },
  })
  return dicts.zh
}

/** Render one wire payload through the real panel component. */
function renderWire(wire) {
  const dict = realDictionary()
  const registered = []
  client.apply({
    effect: () => {},
    get: () => undefined,
    locale: { register: () => {}, bind: () => (k) => k },
    slots: { inject: (_n, run) => run(), register: (spec, comp) => registered.push({ spec, comp }) },
    layout: { selectPanel: () => {} },
  })
  const Panel = registered.find((r) => r.spec.name === 'main').comp
  const t = (k, ...args) => {
    const entry = dict[k]
    if (typeof entry === 'function') return args.length > 0 ? entry(...args) : entry
    if (entry !== undefined) return entry
    return args.length > 0 ? `${k}:${args.join(',')}` : String(k)
  }
  const tree = Panel({ t, sessionId: 's1', initialSnap: wire })
  const out = []
  const walk = (node, depth = 0) => {
    if (depth > 60 || node === null || node === undefined || node === true || node === false) return
    if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return }
    if (typeof node !== 'object') return
    if (Array.isArray(node)) { for (const c of node) walk(c, depth + 1); return }
    if (typeof node.type === 'function') { walk(node.type(node.props), depth + 1); return }
    walk(node.children, depth + 1)
    if (node.props && typeof node.props === 'object') {
      for (const [k, v] of Object.entries(node.props)) {
        if (k === 'children' || k === 'style' || k === 'key') continue
        if (typeof v === 'string' || typeof v === 'number') out.push(String(v))
        else if (v !== null && typeof v === 'object') walk(v, depth + 1)
      }
    }
  }
  walk(tree)
  return { text: out.join(' '), wire }
}

function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-board-'))
  execFileSync(GIT, ['init', '-b', 'main'], { cwd: dir })
  execFileSync(GIT, ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync(GIT, ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  execFileSync(GIT, ['add', '.'], { cwd: dir })
  execFileSync(GIT, ['commit', '-m', 'init'], { cwd: dir })
  execFileSync(GIT, ['switch', '-c', 'issue-42-e2e'], { cwd: dir })
  return dir
}

function writeFlow(dir, issue) {
  const flowDir = join(dir, 'docs', 'specs', '.flow')
  mkdirSync(flowDir, { recursive: true })
  writeFileSync(join(flowDir, `${issue}.json`), JSON.stringify({
    issue,
    grade: 'trivial',
    stage: 'dev',
    updatedAt: '2026-11-03T06:00:00+08:00',
    tickets: [{ id: 1, title: 'x', state: 'green' }],
    ci: null,
    review: null,
    merge: null,
  }))
}

async function wireSnapshot(dir) {
  invalidateSnapshot()
  const snap = await getSnapshot({ env: {}, sessionCwd: dir })
  // Exactly what the HTTP route sends and the browser receives.
  return JSON.parse(JSON.stringify(snap))
}

test('a flow-recorded task reaches the rendered panel with its grade intact', async () => {
  const dir = repo()
  writeFlow(dir, 42)
  const wire = await wireSnapshot(dir)
  assert.equal(wire.flowStates['42'].grade, 'trivial', 'state must survive the wire')

  const { text } = renderWire(wire)
  assert.ok(text.includes('trivial'), 'the grade badge must reach the DOM')
  assert.ok(text.includes('#42'), 'the card must render')
})

test('the panel renders the eight columns from a real snapshot', async () => {
  const dir = repo()
  const wire = await wireSnapshot(dir)
  const { text } = renderWire(wire)
  for (const label of ['待处理', '方案中', '开发中', '待 PR', 'CI', '待 review', '待 merge', '已完成']) {
    assert.ok(text.includes(label), `missing column ${label}`)
  }
})

test('a dirty trunk surfaces the off-flow banner end to end', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'e2e-dirty-'))
  execFileSync(GIT, ['init', '-b', 'main'], { cwd: dir })
  execFileSync(GIT, ['config', 'user.email', 'test@example.com'], { cwd: dir })
  execFileSync(GIT, ['config', 'user.name', 'Test'], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'hello\n')
  execFileSync(GIT, ['add', '.'], { cwd: dir })
  execFileSync(GIT, ['commit', '-m', 'init'], { cwd: dir })
  writeFileSync(join(dir, 'a.txt'), 'changed\n')

  const wire = await wireSnapshot(dir)
  const { text } = renderWire(wire)
  assert.ok(text.includes('未进流程'), 'the banner must reach the DOM')
  assert.ok(text.includes('dev-flow 禁止直接改主干'))
})

test('the host board and the rendered board agree on the same issue set', async () => {
  const dir = repo()
  writeFlow(dir, 42)
  const wire = await wireSnapshot(dir)
  const hostCards = wire.board.columns.flatMap((c) => c.cards).map((c) => c.issue)
  const { text } = renderWire(wire)
  for (const issue of hostCards) {
    if (issue === null) continue
    assert.ok(text.includes(`#${issue}`), `host card #${issue} was not rendered`)
  }
})
