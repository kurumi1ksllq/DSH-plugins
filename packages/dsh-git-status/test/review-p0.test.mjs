/**
 * P0 regressions found by independent review of PR #23.
 *
 * These are end-to-end: real repositories on disk, the real routes driven
 * through `apply()` with a fake `webServer`.
 *
 *   P0-1  an untracked DIRECTORY was listed as `sub/`, so opening it showed an
 *         empty diff — issue #18 defeated by its own data source.
 *   P0-2  `/git-status/diff` served the full contents of a clean, committed file
 *         (`other/secret.txt`) to any same-origin request, answered 200 for a
 *         path that does not exist, and followed a symlink out of the repo.
 */

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

import { apply, SNAPSHOT_ROUTE, DIFF_ROUTE } from '../index.js'
import { statusOf } from '../lib/git-info.js'
import { getDiff, getDiffResult, invalidateSnapshot, statusShaOf } from '../lib/snapshot.js'

const GIT = process.env.GIT_IN_PATH ?? 'git'

export function git(dir, ...args) {
  return execFileSync(GIT, args, { cwd: dir, encoding: 'utf8' })
}

/** A committed repo with a secret file, ready for an untracked directory. */
export function initRepo(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 'test@example.com')
  git(dir, 'config', 'user.name', 'Test')
  mkdirSync(join(dir, 'other'))
  writeFileSync(join(dir, 'a.txt'), 'one\n')
  writeFileSync(join(dir, 'other/secret.txt'), 'TOP SECRET VALUE\n')
  git(dir, 'add', '.')
  git(dir, 'commit', '-m', 'init commit')
  return dir
}

/** Register the plugin's routes against a fake web server; path → handler. */
export function routesOf() {
  const routes = new Map()
  apply({
    logger: { info: () => {}, warn: () => {} },
    effect: (fn) => fn(),
    webServer: { register: (opts) => routes.set(opts.path, opts.handler) },
    get: () => undefined,
  })
  return routes
}

/** Invoke one route handler with a plain Node-shaped request. */
export function callRoute(handler, { method = 'GET', url = '/', headers = {} } = {}) {
  return new Promise((resolve) => {
    const chunks = []
    const res = {
      statusCode: 0,
      headers: null,
      writeHead(code, hdrs) {
        this.statusCode = code
        this.headers = hdrs
      },
      end(body) {
        chunks.push(body ?? '')
        const text = chunks.join('')
        let json = null
        try { json = JSON.parse(text) } catch { /* not json */ }
        resolve({ status: this.statusCode, headers: this.headers, json, body: text })
      },
    }
    handler({ method, url, headers }, res)
  })
}

// ---- P0-1: untracked directories are expanded ------------------------------

test('P0-1 statusOf expands an untracked directory into its files', async () => {
  const dir = initRepo('gs-p01-')
  mkdirSync(join(dir, 'sub', 'deeper'), { recursive: true })
  writeFileSync(join(dir, 'sub/a.txt'), 'untracked a\n')
  writeFileSync(join(dir, 'sub/deeper/b.txt'), 'untracked b\n')

  const status = await statusOf(dir)
  const paths = status.changes.map((c) => c.path).sort()
  assert.deepEqual(paths, ['sub/a.txt', 'sub/deeper/b.txt'], 'files, never the directory itself')
  assert.equal(status.untracked, 2, 'counts follow the expanded list')
  assert.equal(status.changes.some((c) => c.path.endsWith('/')), false, 'no directory entry anywhere')
})

test('P0-1 the diff of an expanded untracked file is not empty', async () => {
  const dir = initRepo('gs-p01b-')
  mkdirSync(join(dir, 'sub'))
  writeFileSync(join(dir, 'sub/a.txt'), 'untracked a\n')
  const result = await getDiffResult({ sessionCwd: dir, env: {} }, 'sub/a.txt')
  assert.equal(result.status, 'ok')
  assert.match(result.payload.diff, /untracked a/)
  // The collapsed form the panel used to show is not a readable path any more.
  assert.equal(await getDiff({ sessionCwd: dir, env: {} }, 'sub/'), null)
})

// ---- P0-2: the diff route only reads what git status reports ---------------

test('P0-2 a clean committed file is NOT readable through getDiff', async () => {
  const dir = initRepo('gs-p02a-')
  assert.equal(await getDiff({ sessionCwd: dir, env: {} }, 'other/secret.txt'), null)
  const raw = await getDiffResult({ sessionCwd: dir, env: {} }, 'other/secret.txt')
  assert.equal(raw.status, 'not-changed')
  assert.equal(raw.payload, null)
})

test('P0-2 a nonexistent path has no diff and is never a 200 with content', async () => {
  const dir = initRepo('gs-p02b-')
  const missing = await getDiffResult({ sessionCwd: dir, env: {} }, 'does-not-exist.txt')
  assert.equal(missing.status, 'not-changed')

  const handler = routesOf().get(DIFF_ROUTE)
  assert.ok(handler, 'diff route registered')
  const answer = await callRoute(handler, { url: `${DIFF_ROUTE}?path=does-not-exist.txt` })
  assert.equal(answer.status, 404)
  assert.equal(answer.json.error, 'no-diff')
})

test('P0-2 a symlink cannot walk out of the worktree', async () => {
  const dir = initRepo('gs-p02c-')
  const outside = mkdtempSync(join(tmpdir(), 'gs-outside-'))
  writeFileSync(join(outside, 'leak.txt'), 'OUTSIDE DATA\n')
  symlinkSync(outside, join(dir, 'escape'))
  symlinkSync(join(outside, 'leak.txt'), join(dir, 'escape-file.txt'))

  assert.equal(await getDiff({ sessionCwd: dir, env: {} }, 'escape/leak.txt'), null, 'symlinked directory')
  assert.equal(await getDiff({ sessionCwd: dir, env: {} }, 'escape-file.txt'), null, 'symlinked file')
})

test('P0-2 an untracked file IS readable, and only while it is untracked', async () => {
  const dir = initRepo('gs-p02d-')
  writeFileSync(join(dir, 'new.txt'), 'fresh line\n')
  const before = await getDiffResult({ sessionCwd: dir, env: {} }, 'new.txt')
  assert.equal(before.status, 'ok')
  assert.match(before.payload.diff, /fresh line/)

  // Once committed it is no longer a change; the same path must go dark.
  git(dir, 'add', 'new.txt')
  git(dir, 'commit', '-m', 'add new.txt')
  assert.equal(await getDiff({ sessionCwd: dir, env: {} }, 'new.txt'), null)
})

test('P0-2 a stale status hash is refused', async () => {
  const dir = initRepo('gs-p02e-')
  const sha = statusShaOf((await statusOf(dir)).changes)
  writeFileSync(join(dir, 'a.txt'), 'changed\n')
  // The hash travels in the same options object the workspace does.
  const stale = await getDiffResult({ sessionCwd: dir, env: {}, statusSha: sha }, 'a.txt')
  assert.equal(stale.status, 'not-changed', 'the panel rendered an older list')
  const fresh = await getDiffResult(
    { sessionCwd: dir, env: {}, statusSha: statusShaOf((await statusOf(dir)).changes) },
    'a.txt',
  )
  assert.equal(fresh.status, 'ok')
})

// ---- route contract: 405 / 403 / 400 / 404 --------------------------------

test('both routes answer 405, 403, 400 and 404 before any file is read', async () => {
  const routes = routesOf()
  const diff = routes.get(DIFF_ROUTE)
  const snapshot = routes.get(SNAPSHOT_ROUTE)
  assert.ok(diff && snapshot, 'both routes registered')

  assert.equal((await callRoute(diff, { method: 'POST', url: `${DIFF_ROUTE}?path=a.txt` })).status, 405)
  assert.equal((await callRoute(snapshot, { method: 'DELETE', url: SNAPSHOT_ROUTE })).status, 405)

  const crossSite = { 'sec-fetch-site': 'cross-site' }
  assert.equal((await callRoute(diff, { url: `${DIFF_ROUTE}?path=a.txt`, headers: crossSite })).status, 403)
  assert.equal((await callRoute(snapshot, { url: SNAPSHOT_ROUTE, headers: crossSite })).status, 403)
  const crossOrigin = { origin: 'https://evil.example', host: '127.0.0.1:10100' }
  assert.equal((await callRoute(diff, { url: `${DIFF_ROUTE}?path=a.txt`, headers: crossOrigin })).status, 403)

  const missing = await callRoute(diff, { url: DIFF_ROUTE, headers: {} })
  assert.equal(missing.status, 400)
  assert.equal(missing.json.error, 'missing-path')
})
