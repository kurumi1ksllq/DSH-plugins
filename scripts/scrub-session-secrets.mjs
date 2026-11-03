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
 *   node scripts/scrub-session-secrets.mjs                  # dry run
 *   node scripts/scrub-session-secrets.mjs --apply          # rewrite + backup
 *   node scripts/scrub-session-secrets.mjs --backup-dir D   # where the originals go
 *   node scripts/scrub-session-secrets.mjs --no-backup      # rewrite without keeping copies
 *   node scripts/scrub-session-secrets.mjs --vault DIR --roots A,B
 *
 * Default roots are `$DSH_HOME/sessions` and `$DSH_HOME/storages`. Other leak
 * sites found on real machines (spill files under /tmp, `.git/config` remotes)
 * need explicit `--roots`.
 *
 * Exit codes: 0 = nothing found, 1 = hits found (dry run), 2 = execution error.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { createDecipheriv } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

export const REDACTION = '***REDACTED***'

/**
 * Secrets shorter than this are not searched for: a 2-character password would
 * match everywhere and `--apply` would mangle unrelated files. They are reported
 * separately so the user can handle them by hand.
 */
export const MIN_SECRET_LENGTH = 8

/** A file containing a NUL byte is treated as binary and never rewritten. */
export function looksBinary(text) {
  return text.includes('\u0000')
}

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

/** Where `--apply` copies the original before rewriting. Outside the scan roots. */
export function defaultBackupDir(timestamp) {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'scrub-backups', timestamp)
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

/**
 * A live session keeps appending to its own log; never rewrite those.
 *
 * `session.lock` is NEVER removed when flock is released, so filesystem
 * existence proves nothing — this machine has 100+ of them from finished
 * sessions. Liveness is judged by how recently the lock was touched.
 */
export function hasLiveLock(file, options = {}) {
  const lock = join(resolve(file, '..'), 'session.lock')
  const freshMs = Number.isFinite(options.freshMs) ? options.freshMs : 60_000
  const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now()
  try {
    return nowMs - statSync(lock).mtimeMs < freshMs
  } catch {
    return false
  }
}

/**
 * Copy `file` to `backupDir`, mirroring its path so two roots never collide.
 * The directory is created 0700 and the copies 0600 — and the copies are STILL
 * PLAINTEXT, which is why they default to a folder outside the scanned roots.
 */
function backupFile(file, backupDir) {
  const target = join(backupDir, resolve(file).replace(/^[/\\]+/, '').replace(/[/\\]+/g, '__'))
  mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  copyFileSync(file, target)
  return target
}

/**
 * Scan the given roots.
 * @param {{
 *   roots: string[],
 *   secrets: Array<{name: string, value: string}>,
 *   apply?: boolean,
 *   zstdAvailable?: boolean,
 *   timestamp?: string,
 *   backupDir?: string|null,
 *   minSecretLength?: number,
 *   lockFreshMs?: number,
 *   nowMs?: number,
 *   log?: (line: string) => void,
 * }} options
 * @returns {{scanned: number, hitFiles: Array<{file: string, hits: Array<{name: string, count: number}>}>, skipped: Array<{file: string, reason: string}>, tooShort: Array<{name: string, length: number}>, backups: string[], redactions: number}}
 */
export function scan(options) {
  const { roots, secrets } = options
  const apply = options.apply === true
  const zstdAvailable = options.zstdAvailable !== false && hasZstd()
  const timestamp = options.timestamp ?? new Date().toISOString().replace(/[:.]/g, '-')
  const minSecretLength = Number.isFinite(options.minSecretLength) ? options.minSecretLength : MIN_SECRET_LENGTH
  const backupDir = options.backupDir === null ? null : (options.backupDir ?? defaultBackupDir(timestamp))
  const log = typeof options.log === 'function' ? options.log : () => {}

  const usable = []
  const tooShort = []
  for (const secret of secrets) {
    if (secret.value.length < minSecretLength) tooShort.push({ name: secret.name, length: secret.value.length })
    else usable.push(secret)
  }

  const report = { scanned: 0, hitFiles: [], skipped: [], tooShort, backups: [], redactions: 0 }

  for (const root of roots) {
    for (const file of listFiles(root)) {
      const text = readMaybeCompressed(file, { zstdAvailable })
      if (text === null) {
        report.skipped.push({ file, reason: file.endsWith('.zstd') ? 'compressed log (zstd unavailable or unreadable)' : 'unreadable' })
        continue
      }
      if (looksBinary(text)) {
        report.skipped.push({ file, reason: 'binary file (contains NUL)' })
        continue
      }
      report.scanned += 1
      const { text: scrubbed, hits } = scrubText(text, usable)
      if (hits.length === 0) continue
      report.hitFiles.push({ file, hits })
      report.redactions += hits.reduce((total, hit) => total + hit.count, 0)
      log(`${apply ? 'redacting' : 'hit'}: ${file} (${hits.map((hit) => `${hit.name}×${hit.count}`).join(', ')})`)
      if (!apply) continue
      if (hasLiveLock(file, { freshMs: options.lockFreshMs, nowMs: options.nowMs })) {
        report.skipped.push({ file, reason: 'live session lock' })
        log(`skipped (live session): ${file}`)
        continue
      }
      if (backupDir !== null) report.backups.push(backupFile(file, backupDir))
      const write = typeof options.write === 'function' ? options.write : writeMaybeCompressed
      if (!write(file, scrubbed)) {
        report.skipped.push({ file, reason: 'rewrite failed (backup kept)' })
      }
    }
  }

  return report
}

/** Default scan roots: the places this harness writes, minus the ones that need a decision. */
export function defaultRoots() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return [join(home, 'sessions'), join(home, 'storages')]
}

/** Read the value that follows one `--flag`, or null when it is missing. */
function flagValue(argv, flag) {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) return null
  return value
}

/** CLI entry. Returns the process exit code: 0 clean, 1 hits (dry run), 2 error. */
export function main(argv = process.argv.slice(2), io = { log: console.log, error: console.error }) {
  const apply = argv.includes('--apply')
  const noBackup = argv.includes('--no-backup')
  const vaultArg = flagValue(argv, '--vault')
  const rootsArg = flagValue(argv, '--roots')
  const backupArg = flagValue(argv, '--backup-dir')
  for (const [flag, value] of [['--vault', vaultArg], ['--roots', rootsArg], ['--backup-dir', backupArg]]) {
    if (value === null) {
      io.error(`${flag} needs a value`)
      return 2
    }
  }
  const vaultDir = vaultArg ?? defaultVaultDir()
  const roots = rootsArg === undefined
    ? defaultRoots()
    : rootsArg.split(',').map((entry) => entry.trim()).filter(Boolean)

  if (!existsSync(vaultDir)) {
    io.error(`no vault at ${vaultDir}`)
    return 2
  }

  const secrets = collectSecrets(vaultDir)
  if (secrets.length === 0) {
    io.log('no stored credentials to look for')
    return 0
  }

  const report = scan({
    roots,
    secrets,
    apply,
    log: io.log,
    backupDir: noBackup ? null : (backupArg ?? undefined),
  })
  io.log(
    `${apply ? 'apply' : 'dry run'}: scanned ${report.scanned} files in ${roots.join(', ')}, ` +
      `${report.hitFiles.length} contain a stored value, ${report.redactions} occurrences, ` +
      `${report.skipped.length} skipped`,
  )
  if (report.tooShort.length > 0) {
    io.log(`  not searched (shorter than ${MIN_SECRET_LENGTH} chars, handle by hand): ${report.tooShort.map((item) => item.name).join(', ')}`)
  }
  if (report.backups.length > 0) {
    io.log(`  originals copied to ${report.backups[0].replace(/[/\\][^/\\]+$/, '')} (STILL PLAINTEXT — delete once you have confirmed the result)`)
  }
  for (const item of report.skipped) io.log(`  skipped ${item.file}: ${item.reason}`)
  const failed = report.skipped.filter((item) => /rewrite failed/.test(item.reason))
  if (failed.length > 0) {
    io.error(`${failed.length} file(s) could not be rewritten`)
    return 2
  }
  if (!apply && report.hitFiles.length > 0) {
    io.log('re-run with --apply to redact (originals are copied outside the scanned roots)')
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
