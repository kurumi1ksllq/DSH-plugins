#!/usr/bin/env node
// Verify the bundle that is actually installed in a profile, without touching
// the running DSH process: boot its host half against a stub Cordis context,
// hit the panel API in-process, and print each provider's balance + reset rule.
//
// Runtime state is redirected to a temp directory so the live profile's
// runtime.json / cooldown state are never modified.
//
// Usage:
//   node tools/verify-installed.mjs                 # default profile
//   node tools/verify-installed.mjs --profile DIR   # another profile
//   node tools/verify-installed.mjs --offline       # skip live API calls
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const args = process.argv.slice(2)
const profileArg = args.indexOf('--profile')
const offline = args.includes('--offline')
const profileDir =
  profileArg >= 0
    ? path.resolve(args[profileArg + 1])
    : process.env.DSH_PROFILE_DIR ||
      path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'profiles', 'desktop')

const bundleDir = path.join(profileDir, 'node_modules', 'dsh-websearch-failover')
const entry = path.join(bundleDir, 'index.js')
if (!fs.existsSync(entry)) {
  console.error(`not installed: ${entry}`)
  process.exit(2)
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsf-verify-'))
const runtimePath = path.join(temp, 'runtime.json')
const statePath = path.join(temp, 'state.json')
const logPath = path.join(temp, 'plugin.log')

const routes = []
const providers = []
const ctx = {
  web: {
    registerSearchProvider(provider) {
      providers.push(provider)
      return () => {}
    },
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
  effect: (fn) => fn(),
  on() {},
  emit() {},
  logger: { info() {}, warn() {}, error() {} },
}

const pluginUrl = `${pathToFileURL(entry).href}?verify=${Date.now()}`
const plugin = await import(pluginUrl)
await plugin.apply(ctx, { runtimePath, statePath, logPath })

if (providers.length !== 1) throw new Error(`expected 1 search provider, got ${providers.length}`)
if (routes.length < 1) throw new Error('no HTTP route registered')

function call({ method = 'GET', url = `${plugin.API_BASE}/state`, body } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    method,
    url,
    headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk
    },
  }
  const res = {
    statusCode: 0,
    headers: {},
    chunks: [],
    writeHead(code, headers) {
      this.statusCode = code
      Object.assign(this.headers, headers ?? {})
      return this
    },
    end(chunk) {
      if (chunk !== undefined) this.chunks.push(Buffer.from(String(chunk)))
      return this
    },
    get body() {
      return Buffer.concat(this.chunks).toString('utf8')
    },
  }
  return routes[0].handler(req, res).then(() => ({ status: res.statusCode, json: JSON.parse(res.body || 'null') }))
}

const STATE_LABEL = {
  'period-end': 'ends at the reported billing period end',
  'monthly-first': 'resets on the 1st of each month',
  'monthly-allowance': 'monthly free allowance renews (paid credits do not)',
  none: 'does not reset monthly',
}

const state = await (await call()).json
console.log(`bundle     : ${bundleDir}`)
console.log(`provider id: ${providers[0].id}  available=${providers[0].available()}`)
console.log(`api route  : ${routes[0].kind} ${routes[0].path}`)
console.log(`providers  : ${state.providers.map((p) => p.id).join(' > ')}`)

if (!offline) {
  const refreshed = await (await call({ method: 'POST', url: `${plugin.API_BASE}/refresh`, body: {} })).json
  let missingReset = 0
  for (const provider of refreshed.providers) {
    const balance = provider.balance
    if (!balance) {
      console.log(`  - ${provider.id}: no balance probe`)
      continue
    }
    if (typeof balance.resetKind !== 'string') missingReset += 1
    const when = balance.resetsAt === null ? '(no timestamp)' : new Date(balance.resetsAt).toISOString()
    console.log(
      `  - ${provider.id}: status=${balance.status} ` +
        `${balance.remaining ?? '-'}/${balance.total ?? '-'} ${balance.unit} · ` +
        `reset=${balance.resetKind ?? 'MISSING'} ${when} — ${STATE_LABEL[balance.resetKind] ?? 'unknown rule'}` +
        `${balance.detail ? ` · ${balance.detail}` : ''}`,
    )
  }
  if (missingReset > 0) {
    fs.rmSync(temp, { recursive: true, force: true })
    console.error(`\nFAIL: ${missingReset} provider balance(s) carry no resetKind — installed bundle is stale`)
    process.exit(1)
  }
}

fs.rmSync(temp, { recursive: true, force: true })
console.log('\ninstalled bundle verified')
