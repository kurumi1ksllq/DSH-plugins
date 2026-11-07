/**
 * Contract tests for the prompt-inject half absorbed into dsh-inventory (#111).
 *
 * Everything here runs on plain Node: a fake Cordis context captures the
 * system-prompt section and the webServer route, and a fake HTTP request /
 * response pair drives the route handler without listening on a socket.
 * The old client half (a zero-consumer dictionary) was removed with the merge;
 * the live editor renders from dsh-inventory's own client.js.
 *
 * Run with: node --test test/prompt-inject.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, join } from 'node:path'
import test from 'node:test'
import vm from 'node:vm'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..')
const read = (name) => readFileSync(join(pkgDir, name), 'utf8')

const plugin = await import(pathToFileURL(join(pkgDir, 'lib-prompt-inject.js')).href)

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

test('prompt-inject implementation is wired into the dsh-inventory manifest (#111/T2.inv)', () => {
  const pkg = JSON.parse(read('package.json'))

  // The absorbing package owns the manifest; the migrated half must be reachable
  // through its subpath export and declared in files.
  assert.equal(pkg.name, 'dsh-inventory')
  assert.equal(pkg.exports['./prompt-inject'], './lib-prompt-inject.js')
  assert.ok(pkg.files.includes('lib-prompt-inject.js'), 'files must include lib-prompt-inject.js')
  assert.ok(pkg.files.includes('VERIFICATION.md'), 'files must include VERIFICATION.md')
  assert.ok(pkg.files.includes('locale/*.json'), 'files must include locale/*.json')

  assert.equal(pkg.dsh.client.platform, 'web')
  assert.equal(pkg.dsh.client.immediately, true)
  assert.deepEqual(pkg.dsh.client.inject, [
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-locale',
  ])
})

test('the bundle patch keeps its three rows in one insert block (#111)', () => {
  const rows = read('cordis.patch.yml')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '' && !line.trimStart().startsWith('#'))
  assert.equal(rows[0], '- insert:', 'a single insert block')
  assert.equal(rows.filter((r) => r.trim() === '- insert:').length, 1, 'no second insert block (spec 单块多行口径)')
  const ids = rows.filter((r) => /- id: /.test(r)).map((r) => r.trim().slice(6))
  assert.deepEqual(ids, ['inventory', 'inventory-gate', 'prompt-inject'])
  for (const line of rows) {
    assert.ok(!line.includes('\t'), 'YAML must use spaces, not tabs')
    assert.ok(!/config:/.test(line), 'patch must not add config overrides')
  }
})

// ---------------------------------------------------------------------------
// Host plugin: system-prompt section + webServer route
// ---------------------------------------------------------------------------

test('exports the host services and registers one dynamic section', async () => {
  // 状态路径必须隔离:插件会把宿主真实 state.json 的持久化文本当作 currentText(T0.3)
  await withTempProfile(async () => {
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

test('defaults apply when config is omitted, empty or null', async () => {
  // 状态路径必须隔离(T0.3)
  await withTempProfile(async () => {
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
})

test('config overrides name, order and text; invalid values fall back', async () => {
  // 状态路径必须隔离(T0.3)
  await withTempProfile(async () => {
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

test('a whitespace-only text is rejected with 400, not stored', async () => {
  await withTempProfile(async () => {
    const host = bootHost()
    const res = await callRoute(host.route.handler, { method: 'POST', body: JSON.stringify({ text: '   \n\t  ' }) })
    assert.equal(res.status, 400, 'whitespace-only must be invalid-text')
    assert.deepEqual(res.json, { error: 'invalid-text' })
    const after = await callRoute(host.route.handler, { method: 'GET' })
    assert.notEqual(after.json.text.trim(), '', 'the stored text must be untouched')
  })
})

test('persisting leaves exactly one .bak generation of the previous state (#111)', async () => {
  await withTempProfile(async () => {
    const host = bootHost()
    await callRoute(host.route.handler, { method: 'POST', body: JSON.stringify({ text: 'first version' }) })
    const stateFile = host.route.stateFile ?? null
    // 直接以文件系统为准:POST 两次后应存在 .bak,内容是第一版
    await callRoute(host.route.handler, { method: 'POST', body: JSON.stringify({ text: 'second version' }) })
    const profileDir = process.env.DSH_PROFILE_DIR
    const bak = readFileSync(join(profileDir, STATE_FILE) + '.bak', 'utf8')
    assert.equal(JSON.parse(bak).text, 'first version', '.bak must hold the previous generation')
    const cur = readFileSync(join(profileDir, STATE_FILE), 'utf8')
    assert.equal(JSON.parse(cur).text, 'second version')
  })
})

test('an oversized body answers 413 and drains the request (#111)', async () => {
  await withTempProfile(async () => {
    const host = bootHost()
    // readJsonBody 的上限是 body 字节(256KiB),不是 text 字符数:
    // 超 256KiB 的原始 body 才走 413 路径(答案后立即排空请求流)。
    const big = JSON.stringify({ text: 'x'.repeat(300 * 1024) })
    const res = await callRoute(host.route.handler, { method: 'POST', body: big })
    assert.equal(res.status, 413)
  })
})

test('a text longer than MAX_TEXT_LENGTH answers 400 invalid-text (#111)', async () => {
  await withTempProfile(async () => {
    const host = bootHost()
    // 小 body 内的超长 text:JSON 合法、字节不超限,但 text 字段超上限
    const res = await callRoute(host.route.handler, { method: 'POST', body: JSON.stringify({ text: 'x'.repeat(MAX_TEXT_LENGTH + 10) }) })
    assert.equal(res.status, 400)
    assert.deepEqual(res.json, { error: 'invalid-text' })
  })
})
