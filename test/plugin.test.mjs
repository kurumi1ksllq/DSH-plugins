/**
 * Contract tests for @local/dsh-prompt-inject.
 *
 * Everything here runs on plain Node: a fake Cordis context captures the
 * system-prompt section and the webServer route, and a fake HTTP request /
 * response pair drives the route handler without listening on a socket.
 * `client.js` is executed through `node:vm` with a stubbed
 * `window.__ModuleLoader__`, so no real Harness runtime is needed either.
 *
 * Run with: node --test prompt-inject/test/plugin.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const read = (name) => readFileSync(join(pkgDir, name), 'utf8')

const plugin = await import(pathToFileURL(join(pkgDir, 'index.js')).href)

const STATE_ROUTE = '/prompt-inject/state'
const STATE_FILE = 'prompt-inject.state.json'
const MAX_TEXT_LENGTH = 200000

// ---------------------------------------------------------------------------
// Fake host context
// ---------------------------------------------------------------------------

function createHostCtx() {
  const sections = []
  const routes = []
  const events = []
  const effects = []
  const ctx = {
    systemPrompt: {
      section(options) {
        sections.push(options)
        return () => {}
      },
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    effect(callback) {
      const disposer = callback()
      effects.push(disposer)
      return disposer
    },
    emit(eventName) {
      events.push(eventName)
    },
  }
  return { ctx, sections, routes, events, effects }
}

function bootHost() {
  const host = createHostCtx()
  plugin.apply(host.ctx, {})
  assert.equal(host.routes.length, 1, 'exactly one HTTP route must be registered')
  return { ...host, route: host.routes[0] }
}

/** Run a route handler against a fake IncomingMessage / ServerResponse. */
async function callRoute(handler, { method = 'GET', headers = {}, body = null, host = '127.0.0.1:22327' } = {}) {
  const chunks = body == null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)]
  const req = Readable.from(chunks)
  req.method = method
  req.headers = Object.assign({ host }, headers)

  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(code, responseHeaders) {
      this.statusCode = code
      this.headers = responseHeaders || {}
      return this
    },
    end(chunk) {
      this.body = chunk == null ? '' : String(chunk)
    },
  }

  await handler(req, res)

  let json = null
  try {
    json = JSON.parse(res.body)
  } catch {
    json = null
  }
  return { status: res.statusCode, headers: res.headers, body: res.body, json }
}

/**
 * Run `fn` with DSH_PROFILE_DIR pointing at a fresh temp directory, restoring
 * the previous environment afterwards.
 */
async function withTempProfile(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-prompt-inject-'))
  const previous = process.env.DSH_PROFILE_DIR
  process.env.DSH_PROFILE_DIR = dir
  try {
    return await fn(dir)
  } finally {
    if (previous === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previous
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Package / static assets
// ---------------------------------------------------------------------------

test('package manifest is a valid DSH bundle and client package', () => {
  const pkg = JSON.parse(read('package.json'))

  assert.equal(pkg.name, '@local/dsh-prompt-inject')
  assert.equal(pkg.version, '0.1.0')
  assert.equal(pkg.private, true)
  assert.equal(pkg.type, 'module')
  assert.equal(pkg.main, 'index.js')
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.ok(existsSync(join(pkgDir, pkg.dsh.bundle.patch)), 'bundle patch must exist')

  assert.equal(pkg.exports['.'], './index.js')
  assert.equal(pkg.exports['./client'], './client.js')
  assert.ok(pkg.exports['./locale/*.json'], 'locale export missing')
  assert.ok(pkg.exports['./icon'], 'icon export missing')

  for (const required of ['index.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md']) {
    assert.ok(pkg.files.includes(required), `files must include ${required}`)
  }
  assert.ok(pkg.files.includes('locale/*.json'), 'files must include locale/*.json')

  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-locale',
  ])
})

test('locale files carry real plugin metadata', () => {
  for (const locale of ['en', 'zh']) {
    const data = JSON.parse(read(`locale/${locale}.json`))
    assert.equal(typeof data.meta.title, 'string')
    assert.equal(typeof data.meta.description, 'string')
    assert.ok(data.meta.title.trim().length > 0, `${locale} title empty`)
    assert.ok(data.meta.description.trim().length > 0, `${locale} description empty`)
    assert.ok(data.meta.description.length > 20, `${locale} description looks like a placeholder`)
    assert.ok(/dsh-prompt-inject/.test(data.meta.title), `${locale} title should name the plugin`)
  }
})

test('bundle patch is a single insert row for the plugin', () => {
  const lines = read('cordis.patch.yml')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))

  assert.equal(lines[0], '- insert:')
  assert.equal(lines[1], '    - id: prompt-inject')
  assert.equal(lines[2], '      name: "@local/dsh-prompt-inject"')
  assert.equal(lines.length, 3, 'patch must not add config overrides')
  for (const line of lines) {
    assert.ok(!line.includes('\t'), 'YAML must use spaces, not tabs')
  }
})

test('icon is a self-contained 64x64 SVG', () => {
  const svg = read('icon.svg')
  assert.match(svg, /^<svg[^>]*width="64"[^>]*height="64"/)
  assert.match(svg, /viewBox="0 0 64 64"/)
  const withoutNamespace = svg.replace(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, '')
  assert.doesNotMatch(withoutNamespace, /https?:\/\//i, 'icon must not reference external resources')
})

// ---------------------------------------------------------------------------
// Host plugin: system-prompt section + webServer route
// ---------------------------------------------------------------------------

test('exports the host services and registers one dynamic section', () => {
  assert.deepEqual(plugin.inject, ['systemPrompt', 'webServer'])
  assert.equal(typeof plugin.apply, 'function')

  const { sections } = bootHost()
  assert.equal(sections.length, 1)
  const [section] = sections
  assert.equal(section.name, 'demo:prompt-inject')
  assert.equal(section.order, 3500)
  assert.equal(section.interpolate, false, 'interpolate must be false')
  assert.equal(typeof section.text, 'function', 'text must be a getter so edits apply without re-registering')
  assert.equal(section.text(), plugin.DEFAULT_TEXT)
})

test('registers the exact HTTP state route through ctx.effect', async () => {
  await withTempProfile(async () => {
    const host = bootHost()
    assert.equal(host.effects.length, 1, 'route registration must be effect-scoped')
    const [route] = host.routes
    assert.equal(route.kind, 'exact')
    assert.equal(route.path, STATE_ROUTE)
    assert.equal(typeof route.handler, 'function')
  })
})

test('defaults apply when config is omitted, empty or null', () => {
  for (const [label, config] of [
    ['omitted', undefined],
    ['empty', {}],
    ['null', null],
  ]) {
    const { ctx, sections } = createHostCtx()
    assert.doesNotThrow(() => plugin.apply(ctx, config), `apply must accept ${label} config`)
    assert.equal(sections.length, 1)
    assert.equal(sections[0].name, 'demo:prompt-inject', `${label}: name default lost`)
    assert.equal(sections[0].order, 3500, `${label}: order default lost`)
    assert.equal(sections[0].text(), plugin.DEFAULT_TEXT, `${label}: default text lost`)
  }
})

test('config overrides name, order and text; invalid values fall back', () => {
  {
    const { ctx, sections } = createHostCtx()
    plugin.apply(ctx, { name: 'custom:section', order: 1200, text: 'custom text' })
    assert.equal(sections[0].name, 'custom:section')
    assert.equal(sections[0].order, 1200)
    assert.equal(sections[0].text(), 'custom text')
    assert.equal(sections[0].interpolate, false, 'interpolate stays false even on override')
  }
  {
    const { ctx, sections } = createHostCtx()
    plugin.apply(ctx, { name: '', order: Number.NaN, text: '' })
    assert.equal(sections[0].name, 'demo:prompt-inject')
    assert.equal(sections[0].order, 3500)
    assert.equal(sections[0].text(), plugin.DEFAULT_TEXT)
  }
})

test('injected text keeps literal placeholders untouched', () => {
  const { ctx, sections } = createHostCtx()
  plugin.apply(ctx, { text: 'literal {{ not_a_placeholder }}' })
  assert.equal(sections[0].text(), 'literal {{ not_a_placeholder }}')
  assert.equal(sections[0].interpolate, false)
})

test('GET returns the default state when nothing is stored', async () => {
  await withTempProfile(async () => {
    const { route, sections } = bootHost()
    const response = await callRoute(route.handler)

    assert.equal(response.status, 200)
    assert.equal(response.headers['content-type'], 'application/json; charset=utf-8')
    assert.equal(response.headers['cache-control'], 'no-store')
    assert.equal(response.json.text, plugin.DEFAULT_TEXT)
    assert.equal(response.json.updatedAt, 0)
    assert.equal(sections[0].text(), plugin.DEFAULT_TEXT)
  })
})

test('POST persists the text, updates the live section and emits the change event', async () => {
  await withTempProfile(async (dir) => {
    const { route, sections, events } = bootHost()
    const nextText = '## Custom injected prompt\n\nhello from the editor'
    const response = await callRoute(route.handler, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:22327' },
      body: JSON.stringify({ text: nextText }),
    })

    assert.equal(response.status, 200)
    assert.equal(response.json.text, nextText)
    assert.equal(typeof response.json.updatedAt, 'number')
    assert.ok(response.json.updatedAt > 0)

    assert.equal(sections[0].text(), nextText, 'section getter must return the new text')
    assert.deepEqual(events, ['system-prompt/change'])

    const statePath = join(dir, STATE_FILE)
    assert.ok(existsSync(statePath), 'state file must be written')
    const stored = JSON.parse(readFileSync(statePath, 'utf8'))
    assert.equal(stored.text, nextText)
    assert.equal(stored.updatedAt, response.json.updatedAt)

    const getAgain = await callRoute(route.handler)
    assert.equal(getAgain.json.text, nextText)
    assert.equal(getAgain.json.updatedAt, response.json.updatedAt)
  })
})

test('POST rejects empty, non-string and oversized text with 400', async () => {
  await withTempProfile(async () => {
    const { route, sections, events } = bootHost()
    const before = sections[0].text()

    for (const payload of [{ text: '' }, { text: 42 }, { text: 'x'.repeat(MAX_TEXT_LENGTH + 1) }, {}]) {
      const response = await callRoute(route.handler, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      assert.equal(response.status, 400, `payload ${JSON.stringify(payload).slice(0, 40)} must be rejected`)
      assert.deepEqual(response.json, { error: 'invalid-text' })
    }

    assert.equal(sections[0].text(), before, 'memory must not change on invalid input')
    assert.deepEqual(events, [])
  })
})

test('POST rejects cross-origin requests with 403', async () => {
  await withTempProfile(async () => {
    const { route, events } = bootHost()
    const body = JSON.stringify({ text: 'malicious' })

    for (const headers of [
      { 'content-type': 'application/json', origin: 'https://evil.example' },
      { 'content-type': 'application/json', origin: 'http://127.0.0.1:22327', 'sec-fetch-site': 'cross-site' },
      { 'content-type': 'application/json', origin: 'null' },
    ]) {
      const response = await callRoute(route.handler, { method: 'POST', headers, body })
      assert.equal(response.status, 403, `headers ${JSON.stringify(headers)} must be forbidden`)
      assert.deepEqual(response.json, { error: 'forbidden-origin' })
    }
    assert.deepEqual(events, [])
  })
})

test('POST accepts a same-origin request', async () => {
  await withTempProfile(async () => {
    const { route } = bootHost()
    const response = await callRoute(route.handler, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://127.0.0.1:22327' },
      body: JSON.stringify({ text: 'same origin text' }),
    })
    assert.equal(response.status, 200)
    assert.equal(response.json.text, 'same origin text')
  })
})

test('POST rejects malformed JSON with 400', async () => {
  await withTempProfile(async () => {
    const { route } = bootHost()
    const response = await callRoute(route.handler, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    assert.equal(response.status, 400)
    assert.deepEqual(response.json, { error: 'invalid-json' })
  })
})

test('unsupported methods return 405', async () => {
  await withTempProfile(async () => {
    const { route } = bootHost()
    const response = await callRoute(route.handler, { method: 'PUT' })
    assert.equal(response.status, 405)
    assert.equal(response.json.error, 'method-not-allowed')
    assert.match(response.headers.allow, /GET/)
    assert.match(response.headers.allow, /POST/)
  })
})

test('oversized request bodies are rejected without touching memory', async () => {
  await withTempProfile(async () => {
    const { route, sections } = bootHost()
    const before = sections[0].text()
    const response = await callRoute(route.handler, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'x'.repeat(300 * 1024) }),
    })
    assert.equal(response.status, 413)
    assert.equal(response.json.error, 'payload-too-large')
    assert.equal(sections[0].text(), before)
  })
})

test('corrupt or invalid state files fall back to the default text', async () => {
  for (const content of ['{not valid json', JSON.stringify({ text: 42, updatedAt: 7 }), JSON.stringify({ text: '' })]) {
    await withTempProfile(async (dir) => {
      writeFileSync(join(dir, STATE_FILE), content, 'utf8')
      const { route, sections } = bootHost()
      assert.equal(sections[0].text(), plugin.DEFAULT_TEXT)
      const response = await callRoute(route.handler)
      assert.equal(response.json.text, plugin.DEFAULT_TEXT)
      assert.equal(response.json.updatedAt, 0)
    })
  }
})

test('a state file with a valid text is loaded at startup', async () => {
  await withTempProfile(async (dir) => {
    const stored = { text: 'persisted text', updatedAt: 12345 }
    writeFileSync(join(dir, STATE_FILE), JSON.stringify(stored), 'utf8')
    const { route, sections } = bootHost()
    assert.equal(sections[0].text(), 'persisted text')
    const response = await callRoute(route.handler)
    assert.deepEqual(response.json, stored)
  })
})

test('write failures return 500 and leave memory unchanged', async () => {
  await withTempProfile(async (dir) => {
    const blocker = join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory', 'utf8')
    const previous = process.env.DSH_PROFILE_DIR
    process.env.DSH_PROFILE_DIR = blocker
    try {
      const { route, sections, events } = bootHost()
      const before = sections[0].text()
      const response = await callRoute(route.handler, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'should not persist' }),
      })
      assert.equal(response.status, 500)
      assert.equal(response.json.error, 'persist-failed')
      assert.equal(typeof response.json.message, 'string')
      assert.equal(sections[0].text(), before, 'memory must roll back on persist failure')
      assert.deepEqual(events, [])
      const getAgain = await callRoute(route.handler)
      assert.equal(getAgain.json.text, before)
    } finally {
      process.env.DSH_PROFILE_DIR = previous
    }
  })
})

test('falls back to DSH_HOME when DSH_PROFILE_DIR is absent', async () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-prompt-inject-home-'))
  const previousProfile = process.env.DSH_PROFILE_DIR
  const previousHome = process.env.DSH_HOME
  delete process.env.DSH_PROFILE_DIR
  process.env.DSH_HOME = home
  try {
    const { route } = bootHost()
    const response = await callRoute(route.handler, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: 'via dsh home' }),
    })
    assert.equal(response.status, 200)
    const statePath = join(home, 'prompt-inject', 'state.json')
    assert.ok(existsSync(statePath), 'state must be written below DSH_HOME')
    assert.equal(JSON.parse(readFileSync(statePath, 'utf8')).text, 'via dsh home')
  } finally {
    if (previousProfile === undefined) delete process.env.DSH_PROFILE_DIR
    else process.env.DSH_PROFILE_DIR = previousProfile
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
    rmSync(home, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Client plugin (vm, ModuleLoader format)
// ---------------------------------------------------------------------------

const fakeReact = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children }
  },
  useState(initial) {
    return [initial, () => {}]
  },
  useEffect() {},
  useCallback(fn) {
    return fn
  },
  useRef(value) {
    return { current: value }
  },
  Fragment: 'Fragment',
}

function loadClientDefinition() {
  const source = read('client.js')
  let definition = null
  const window = {
    __ModuleLoader__: {
      load(value) {
        definition = value
      },
    },
  }
  const sandbox = { window, console, fetch: () => Promise.reject(new Error('no network in tests')), setTimeout, clearTimeout }
  vm.runInNewContext(source, sandbox, { filename: 'client.js' })
  assert.ok(definition, 'client.js must call window.__ModuleLoader__.load')
  return { definition, source }
}

function createClientCtx() {
  const slotRegistrations = []
  const localeRegistrations = []
  const layoutCalls = []
  const effects = []
  const ctx = {
    effect(callback) {
      const disposer = callback()
      effects.push(disposer)
      return disposer
    },
    locale: {
      register(namespace, dictionaries) {
        localeRegistrations.push({ namespace, dictionaries })
        return () => {}
      },
      bind(namespace) {
        return (key) => `${namespace}:${key}`
      },
    },
    slots: {
      inject(name, callback) {
        slotRegistrations.push({ name, registration: callback() })
        return () => {}
      },
      register(options, component) {
        return { options, component }
      },
    },
    layout: {
      selectPanel(panel) {
        layoutCalls.push(panel)
      },
    },
  }
  return { ctx, slotRegistrations, localeRegistrations, layoutCalls, effects }
}

test('client.js is a ModuleLoader module that only requires react', () => {
  const { definition, source } = loadClientDefinition()
  assert.equal(definition.id, '@local/dsh-prompt-inject')
  assert.equal(typeof definition.factory, 'function')

  const required = []
  const moduleExports = definition.factory((id) => {
    required.push(id)
    if (id === 'react') return fakeReact
    throw new Error(`unexpected require: ${id}`)
  })

  assert.deepEqual(required, ['react'], 'client must not require Harness packages')
  // Arrays created inside the vm sandbox have another realm's prototype, so
  // copy into this realm before the strict comparison.
  assert.deepEqual(Array.from(moduleExports.inject), ['slots', 'locale', 'layout'])
  assert.equal(typeof moduleExports.apply, 'function')
  assert.match(source, /\/prompt-inject\/state/)
  assert.match(source, /POST/)
  assert.doesNotMatch(source, /@deepseek-ai\/dsh-client/)
  assert.doesNotMatch(source, /\bimport\s/)
})

test('client registers sidebar button and main panel with matching ids', () => {
  const { definition } = loadClientDefinition()
  const moduleExports = definition.factory((id) => {
    if (id === 'react') return fakeReact
    throw new Error(`unexpected require: ${id}`)
  })
  const { ctx, slotRegistrations } = createClientCtx()
  moduleExports.apply(ctx)

  const sidebar = slotRegistrations.find((entry) => entry.name === 'sidebar.panellist')
  const main = slotRegistrations.find((entry) => entry.name === 'main')

  assert.ok(sidebar, 'sidebar.panellist registration missing')
  assert.equal(sidebar.registration.options.id, 'prompt-inject')
  assert.equal(sidebar.registration.options.order, 20)
  assert.equal(typeof sidebar.registration.options.label, 'function')
  assert.equal(sidebar.registration.options.label(), 'prompt-inject:panel')
  assert.equal(typeof sidebar.registration.component, 'function')

  assert.ok(main, 'main panel registration missing')
  assert.equal(main.registration.options.key, 'prompt-inject')
  assert.equal(typeof main.registration.options.inject, 'function')
  const props = main.registration.options.inject()
  assert.equal(typeof props.t, 'function')
  assert.equal(typeof props.back, 'function')
  assert.equal(typeof main.registration.component, 'function')
})

test('client registers zh/en dictionaries and back button clears the panel', () => {
  const { definition } = loadClientDefinition()
  const moduleExports = definition.factory((id) => {
    if (id === 'react') return fakeReact
    throw new Error(`unexpected require: ${id}`)
  })
  const { ctx, localeRegistrations, layoutCalls, slotRegistrations } = createClientCtx()
  moduleExports.apply(ctx)

  assert.equal(localeRegistrations.length, 1)
  const [{ namespace, dictionaries }] = localeRegistrations
  assert.equal(namespace, 'prompt-inject')
  assert.deepEqual(Object.keys(dictionaries).sort(), ['en', 'zh'])

  for (const locale of ['zh', 'en']) {
    const dict = dictionaries[locale]
    for (const key of ['panel', 'title', 'description', 'placeholder', 'confirm', 'saving', 'saved', 'loading', 'back']) {
      assert.equal(typeof dict[key], 'string', `${locale}.${key} missing`)
      assert.ok(dict[key].trim().length > 0, `${locale}.${key} empty`)
    }
    for (const key of ['load', 'save', 'empty']) {
      assert.equal(typeof dict.error[key], 'string', `${locale}.error.${key} missing`)
      assert.ok(dict.error[key].trim().length > 0, `${locale}.error.${key} empty`)
    }
  }

  const main = slotRegistrations.find((entry) => entry.name === 'main')
  main.registration.options.inject().back()
  assert.deepEqual(layoutCalls, [null])
})
