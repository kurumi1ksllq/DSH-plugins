import { test, after } from 'node:test'
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
 *    control's own shape (WCAG 2.2 SC 2.4.13 Focus Appearance), drawn where a
 *    card cannot clip it (SC 2.4.11 Focus Not Obscured);
 *  - state colour is owned by CSS, not inline, or :hover can never win;
 *  - everything that moves can be quieted by prefers-reduced-motion, and no
 *    rule animates properties nobody chose;
 *  - no stylesheet class is dead: the panel actually attaches all of them.
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
  // The search shell is not focusable; the input inside it draws the ring.
  'inv-search-wrap',
])

/** Classes whose look (background/colour) must come from CSS, not inline. */
const CSS_OWNED = ['inv-chip', 'inv-primary', 'inv-link', 'inv-ctrl', 'inv-search-wrap']

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

// The panel reads these off globalThis; leave the process as we found it.
const globalsToRestore = ['window', 'document', 'fetch']
const saved = new Map(globalsToRestore.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
after(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor === undefined) delete globalThis[name]
    else Object.defineProperty(globalThis, name, descriptor)
  }
})

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

/** Render the overview with one snapshot and hand back the tree + stylesheet. */
async function bootReady(key) {
  const booted = await boot(key)
  globalThis.fetch = async () => ({ ok: true, json: async () => SNAPSHOT })
  const injected = booted.main.spec.inject()
  booted.render(booted.main.component, injected)
  await new Promise((resolve) => setTimeout(resolve, 0))
  return { ...booted, tree: booted.render(booted.main.component, injected) }
}

/**
 * Class hooks authored in the artifact, one entry per className expression.
 *
 * Read per \`className:\` expression rather than by pairing quotes across the
 * file: comments contain apostrophes, and a global quote scan silently drops
 * the literals that fall inside them (this is how inv-link / inv-ctrl went
 * unattached while the suite stayed green). Ternaries yield both branches.
 */
function classGroups() {
  const text = readFileSync(clientPath, 'utf8')
  const groups = []
  for (const expression of text.matchAll(/className:\s*([^\n]+)/g)) {
    for (const literal of expression[1].matchAll(/'([^']*)'/g)) {
      if (/^inv-[a-z-]+( inv-[a-z-]+)*$/.test(literal[1])) groups.push(literal[1].split(' '))
    }
  }
  return groups
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
    const focusable = group.filter((token) => !NON_FOCUSABLE.has(token))
    // A group made only of chrome needs no ring; one with a real control does,
    // even when it also carries a decorative class.
    if (focusable.length === 0) continue
    const body = focusBody(css, focusable)
    if (body === null) missing.push(group.join(' '))
    // A focus state that draws nothing is not a focus state.
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
  const { tree, css } = await bootReady('state-ownership')
  const leaks = []
  eachNode(tree, (node) => {
    const classes = String(node?.props?.className ?? '').split(' ').filter(Boolean)
    if (!classes.some((name) => CSS_OWNED.includes(name))) return
    const style = node.props?.style ?? {}
    // opacity is deliberately absent: busy/disabled states dim a chip inline,
    // and hover feedback no longer depends on opacity anywhere.
    for (const property of ['background', 'backgroundColor', 'color', 'transform']) {
      if (style[property] !== undefined) leaks.push(classes.join('.') + ' -> inline ' + property)
    }
  })
  assert.deepEqual(leaks, [], 'inline declarations a :hover rule can never override: ' + leaks.join(' | '))

  // And the base look has to come from the stylesheet, not from a leftover token.
  for (const name of CSS_OWNED) {
    const owns = rules(css).some((rule) => classesIn(rule.selector).has(name) && /(^|[;\s])background(-color)?\s*:/.test(rule.body))
    assert.ok(owns, '.inv-style rule missing a background for ' + name)
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

test('no class in the stylesheet is dead: every one is attached by the panel', async () => {
  const { css } = await boot('orphans')
  const attached = new Set(classGroups().flat())
  const orphan = [...classesIn(css)].filter((name) => name.startsWith('inv-') && !attached.has(name))
  assert.deepEqual(orphan, [], 'stylesheet rules that no rendered element can ever match: ' + orphan.join(', '))
})

/** Text of a rendered subtree, for label comparisons. */
function textOf(node) {
  if (node === null || node === undefined || node === false) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  return textOf(node.children)
}

/** Depth-first search for the first matching node. */
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

/** Labels of the left-hand navigation rail, in render order. */
function railLabels(tree) {
  const nav = findNode(tree, (node) => node.type === 'nav')
  assert.ok(nav, 'no navigation rail in the tree')
  const labels = []
  eachNode(nav, (node) => {
    if (node?.type === 'button' && typeof node.props?.['aria-label'] === 'string') labels.push(node.props['aria-label'])
  })
  return labels
}

test('loading and error use the same two-column shell as the ready state', async () => {
  const ready = await bootReady('shell-ready')
  const readyLabels = railLabels(ready.tree)
  assert.ok(readyLabels.length >= 6, 'the ready rail should list every view')

  // Loading: the first paint must already be the rail layout, not the old
  // single column that only grows a rail once data arrives.
  const loading = await boot('shell-loading')
  globalThis.fetch = () => new Promise(() => {})
  const loadingTree = loading.render(loading.main.component, loading.main.spec.inject())
  assert.deepEqual(railLabels(loadingTree), readyLabels, 'loading must show the same rail (counts omitted)')
  assert.ok(
    findNode(loadingTree, (node) => String(node.props?.className ?? '') === 'inv-scroll'),
    'loading must render the scroll host, or the shell jumps when data lands',
  )
  assert.ok(
    findNode(loadingTree, (node) => String(node.props?.className ?? '') === 'inv-skeleton'),
    'loading must show the skeleton where the list will appear',
  )

  const railButtons = []
  eachNode(loadingTree, (node) => {
    if (node?.type === 'button' && typeof node.props?.['aria-label'] === 'string') railButtons.push(node)
  })
  assert.ok(railButtons.length >= 6, 'the loading rail is missing its buttons')
  for (const button of railButtons) {
    assert.equal(
      textOf(button).trim(),
      button.props['aria-label'],
      'loading must not show rail counts before the snapshot lands',
    )
  }
  const readyButtons = []
  eachNode(ready.tree, (node) => {
    if (node?.type === 'button' && typeof node.props?.['aria-label'] === 'string') readyButtons.push(node)
  })
  assert.ok(
    readyButtons.some((button) => textOf(button).trim() !== button.props['aria-label']),
    'the ready rail does show counts, so the loading assertion above is meaningful',
  )

  // Do not leave a never-settling stub behind for later tests.
  globalThis.fetch = async () => ({ ok: true, json: async () => SNAPSHOT })

  // Error: same shell, plus a usable retry.
  const failed = await boot('shell-error')
  globalThis.fetch = async () => {
    throw new Error('boom')
  }
  const failedInjected = failed.main.spec.inject()
  failed.render(failed.main.component, failedInjected)
  await new Promise((resolve) => setTimeout(resolve, 0))
  const errorTree = failed.render(failed.main.component, failedInjected)
  assert.deepEqual(railLabels(errorTree), readyLabels, 'the error state keeps the same rail')
  assert.ok(
    findNode(errorTree, (node) => String(node.props?.className ?? '') === 'inv-scroll'),
    'the error state must render the scroll host too',
  )
  assert.ok(
    findNode(errorTree, (node) => node.type === 'button' && String(node.props?.className ?? '').includes('inv-primary')),
    'the error state must keep a retry button',
  )

  // All three states wear the same header chrome (title span included), even
  // though only the ready state can show the toolbar chips.
  for (const [state, tree] of [['loading', loadingTree], ['error', errorTree]]) {
    const title = findNode(tree, (node) => String(node.props?.className ?? '') === 'inv-nav-title')
    assert.ok(title, state + ' state is missing the header title span')
  }
})

test('a control looks like a control, and a heading reads as a heading', async () => {
  const { css, tree } = await bootReady('affordance')

  // Form, not just colour: a toggle needs an outline plus a fill.
  const chipRule = rules(css).find((rule) => classesIn(rule.selector).has('inv-chip') && /background/.test(rule.body))
  assert.ok(chipRule, 'no background rule for .inv-chip')
  assert.match(
    chipRule.body,
    /border\s*:\s*1px\s+solid/,
    '.inv-chip needs a drawn 1px outline, not only a tint or a border-color: ' + chipRule.body.trim(),
  )

  // Icon and text buttons (back, refresh, section headers) had no hover at all.
  const flatButtonHover = rules(css).find(
    (rule) => /[.]inv-btn[^{,]*:hover/.test(rule.selector) && /background/.test(rule.body),
  )
  assert.ok(flatButtonHover, '.inv-btn needs a hover fill, otherwise it reads as a static label')
  const hoverFills = flatButtonHover.body
    .split(String.fromCharCode(10))
    .map((line) => line.trim())
    .filter((line) => line.startsWith('background'))
  assert.ok(hoverFills.length > 0, '.inv-btn hover declares no background at all')
  for (const declaration of hoverFills) {
    assert.doesNotMatch(declaration, /background(-color)?\s*:\s*transparent/, 'a transparent hover paints nothing: ' + declaration)
  }
  // The generic hover must not repaint chips or filled primaries, which own
  // their fill: a shared 8% tint would turn the dark pill grey on hover.
  // Ignore the :not() guards themselves: what matters is the rules the hover
  // actually paints, i.e. the selector with those guards stripped.
  const painted = flatButtonHover.selector.replace(/:not\([^)]*\)/g, '')
  assert.doesNotMatch(painted, /[.]inv-chip|[.]inv-primary/, 'the flat-button hover leaks onto chips/primaries')

  // Section headers keep full-strength title text, so they do not compete with
  // the softer, outlined controls.
  const disclosure = findNode(tree, (node) => node?.props?.['aria-expanded'] !== undefined && node.type === 'button')
  assert.ok(disclosure, 'no disclosure header found')
  assert.equal(
    disclosure.props?.style?.background,
    undefined,
    'an inline background on the header kills its :hover (the issue #170 trap again)',
  )
  const colours = []
  eachNode(disclosure, (node) => {
    if (typeof node?.props?.style?.color === 'string') colours.push(node.props.style.color)
  })
  assert.ok(
    colours.some((colour) => colour.includes('label-primary')),
    'the section title must use the primary label colour, got: ' + JSON.stringify(colours),
  )

  // A toggle is not a disclosure: the two affordances never share an element.
  const both = findNode(tree, (node) => {
    const classes = String(node?.props?.className ?? '').split(' ')
    return classes.includes('inv-chip') && node?.props?.['aria-expanded'] !== undefined
  })
  assert.equal(both, null, 'an element cannot be both a toggle and a section header')
})
