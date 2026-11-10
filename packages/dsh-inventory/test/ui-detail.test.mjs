import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { makeReactRuntime } from './support/react-runtime.mjs'

/**
 * UI-detail contract for the browser half (issue #170).
 *
 * The panel renders with inline styles, so hover / focus / motion can only
 * exist in the injected stylesheet — and an inline declaration always outranks
 * one there. These tests pin the rules that keep that split honest:
 *
 *  - every class hook we attach gets a visible focus ring that follows the
 *    control's own shape (WCAG 2.4.11);
 *  - state colour is owned by CSS, not inline, or :hover can never win;
 *  - everything that moves can be quieted by prefers-reduced-motion, and no
 *    rule animates properties nobody chose.
 *
 * They read the shipped artifact (client.js) and the stylesheet the panel
 * actually injects, so deleting a rule turns the matching test red.
 */

const here = dirname(fileURLToPath(import.meta.url))
const clientPath = join(here, '..', 'client.js')

/**
 * Elements that cannot take focus themselves.
 *
 * Layout chrome and decorations: the sticky toolbar, the card shell, the
 * scroll host, the section animation wrapper, the skeleton, the spinner, the
 * fold chevron, the provider bar, the toolbar title and the rail's selected
 * modifier. \`inv-chip-on\` is a variant of \`inv-chip\`, which carries the ring.
 */
const NON_FOCUSABLE = new Set([
  'inv-nav',
  'inv-section-body',
  'inv-card',
  'inv-scroll',
  'inv-skeleton',
  'inv-spin',
  'inv-rail-active',
  'inv-chip-on',
  'inv-chev',
  'inv-provider-fill',
  'inv-nav-title',
])

/** Classes whose look (background/colour) must come from CSS, not inline. */
const CSS_OWNED = new Set(['inv-chip', 'inv-primary', 'inv-link', 'inv-ctrl', 'inv-search-wrap'])

const SNAPSHOT = {
  generatedAt: 1,
  profile: { dir: 'C:/p/desktop', bundles: ['dsh-inventory'] },
  packages: [
    { name: 'dsh-tool-search', version: '0.1.8', declaredBy: ['bundles'], installed: true, loaded: true, orphan: false },
  ],
  rows: [{ id: 'inventory', name: 'dsh-inventory', enabled: true, fiberPhase: 'active', group: false }],
  mcp: [
    { entryId: 'mcp-a', server: 'a-server', transport: 'stdio', enabled: true, fiberPhase: 'active', status: 'connected', toolCount: 0, toolNames: [] },
  ],
  skills: [{ name: 'officecli', description: 'Office CLI', source: 'user-dsh', disabled: false, edges: [] }],
  tools: [],
  edges: [],
  counts: { packages: 1, orphanPackages: 0, rows: 1, mcp: 1, mcpConnected: 1, skills: 1, shadowedSkills: 0, tools: 0, edges: 0 },
  warnings: [],
}

/** Minimal document so installStyles() has somewhere to put its stylesheet. */
function makeDocument() {
  const head = {
    children: [],
    appendChild(node) {
      this.children.push(node)
      node.parentNode = this
      return node
    },
    removeChild() {},
  }
  return {
    head,
    querySelector: () => null,
    createElement: () => ({
      textContent: '',
      attributes: {},
      setAttribute(name, value) {
        this.attributes[name] = value
      },
    }),
  }
}

/** Load the panel with stubbed host + React, and capture its stylesheet. */
async function boot(key) {
  const { React, render } = makeReactRuntime()
  let loaded = null
  globalThis.window = { __ModuleLoader__: { load: (definition) => (loaded = definition) } }
  globalThis.document = makeDocument()
  await import(new URL('../client.js?ui-detail=' + key, import.meta.url).href)
  assert.ok(loaded, 'client module did not register itself')
  const module = loaded.factory(() => React)
  const dictionary = {}
  const injections = []
  const registrations = []
  module.apply({
    effect: (fn) => fn(),
    locale: { register: (namespace, dict) => Object.assign(dictionary, dict.zh), bind: () => (key2) => dictionary[key2] ?? key2 },
    layout: { selectPanel() {} },
    slots: {
      inject: (name, factory) => injections.push({ name, factory }),
      register: (spec, component) => registrations.push({ spec, component }),
    },
  })
  for (const injection of injections) injection.factory()
  const main = registrations.find((entry) => entry.spec.name === 'main')
  assert.ok(main, 'main panel not registered')
  const css = globalThis.document.head.children.map((node) => node.textContent).join('\n')
  assert.ok(css.length > 0, 'the panel injected no stylesheet')
  return { React, render, main, css }
}

/** Render the overview with one snapshot and hand back the tree. */
async function bootReady(key) {
  const booted = await boot(key)
  globalThis.fetch = async () => ({ ok: true, json: async () => SNAPSHOT })
  const injected = booted.main.spec.inject()
  booted.render(booted.main.component, injected)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { ...booted, tree: booted.render(booted.main.component, injected) }
}

/** Class hooks authored in the artifact, one entry per className value. */
function classGroups() {
  const text = readFileSync(clientPath, 'utf8')
  return [...text.matchAll(/'([^']*)'/g)]
    .map((match) => match[1])
    .filter((value) => /^inv-[a-z-]+( inv-[a-z-]+)*$/.test(value))
    .map((value) => value.split(' '))
}

/** Body of the first :focus-visible / :focus-within rule matching any token. */
function focusBody(css, tokens) {
  for (const token of tokens) {
    const rule = new RegExp('\\.' + token + '[^{,]*:(?:focus-visible|focus-within)[^{]*\\{([^}]*)\\}').exec(css)
    if (rule !== null) return rule[1]
  }
  return null
}

/** The prefers-reduced-motion block, brace-matched. */
function reduceBlock(css) {
  const marker = css.indexOf('@media (prefers-reduced-motion: reduce)')
  assert.ok(marker >= 0, 'the stylesheet has no prefers-reduced-motion block')
  const open = css.indexOf('{', marker)
  let depth = 0
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    else if (css[index] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, index)
    }
  }
  throw new Error('unbalanced prefers-reduced-motion block')
}

function classesIn(selectorText) {
  return new Set([...selectorText.matchAll(/\.([a-z][\w-]*)/g)].map((match) => match[1]))
}

/** Every {selector, body} pair, including rules nested in media blocks. */
function rules(css) {
  const found = []
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    found.push({ selector: match[1], body: match[2] })
  }
  return found
}

/** Depth-first walk over a rendered tree. */
function eachNode(node, visit) {
  if (node === null || node === undefined || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) eachNode(child, visit)
    return
  }
  visit(node)
  for (const child of node.children ?? []) eachNode(child, visit)
}

test('every class hook the panel attaches has a visible focus state', async () => {
  const { css } = await boot('focus')
  const missing = []
  for (const group of classGroups()) {
    if (group.some((token) => NON_FOCUSABLE.has(token))) continue
    const body = focusBody(css, group)
    if (body === null) missing.push(group.join(' '))
    // A focus state that draws nothing is not a focus state (WCAG 2.4.11).
    else if (!/(^|[;\s])outline\s*:/.test(body)) missing.push(group.join(' ') + ' (rule without outline)')
  }
  assert.deepEqual(missing, [], 'class hooks without a visible focus indicator: ' + missing.join(' | '))
})

test('the focus ring keeps each control\'s own shape instead of squaring it off', async () => {
  const { css } = await boot('focus-shape')
  // The shared ring used to force border-radius: 10px on every focusable
  // element, which drew a rounded-rectangle ring around the 51x31 pill switch
  // and the 8px rail items. A ring decorates the element, it does not reshape it.
  const ringRules = rules(css).filter((rule) => /:focus-visible/.test(rule.selector) && /outline\s*:/.test(rule.body))
  assert.ok(ringRules.length > 0, 'no focus-visible ring rule found')
  for (const rule of ringRules) {
    assert.doesNotMatch(rule.body, /border-radius\s*:/, rule.selector.trim() + ' reshapes the control it outlines')
  }
})

test('state colour lives in the stylesheet, so :hover is not outranked by inline styles', async () => {
  const { tree } = await bootReady('state-ownership')
  const leaks = []
  eachNode(tree, (node) => {
    const classes = String(node?.props?.className ?? '').split(' ').filter(Boolean)
    if (!classes.some((name) => CSS_OWNED.has(name))) return
    const style = node.props?.style ?? {}
    // opacity is deliberately absent: busy/disabled states dim a chip inline,
    // and hover feedback no longer depends on opacity anywhere.
    for (const property of ['background', 'backgroundColor', 'color', 'transform']) {
      if (style[property] !== undefined) leaks.push(classes.join('.') + ' -> inline ' + property)
    }
  })
  assert.deepEqual(leaks, [], 'inline declarations a :hover rule can never override: ' + leaks.join(' | '))

  const artifact = readFileSync(clientPath, 'utf8')
  for (const selector of ['.inv-chip {', '.inv-primary {', '.inv-link {', '.inv-ctrl {']) {
    assert.ok(artifact.includes(selector), 'the stylesheet must own the base look: missing ' + selector)
  }
})

test('every animated or transitioned class can be quieted by prefers-reduced-motion', async () => {
  const { css } = await boot('reduced')
  const reduce = reduceBlock(css)
  const reduced = new Set()
  for (const rule of rules(reduce)) for (const name of classesIn(rule.selector)) reduced.add(name)

  const moving = []
  for (const rule of rules(css)) {
    if (!/(^|[;\s])(transition|animation|transition-duration|animation-duration)\s*:/.test(rule.body)) continue
    for (const name of classesIn(rule.selector)) {
      if (!reduced.has(name)) moving.push(name)
    }
  }
  assert.deepEqual([...new Set(moving)], [], 'classes that move with no reduced-motion override: ' + [...new Set(moving)].join(', '))
})

test('motion stays scoped and interruptible: no transition-all or will-change-all', async () => {
  const { css } = await boot('scope')
  assert.doesNotMatch(css, /transition\s*:\s*all\b/, 'transition: all animates properties nobody chose')
  assert.doesNotMatch(css, /will-change\s*:\s*all\b/, 'will-change: all is never worth its cost')
})

test('headings balance, captions wrap pretty, and counters use tabular figures', async () => {
  const { tree } = await bootReady('type')
  const styles = []
  eachNode(tree, (node) => {
    if (node?.props?.style !== undefined && node.props.style !== null) styles.push(node.props.style)
  })

  assert.ok(styles.some((style) => style.textWrap === 'balance'), 'no heading asks for balanced wrapping')
  assert.ok(styles.some((style) => style.textWrap === 'pretty'), 'no caption asks for pretty wrapping')

  const title = styles.find((style) => style.fontSize === '28px')
  assert.ok(title, 'the page title (28px) is missing from the rendered output')
  assert.equal(title.textWrap, 'balance', 'the page title must wrap balanced, not leave a widow')

  const tabular = styles.filter((style) => String(style.fontVariantNumeric ?? '').includes('tabular-nums'))
  assert.ok(tabular.length >= 2, 'changing numbers (stats, counts, timestamps) must use tabular figures')
})
