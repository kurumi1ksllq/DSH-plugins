#!/usr/bin/env node
// Probe candidate balance endpoints for each configured provider using the real
// keys in ~/.dsh/websearch-failover/providers.json. Prints HTTP status and the
// first bytes of each response so the shipped balance specs can be verified
// against live APIs. Never prints a key.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const configPath =
  process.env.WEBSEARCH_FAILOVER_CONFIG ?? path.join(process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'), 'websearch-failover', 'providers.json')

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
const providers = Array.isArray(config.providers) ? config.providers : []

function keyOf(provider) {
  if (typeof provider.apiKey === 'string' && provider.apiKey.length > 0) return provider.apiKey
  for (const name of [provider.apiKeyEnv, ...(provider.apiKeyEnvFallbacks ?? [])].filter(Boolean)) {
    if (process.env[name]) return process.env[name]
  }
  if (provider.keyFile) {
    try {
      return fs.readFileSync(provider.keyFile, 'utf8').trim().split(/\r?\n/)[0]
    } catch {
      return ''
    }
  }
  return ''
}

const CANDIDATES = {
  firecrawl: [
    { url: 'https://api.firecrawl.dev/v1/team/credit-usage', headers: (key) => ({ authorization: `Bearer ${key}` }) },
    { url: 'https://api.firecrawl.dev/v2/team/credit-usage', headers: (key) => ({ authorization: `Bearer ${key}` }) },
  ],
  tavily: [
    { url: 'https://api.tavily.com/usage', headers: (key) => ({ authorization: `Bearer ${key}` }) },
    { url: 'https://api.tavily.com/usage', headers: (key) => ({ 'x-api-key': key }) },
  ],
  exa: [
    { url: 'https://api.exa.ai/usage', headers: (key) => ({ 'x-api-key': key }) },
    { url: 'https://api.exa.ai/v1/usage', headers: (key) => ({ 'x-api-key': key }) },
    { url: 'https://api.exa.ai/team/usage', headers: (key) => ({ 'x-api-key': key }) },
  ],
  parallel: [
    { url: 'https://api.parallel.ai/v1/usage', headers: (key) => ({ 'x-api-key': key }) },
    { url: 'https://api.parallel.ai/v1/account', headers: (key) => ({ 'x-api-key': key }) },
  ],
  serper: [
    { url: 'https://google.serper.dev/credits', headers: (key) => ({ 'X-API-KEY': key }) },
    { url: 'https://google.serper.dev/account', headers: (key) => ({ 'X-API-KEY': key }) },
  ],
  brave: [{ url: 'https://api.search.brave.com/res/v1/web/search?q=test&count=1', headers: (key) => ({ 'X-Subscription-Token': key, accept: 'application/json' }) }],
  bocha: [{ url: 'https://api.bochaai.com/v1/web-search', body: { query: 'test', count: 1 }, headers: (key) => ({ authorization: `Bearer ${key}` }) }],
  jina: [{ url: 'https://api.jina.ai/v1/usage', headers: (key) => ({ authorization: `Bearer ${key}` }) }],
}

for (const provider of providers) {
  const key = provider.apiKey || keyOf(provider)
  const candidates = CANDIDATES[provider.kind] ?? []
  console.log(`\n=== ${provider.id} (${provider.kind}) key=${key ? 'present' : 'MISSING'} ===`)
  if (!key) continue
  if (candidates.length === 0) {
    console.log('  no candidate endpoint known')
    continue
  }
  for (const candidate of candidates) {
    const headers = { accept: 'application/json', ...candidate.headers(key) }
    const init = { method: candidate.body ? 'POST' : 'GET', headers, signal: AbortSignal.timeout(12000) }
    if (candidate.body) {
      headers['content-type'] = 'application/json'
      init.body = JSON.stringify(candidate.body)
    }
    try {
      const response = await fetch(candidate.url, init)
      const text = await response.text()
      console.log(`  ${init.method} ${candidate.url} -> ${response.status}`)
      console.log(`    ${text.replace(/\s+/g, ' ').slice(0, 500)}`)
    } catch (error) {
      console.log(`  ${init.method} ${candidate.url} -> ERROR ${error?.message ?? error}`)
    }
  }
}
