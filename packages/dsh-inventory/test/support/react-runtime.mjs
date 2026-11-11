/**
 * Minimal React hooks runtime for rendering the browser half in node.
 *
 * Shared by the client tests: per-component hook namespaces, a synchronous
 * effect pump and a deterministic seedState, so no real React scheduler is
 * needed. See test/client.test.mjs for the original rationale (issue #93).
 */
export function makeReactRuntime() {
  // Per-component hook namespaces (issue #93): every component function owns
  // its slot arrays, so a leaf mounted inside the panel tree (e.g. the
  // credential vault) resolves without clobbering the panel's hook slots.
  const namespaces = new WeakMap()
  let current = null // the component function rendering right now
  let dirty = false
  let effects = [] // effects scheduled during the current render round
  let pendingSeed = null // seedState values for the next root component

  const slotsOf = (component) => {
    if (!namespaces.has(component)) {
      namespaces.set(component, {
        state: { values: [], cursor: 0 },
        effect: { deps: [], cursor: 0 },
        callback: { entries: [], cursor: 0 },
      })
    }
    return namespaces.get(component)
  }

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
      const slots = slotsOf(current)
      const index = slots.state.cursor
      slots.state.cursor += 1
      // seedState targets the first hook slot to run next, mirroring the old
      // global-slot semantics: whichever component consumes hook 0 first.
      if (index === 0 && pendingSeed !== null) {
        pendingSeed.forEach((value, seedIndex) => {
          slots.state.values[seedIndex] = value
        })
        pendingSeed = null
      }
      if (!(index in slots.state.values)) slots.state.values[index] = initial
      return [
        slots.state.values[index],
        (next) => {
          slots.state.values[index] = typeof next === 'function' ? next(slots.state.values[index]) : next
          dirty = true
        },
      ]
    },
    useEffect(fn, deps) {
      const slots = slotsOf(current)
      const index = slots.effect.cursor
      slots.effect.cursor += 1
      const first = !(index in slots.effect.deps)
      if (first || depsChanged(slots.effect.deps[index], deps)) effects.push(fn)
      slots.effect.deps[index] = deps
    },
    useCallback(fn, deps) {
      const slots = slotsOf(current)
      const index = slots.callback.cursor
      slots.callback.cursor += 1
      const prev = slots.callback.entries[index]
      if (prev !== undefined && !depsChanged(prev.deps, deps)) return prev.fn
      slots.callback.entries[index] = { fn, deps }
      return fn
    },
  }
  // Enter a component's namespace for one render pass and reset its cursors;
  // hooks called during the body target that namespace (restored on exit).
  const enter = (component, body) => {
    const previous = current
    const slots = slotsOf(component)
    slots.state.cursor = 0
    slots.effect.cursor = 0
    slots.callback.cursor = 0
    current = component
    try {
      return body()
    } finally {
      current = previous
    }
  }
  /** Expand function components inside the render loop (issue #93). */
  const expand = (node, depth = 0) => {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map((child) => expand(child, depth))
    if (typeof node.type === 'function') {
      if (depth > 32) throw new Error('harness: component expansion too deep')
      return expand(enter(node.type, () => node.type({ ...node.props, children: node.children })), depth + 1)
    }
    return { ...node, children: (node.children ?? []).map((child) => expand(child, depth + 1)) }
  }
  const render = (component, props) => {
    let tree
    for (let round = 0; round < 8; round += 1) {
      dirty = false
      effects = []
      tree = expand(enter(component, () => component(props)))
      for (const fn of effects) fn()
      if (!dirty) break
    }
    return tree
  }
  // Seed hook slots before the next render so a component that reads a fetched
  // value can be rendered deterministically (the runtime has no async
  // scheduler). The first component to consume hook 0 claims the seed.
  const seedState = (values) => {
    pendingSeed = values
  }

  return { React, render, seedState }
}
