#!/usr/bin/env node
/**
 * Find and scrub credential plaintext that already escaped into local files.
 *
 * Why this exists: before issue #36 every `credential reveal` wrote its value
 * into the session log, the model copied it into shell commands (which are
 * logged too, along with job labels), and it often ended up in a `.git/config`
 * remote URL. Encryption at rest cannot undo that — the bytes are on disk in
 * the clear, and this repository owns the only tool that knows which values to
 * look for.
 *
 * Behaviour:
 *   - DRY RUN by default: reports which files contain a current vault value and
 *     how many occurrences, never printing a value.
 *   - `--apply` rewrites each hit in place, after copying it to
 *     `<file>.bak-<timestamp>`.
 *   - Refuses to rewrite inside a session directory that still holds a live
 *     `session.lock`, because a running DSH would keep appending to a file this
 *     tool just replaced.
 *   - Compressed session logs (`.zstd`) are handled through the `zstd` binary;
 *     when it is missing those files are reported as skipped rather than
 *     silently ignored.
 *
 * Usage:
 *   node scripts/scrub-session-secrets.mjs                 # dry run
 *   node scripts/scrub-session-secrets.mjs --apply         # rewrite + backup
 *   node scripts/scrub-session-secrets.mjs --vault DIR --roots A,B
 *
 * Exit codes: 0 = nothing found, 1 = hits found (dry run), 2 = execution error.
 */

import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createDecipheriv } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const REDACTION = '***REDACTED***'

/** Default vault directory, matching the plugin's own resolution order. */
export function defaultVaultDir() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'credential-vault')
}

/**
 * Decrypt every stored secret so the scanner knows what to look for.
 * Values never leave this process and are never printed by the CLI.
 * @param {string} vaultDir
 * @returns {Array<{name: string, value: string}>}
 */
export function collectSecrets(vaultDir) {
  const keyPath = join(vaultDir, 'master.key')
  const vaultPath = join(vaultDir, 'vault.json')
  if (!existsSync(keyPath) || !existsSync(vaultPath)) return []
  const key = readFileSync(keyPath)
  const vault = JSON.parse(readFileSync(vaultPath, 'utf8'))
  const secrets = []
  for (const [name, entry] of Object.entries(vault.entries ?? {})) {
    if (typeof entry?.secret !== 'string' || entry.secret.length === 0) continue
    const raw = Buffer.from(entry.secret, 'base64')
    if (raw.length < 28) continue
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12))
      decipher.setAuthTag(raw.subarray(raw.length - 16))
      const value = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString('utf8')
      if (value.length > 0) secrets.push({ name, value })
    } catch {
      // A rotated key or a damaged entry: skip it rather than fail the scan.
    }
  }
  return secrets
}

/**
 * Replace every occurrence of every secret in `text`.
 * @param {string} text
 * @param {Array<{name: string, value: string}>} secrets
 * @returns {{text: string, hits: Array<{name: string, count: number}>}}
 */
export function scrubText(text, secrets) {
  let result = text
  const hits = []
  for (const secret of secrets) {
    if (secret.value.length === 0) continue
    const parts = result.split(secret.value)
    const count = parts.length - 1
    if (count > 0) {
      result = parts.join(REDACTION)
      hits.push({ name: secret.name, count })
    }
  }
  return { text: result, hits }
}

/** Every file under `root`, depth-first. Symlinked directories are not followed. */
export function listFiles(root) {
  const files = []
  const walk = (dir) => {
    let names
    try {
      names = readdirSync(dir)
    } catch {
      return
    }
    for (const name of names) {
      const path = join(dir, name)
      let stats
      try {
        stats = statSync(path)
      } catch {
        continue
      }
      if (stats.isDirectory()) walk(path)
      else if (stats.isFile()) files.push(path)
    }
  }
  walk(root)
  return files
}

function hasZstd() {
  const probe = spawnSync('zstd', ['--version'], { encoding: 'utf8' })
  return probe.status === 0
}

/** Read a file as UTF-8, transparently decompressing a `.jsonl.zstd` log. */
export function readMaybeCompressed(file, options = {}) {
  if (!file.endsWith('.zstd')) return readFileSync(file, 'utf8')
  if (options.zstdAvailable === false) return null
  const result = spawnSync('zstd', ['-dc', file], { maxBuffer: 1 << 30 })
  if (result.status !== 0) return null
  return result.stdout.toString('utf8')
}

/** Write UTF-8 back, recompressing when the source was compressed. */
export function writeMaybeCompressed(file, text) {
  if (!file.endsWith('.zstd')) {
    writeFileSync(file, text, 'utf8')
    return true
  }
  const result = spawnSync('zstd', ['-q', '-f', '-o', file, '-'], { input: text, maxBuffer: 1 << 30 })
  return result.status === 0
}

/** A live session keeps appending to its own log; never rewrite those. */
export function hasLiveLock(file) {
  const lock = join(resolve(file, '..'), 'session.lock')
  return existsSync(lock)
}

/**
 * Scan the given roots.
 * @param {{roots: string[], secrets: Array<{name: string, value: string}>, apply?: boolean, zstdAvailable?: boolean, timestamp?: string, log?: (line: string) => void}} options
 * @returns {{scanned: number, hitFiles: Array<{file: string, hits: Array<{name: string, count: number}>}>, skipped: Array<{file: string, reason: string}>, redactions: number}}
 */
export function scan(options) {
  const { roots, secrets } = options
  const apply = options.apply === true
  const zstdAvailable = options.zstdAvailable !== false && hasZstd()
  const timestamp = options.timestamp ?? new Date().toISOString().replace(/[:.]/g, '-')
  const log = typeof options.log === 'function' ? options.log : () => {}

  const report = { scanned: 0, hitFiles: [], skipped: [], redactions: 0 }

  for (const root of roots) {
    for (const file of listFiles(root)) {
      const text = readMaybeCompressed(file, { zstdAvailable })
      if (text === null) {
        report.skipped.push({ file, reason: file.endsWith('.zstd') ? 'compressed log (zstd unavailable or unreadable)' : 'unreadable' })
        continue
      }
      report.scanned += 1
      const { text: scrubbed, hits } = scrubText(text, secrets)
      if (hits.length === 0) continue
      report.hitFiles.push({ file, hits })
      report.redactions += hits.reduce((total, hit) => total + hit.count, 0)
      log(`${apply ? 'redacting' : 'hit'}: ${file} (${hits.map((hit) => `${hit.name}×${hit.count}`).join(', ')})`)
      if (!apply) continue
      if (hasLiveLock(file)) {
        report.skipped.push({ file, reason: 'live session lock' })
        log(`skipped (live session): ${file}`)
        continue
      }
      copyFileSync(file, `${file}.bak-${timestamp}`)
      if (!writeMaybeCompressed(file, scrubbed)) {
        report.skipped.push({ file, reason: 'rewrite failed (backup kept)' })
      }
    }
  }

  return report
}

/** CLI entry. Returns the process exit code. */
export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const apply = argv.includes('--apply')
  const vaultFlag = argv.indexOf('--vault')
  const rootsFlag = argv.indexOf('--roots')
  const vaultDir = vaultFlag >= 0 ? argv[vaultFlag + 1] : defaultVaultDir()
  const roots = rootsFlag >= 0
    ? argv[rootsFlag + 1].split(',').map((entry) => entry.trim()).filter(Boolean)
    : [join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'sessions')]

  if (!existsSync(vaultDir)) {
    io.error(`no vault at ${vaultDir}`)
    return 2
  }

  const secrets = collectSecrets(vaultDir)
  if (secrets.length === 0) {
    io.log('no stored credentials to look for')
    return 0
  }

  const report = scan({ roots, secrets, apply, log: io.log })
  io.log(
    `${apply ? 'apply' : 'dry run'}: scanned ${report.scanned} files, ` +
      `${report.hitFiles.length} contain a stored value, ${report.redactions} occurrences, ` +
      `${report.skipped.length} skipped`,
  )
  if (report.skipped.length > 0) {
    for (const item of report.skipped) io.log(`  skipped ${item.file}: ${item.reason}`)
  }
  if (!apply && report.hitFiles.length > 0) {
    io.log('re-run with --apply to redact (a .bak copy is written for every file)')
    return 1
  }
  return 0
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (invokedDirectly) {
  try {
    process.exitCode = main()
  } catch (error) {
    console.error(error?.message ?? error)
    process.exitCode = 2
  }
}
