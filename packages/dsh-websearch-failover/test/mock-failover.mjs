// Offline proof of the failover rules: quota -> fallback, cooldown -> skip,
// all-dead -> structured error. No network, no real keys.
//   node test/mock-failover.mjs
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadConfig, search, SearchError } from '../lib/core.mjs';

const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  if (req.url === '/quota') {
    res.writeHead(429, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'quota exceeded for this billing period' } }));
    return;
  }
  if (req.url === '/auth') {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'invalid api key' }));
    return;
  }
  if (req.url === '/broken') {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('upstream exploded');
    return;
  }
  if (req.url === '/empty') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [] }));
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      data: [
        { title: 'ok result', url: `https://example.com${req.url}/1`, description: 'snippet text' },
        { title: 'second', url: `https://example.com${req.url}/2`, description: 'another snippet' },
        { title: 'dupe', url: `https://example.com${req.url}/1`, description: 'dup' },
      ],
    }),
  );
});

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsfailover-'));
// #182: node --test runs each file in its own process. The gate now covers
// this file, so without an exit hook it leaks one temp directory per run.
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }))
const configPath = path.join(dir, 'providers.json');
const statePath = path.join(dir, 'state.json');

function provider(id, route, priority) {
  return {
    id,
    kind: 'custom',
    priority,
    apiKey: `test-key-${id}`,
    request: { method: 'POST', url: `${base}${route}`, body: { q: '${query}' } },
    response: { sourcesPath: 'data', map: { title: 'title', url: 'url', snippet: 'description' } },
  };
}

fs.writeFileSync(
  configPath,
  JSON.stringify({
    defaults: { limit: 3, timeoutMs: 4000 },
    providers: [provider('dead-quota', '/quota', 1), provider('dead-auth', '/auth', 2), provider('dead-500', '/broken', 3), provider('alive', '/ok', 4)],
  }),
);
const config = loadConfig(configPath);

// 1) first provider out of quota -> second out of auth -> third 500 -> fourth works
const first = await search({ query: 'hello', config, statePath });
assert.equal(first.provider, 'alive');
assert.equal(first.sources.length, 2);
assert.deepEqual(
  first.attempts.map((a) => `${a.provider}:${a.outcome}:${a.kind ?? ''}`),
  ['dead-quota:failed:quota', 'dead-auth:failed:auth', 'dead-500:failed:error', 'alive:ok:'],
);
console.log('PASS  ordered fallback: quota -> auth -> 5xx -> success');

// 2) cooldowns persisted: the next search skips all three without any request
const before = hits.length;
const second = await search({ query: 'hello again', config, statePath });
assert.equal(second.provider, 'alive');
assert.deepEqual(
  second.attempts.map((a) => a.outcome),
  ['skipped', 'skipped', 'skipped', 'ok'],
);
assert.equal(hits.length, before + 1, 'only the live provider should be called');
console.log('PASS  cooldown skip: dead providers not re-hit');

// 3) --force ignores cooldowns
const forced = await search({ query: 'hello', config, statePath, force: true });
assert.equal(forced.attempts[0].outcome, 'failed');
console.log('PASS  force bypasses cooldown');

// 4) every provider dead -> ALL_FAILED with attempt list
const deadConfig = { ...config, providers: [provider('dead-quota', '/quota', 1), provider('dead-auth', '/auth', 2)] };
await assert.rejects(
  () => search({ query: 'x', config: deadConfig, statePath: path.join(dir, 'state2.json') }),
  (error) => error instanceof SearchError && error.code === 'ALL_FAILED' && error.attempts.length === 2,
);
console.log('PASS  all dead -> ALL_FAILED with attempts');

// 5) empty result from provider 1 falls through to provider 2
fs.writeFileSync(
  path.join(dir, 'empty.json'),
  JSON.stringify({ defaults: { limit: 3 }, providers: [provider('empty', '/empty', 1), provider('alive', '/ok', 2)] }),
);
const emptyConfig = loadConfig(path.join(dir, 'empty.json'));
const third = await search({ query: 'x', config: emptyConfig, statePath: path.join(dir, 'state3.json') });
assert.equal(third.provider, 'alive');
assert.equal(third.attempts[0].outcome, 'empty');
console.log('PASS  empty result -> next provider');

// 6) missing key -> auth cooldown, not a crash
fs.writeFileSync(
  path.join(dir, 'nokey.json'),
  JSON.stringify({
    defaults: { limit: 3 },
    providers: [{ ...provider('nokey', '/ok', 1), apiKey: undefined, apiKeyEnv: 'DEFINITELY_UNSET_KEY_VAR' }, provider('alive', '/ok', 2)],
  }),
);
const nokeyConfig = loadConfig(path.join(dir, 'nokey.json'));
const noKey = await search({ query: 'x', config: nokeyConfig, statePath: path.join(dir, 'state4.json') });
assert.equal(noKey.attempts[0].kind, 'auth');
assert.equal(noKey.provider, 'alive');
console.log('PASS  missing key -> skipped provider, no crash');

server.close();
console.log('\nall failover invariants hold');
