// Balance probe contract for the websearch-failover DSH bundle.
// Every billing unit (credits / usd / percent / requests / tokens) must map to
// one normalized record so the sidebar can draw a proportional bar.
import assert from 'node:assert/strict'

const { normalizeBalance, probeBalance, BALANCE_UNITS, formatBalance } = await import('../lib/balance.mjs')

let pass = 0
async function ok(name, fn) {
  await fn()
  pass += 1
  console.log(`PASS ${name}`)
}

const NOW = 1_700_000_000_000

await ok('normalizeBalance keeps credits and derives a ratio', () => {
  const balance = normalizeBalance({ remaining: 812.5, total: 1000, unit: 'credits', now: NOW })
  assert.equal(balance.status, 'ok')
  assert.equal(balance.remaining, 812.5)
  assert.equal(balance.total, 1000)
  assert.equal(balance.ratio, 0.8125)
  assert.equal(balance.unit, 'credits')
  assert.equal(balance.fetchedAt, NOW)
})

await ok('normalizeBalance keeps a USD balance with its unit', () => {
  const balance = normalizeBalance({ remaining: 4.2, total: 10, unit: 'usd', now: NOW })
  assert.equal(balance.unit, 'usd')
  assert.equal(balance.ratio, 0.42)
  assert.equal(balance.remaining, 4.2)
})

await ok('normalizeBalance derives a ratio for percent-only providers', () => {
  const balance = normalizeBalance({ remaining: 40, unit: 'percent', now: NOW })
  assert.equal(balance.ratio, 0.4)
  assert.equal(balance.total, null)
})

await ok('normalizeBalance clamps the ratio to 0..1', () => {
  assert.equal(normalizeBalance({ remaining: 1200, total: 1000, unit: 'credits', now: NOW }).ratio, 1)
  assert.equal(normalizeBalance({ remaining: -5, total: 1000, unit: 'credits', now: NOW }).ratio, 0)
})

await ok('normalizeBalance turns numbers-as-strings into numbers', () => {
  const balance = normalizeBalance({ remaining: '25', total: '100', unit: 'credits', now: NOW })
  assert.equal(balance.remaining, 25)
  assert.equal(balance.total, 100)
  assert.equal(balance.ratio, 0.25)
})

await ok('normalizeBalance reports unknown when nothing numeric is known', () => {
  const balance = normalizeBalance({ unit: 'credits', now: NOW })
  assert.equal(balance.status, 'unknown')
  assert.equal(balance.remaining, null)
  assert.equal(balance.ratio, null)
})

await ok('normalizeBalance keeps an unknown unit but never invents a ratio', () => {
  const balance = normalizeBalance({ remaining: 5, total: 10, unit: 'bananas', now: NOW })
  assert.equal(balance.unit, 'unknown')
  assert.equal(balance.status, 'ok')
  assert.equal(balance.ratio, 0.5)
})

await ok('BALANCE_UNITS is a closed set the client can switch on', () => {
  assert.deepEqual([...BALANCE_UNITS].sort(), ['credits', 'percent', 'requests', 'tokens', 'unknown', 'usd'])
})

await ok('formatBalance renders a human amount per unit', () => {
  assert.equal(formatBalance({ remaining: 812.5, unit: 'credits' }), '812.5 credits')
  assert.equal(formatBalance({ remaining: 4.2, unit: 'usd' }), '$4.20')
  assert.equal(formatBalance({ remaining: 40, unit: 'percent' }), '40%')
  assert.equal(formatBalance({ remaining: null, unit: 'credits' }), 'unknown')
})

// ---------------------------------------------------------------- probes

function stubFetch(routes) {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init })
    const key = Object.keys(routes).find((candidate) => String(url).includes(candidate))
    if (!key) throw new Error(`unexpected fetch: ${url}`)
    const route = routes[key]
    if (typeof route === 'function') return route(url, init)
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  return { fetchImpl, calls }
}

await ok('firecrawl balance reads remainingCredits/planCredits', async () => {
  const { fetchImpl, calls } = stubFetch({
    'api.firecrawl.dev': { body: { success: true, data: { remainingCredits: 1234, planCredits: 5000 } } },
  })
  const balance = await probeBalance(
    { id: 'firecrawl', kind: 'firecrawl' },
    { key: 'fc-test', now: NOW, fetchImpl },
  )
  assert.equal(balance.status, 'ok')
  assert.equal(balance.remaining, 1234)
  assert.equal(balance.total, 5000)
  assert.equal(balance.unit, 'credits')
  assert.equal(balance.source, 'api')
  assert.equal(calls.length, 1)
  assert.match(String(calls[0].init?.headers?.authorization ?? calls[0].init?.headers?.Authorization), /Bearer fc-test/)
})

await ok('tavily balance reads plan_limit/plan_usage', async () => {
  const { fetchImpl } = stubFetch({
    'api.tavily.com': { body: { account: { plan_limit: 1000, plan_usage: 250 }, key: { limit: 1000, usage: 250 } } },
  })
  const balance = await probeBalance({ id: 'tavily', kind: 'tavily' }, { key: 'tvly-test', now: NOW, fetchImpl })
  assert.equal(balance.status, 'ok')
  assert.equal(balance.remaining, 750)
  assert.equal(balance.total, 1000)
})

await ok('firecrawl v1 snake_case payload still normalizes', async () => {
  const { fetchImpl } = stubFetch({
    'api.firecrawl.dev': { body: { success: true, data: { remaining_credits: 700, plan_credits: 1000 } } },
  })
  const balance = await probeBalance({ id: 'firecrawl', kind: 'firecrawl' }, { key: 'fc-test', now: NOW, fetchImpl })
  assert.equal(balance.status, 'ok')
  assert.equal(balance.remaining, 700)
  assert.equal(balance.total, 1000)
})

await ok('tavily real-world usage payload (plan_usage 0, plan_limit 1000)', async () => {
  const { fetchImpl } = stubFetch({
    'api.tavily.com': {
      body: {
        key: { usage: 0, limit: null, search_usage: 0 },
        account: { current_plan: 'Researcher', plan_usage: 0, plan_limit: 1000, paygo_usage: 0 },
      },
    },
  })
  const balance = await probeBalance({ id: 'tavily', kind: 'tavily' }, { key: 'tvly-test', now: NOW, fetchImpl })
  assert.equal(balance.status, 'ok')
  assert.equal(balance.remaining, 1000)
  assert.equal(balance.total, 1000)
  assert.equal(balance.ratio, 1)
})

await ok('custom balance spec maps JSON paths and units', async () => {
  const { fetchImpl, calls } = stubFetch({
    'balance.example.test': { body: { data: { left: 42, all: 100 } } },
  })
  const provider = {
    id: 'mine',
    kind: 'custom',
    balance: {
      kind: 'custom',
      request: {
        method: 'GET',
        url: 'https://balance.example.test/v1/quota',
        headers: { 'x-api-key': '${key}' },
      },
      response: { remainingPath: 'data.left', totalPath: 'data.all' },
      unit: 'requests',
    },
  }
  const balance = await probeBalance(provider, { key: 'k-1', now: NOW, fetchImpl })
  assert.equal(balance.status, 'ok')
  assert.equal(balance.remaining, 42)
  assert.equal(balance.total, 100)
  assert.equal(balance.unit, 'requests')
  assert.equal(balance.ratio, 0.42)
  assert.equal(calls[0].init.headers['x-api-key'], 'k-1')
})

await ok('providers without a balance API report unknown, not an error', async () => {
  const { fetchImpl, calls } = stubFetch({})
  const balance = await probeBalance({ id: 'brave', kind: 'brave' }, { key: 'k', now: NOW, fetchImpl })
  assert.equal(balance.status, 'unknown')
  assert.equal(balance.detail, 'no-balance-api')
  assert.equal(calls.length, 0)
})

// ---------------------------------------------------------------- reset policy

await ok('firecrawl reports its billing period end as the reset time', async () => {
  const periodEnd = '2026-11-17T03:43:17.842Z'
  const { fetchImpl } = stubFetch({
    'api.firecrawl.dev': {
      body: { success: true, data: { remainingCredits: 500, planCredits: 1000, billingPeriodEnd: periodEnd } },
    },
  })
  const balance = await probeBalance({ id: 'firecrawl', kind: 'firecrawl' }, { key: 'k', now: NOW, fetchImpl })
  assert.equal(balance.resetKind, 'period-end')
  assert.equal(balance.resetsAt, Date.parse(periodEnd))
})

await ok('tavily declares a first-of-month reset', async () => {
  const { fetchImpl } = stubFetch({ 'api.tavily.com': { body: { account: { plan_usage: 10, plan_limit: 1000 } } } })
  const balance = await probeBalance({ id: 'tavily', kind: 'tavily' }, { key: 'k', now: NOW, fetchImpl })
  assert.equal(balance.resetKind, 'monthly-first')
  assert.equal(new Date(balance.resetsAt).getUTCDate(), 1)
  assert.ok(balance.resetsAt > NOW)
  assert.ok(balance.resetsAt - NOW <= 32 * 24 * 3600 * 1000)
})

await ok('exa has no monthly reset and says so', async () => {
  const { fetchImpl } = stubFetch({})
  const balance = await probeBalance({ id: 'exa', kind: 'exa' }, { key: 'k', now: NOW, fetchImpl })
  assert.equal(balance.resetKind, 'none')
  assert.equal(balance.resetsAt, null)
})

await ok('parallel is a monthly free allowance, not a prepaid reset', async () => {
  const { fetchImpl } = stubFetch({})
  const balance = await probeBalance({ id: 'parallel', kind: 'parallel' }, { key: 'k', now: NOW, fetchImpl })
  assert.equal(balance.resetKind, 'monthly-allowance')
  assert.equal(new Date(balance.resetsAt).getUTCDate(), 1)
})

await ok('normalizeBalance carries an explicit reset through', () => {
  const balance = normalizeBalance({
    remaining: 5,
    total: 10,
    unit: 'credits',
    now: NOW,
    resetsAt: 1234567,
    resetKind: 'period-end',
  })
  assert.equal(balance.resetsAt, 1234567)
  assert.equal(balance.resetKind, 'period-end')
})

await ok('normalizeBalance defaults to no reset and rejects unknown kinds', () => {
  assert.equal(normalizeBalance({ remaining: 1, unit: 'credits', now: NOW }).resetKind, 'none')
  assert.equal(normalizeBalance({ remaining: 1, unit: 'credits', now: NOW }).resetsAt, null)
  assert.equal(normalizeBalance({ remaining: 1, unit: 'credits', now: NOW, resetKind: 'weekly' }).resetKind, 'none')
})

await ok('a custom spec can point its reset at a JSON path', async () => {
  const { fetchImpl } = stubFetch({
    'balance.example.test': {
      body: { data: { left: 1, all: 2 }, cycle: { ends: '2026-11-01T00:00:00.000Z' } },
    },
  })
  const provider = {
    id: 'mine',
    kind: 'custom',
    balance: {
      kind: 'custom',
      request: { method: 'GET', url: 'https://balance.example.test/v1/quota', headers: { 'x-api-key': '${key}' } },
      response: { remainingPath: 'data.left', totalPath: 'data.all' },
      reset: { kind: 'period-end', path: 'cycle.ends' },
      unit: 'requests',
    },
  }
  const balance = await probeBalance(provider, { key: 'k', now: NOW, fetchImpl })
  assert.equal(balance.resetKind, 'period-end')
  assert.equal(balance.resetsAt, Date.parse('2026-11-01T00:00:00.000Z'))
})


await ok('an HTTP failure becomes status error with a short detail', async () => {
  const { fetchImpl } = stubFetch({
    'api.firecrawl.dev': { status: 401, body: { error: 'invalid key' } },
  })
  const balance = await probeBalance({ id: 'firecrawl', kind: 'firecrawl' }, { key: 'bad', now: NOW, fetchImpl })
  assert.equal(balance.status, 'error')
  assert.match(balance.detail, /401/)
})

await ok('a transport failure never throws out of probeBalance', async () => {
  const fetchImpl = async () => {
    throw new Error('getaddrinfo ENOTFOUND')
  }
  const balance = await probeBalance({ id: 'firecrawl', kind: 'firecrawl' }, { key: 'k', now: NOW, fetchImpl })
  assert.equal(balance.status, 'error')
  assert.match(balance.detail, /ENOTFOUND/)
})

await ok('a missing key short-circuits before any request', async () => {
  const { fetchImpl, calls } = stubFetch({})
  const balance = await probeBalance({ id: 'firecrawl', kind: 'firecrawl' }, { key: '', now: NOW, fetchImpl })
  assert.equal(balance.status, 'unknown')
  assert.equal(balance.detail, 'key-missing')
  assert.equal(calls.length, 0)
})

console.log(`\n${pass} PASS — balance contract holds`)
