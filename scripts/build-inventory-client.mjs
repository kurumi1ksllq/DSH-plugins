#!/usr/bin/env node
/**
 * Build packages/dsh-inventory/client.js from client/ source parts.
 *
 * The host dsh.client contract serves exactly one entry file per bundle
 * (packages' "./client" export), so the artifact stays a single file. This
 * script concatenates the ordered parts in packages/dsh-inventory/client/
 * and verifies the result matches the committed artifact (add --check to
 * fail instead of rewrite, used by tests to prevent drift).
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, '..', 'packages', 'dsh-inventory')
const partsDir = join(pkgDir, 'client')
const outFile = join(pkgDir, 'client.js')

const banner = readFileSync(join(partsDir, '.banner.js'), 'utf8')
const parts = readdirSync(partsDir)
  .filter((name) => /^\d{2,}-.*\.js$/.test(name))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || (a < b ? -1 : 1))
const body = parts.map((name) => {
  const text = readFileSync(join(partsDir, name), 'utf8')
  if (text !== '' && !text.endsWith('\n')) {
    console.error(name + ': part does not end with a newline — concatenation would fuse its last line into the next part')
    process.exit(1)
  }
  return text
})
// Generated-file marker so nobody edits the artifact by hand (P2: artifact self-identification).
const marker = '/** GENERATED FILE — built from client/ parts by scripts/build-inventory-client.mjs; edit the parts, not this file. */\n'
const built = marker + banner + body.join('')

const check = process.argv.includes('--check')
if (check) {
  const current = readFileSync(outFile, 'utf8')
  if (current !== built) {
    console.error('client.js is stale: rebuild with node scripts/build-inventory-client.mjs')
    process.exit(1)
  }
  console.log('client.js is up to date with', parts.length, 'parts')
} else {
  writeFileSync(outFile, built)
  console.log('built client.js from', parts.length, 'parts,', Buffer.byteLength(built), 'bytes')
}
