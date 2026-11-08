import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = join(here, '..')
const repoRoot = join(pkgRoot, '..', '..')

/**
 * Host dsh.client contract serves exactly one entry file per bundle (the
 * package's "./client" export). The browser half is therefore kept as a
 * single built artifact (client.js) assembled from ordered source parts in
 * client/. This test fails when the artifact drifts from its parts.
 */
test('client.js is byte-identical to the client/ source parts', () => {
  assert.doesNotThrow(
    () => execFileSync(process.execPath, [join(repoRoot, 'scripts', 'build-inventory-client.mjs'), '--check'], { cwd: repoRoot }),
    'client.js is stale: edit client/ parts and run node scripts/build-inventory-client.mjs',
  )
})

test('client source parts exist and stay ordered', () => {
  const dir = join(pkgRoot, 'client')
  const names = require$read(dir)
  assert.ok(names.length >= 10, 'expected the ordered source parts, got: ' + names.join(','))
  assert.ok(names.includes('10-header.js') && names.includes('99-tail.js'), 'first/last part missing')
})

function require$read(dir) {
  return readdirSync(dir).filter((name) => /^\d{2}-.*\.js$/.test(name)).sort()
}
