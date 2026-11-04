#!/usr/bin/env node
// vault-sync: export/import the credential vault for cross-device sync (#51).
//
//   vault-sync export --out FILE [--vault DIR]
//   vault-sync import --in FILE [--vault DIR] [--mode skip|overwrite] [--dry-run]
//   vault-sync inspect --in FILE
//
// The passphrase is read from stdin (or --passphrase-fd N) and is never accepted
// from an environment variable: an agent can run this script, and an env-var
// passphrase would hand the whole vault to anything that can read the
// environment. Exit codes: 0 ok, 1 conflicts/stale (needs a human), 2 error.

import { createInterface } from 'node:readline'
import { createReadStream } from 'node:fs'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { createVaultStore } from '../lib/vault-store.js'
import { sealEnvelope, openEnvelope, ENVELOPE_KDF, ENVELOPE_FORMAT, ENVELOPE_VERSION, MIN_PASSPHRASE_LENGTH } from '../lib/envelope.mjs'
import { mergeImports } from '../lib/merge.mjs'

function defaultVaultDir() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'credential-vault')
}

export function parseArgs(argv) {
  const command = argv[0]
  if (!['export', 'import', 'inspect'].includes(command)) {
    return { error: `usage: vault-sync <export|import|inspect> … (got ${JSON.stringify(command ?? '')})` }
  }
  const options = { command }
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]
    const value = argv[index + 1]
    const needsValue = ['--out', '--in', '--vault', '--mode', '--passphrase-fd']
    if (needsValue.includes(flag)) {
      if (value === undefined || value.startsWith('--')) return { error: `${flag} needs a value` }
      options[flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value
      index += 1
    } else if (flag === '--dry-run') {
      options.dryRun = true
    } else {
      return { error: `unknown argument ${flag}` }
    }
  }
  if (options.command !== 'export' && !options.in) return { error: '--in is required' }
  if (options.command === 'export' && !options.out) return { error: '--out is required' }
  if (options.mode && !['skip', 'overwrite'].includes(options.mode)) {
    return { error: `--mode must be skip or overwrite (got ${options.mode})` }
  }
  return options
}

/** Read the passphrase from the given fd (default: stdin). Never echoed. */
export async function readPassphrase({ fdNumber = 0 } = {}) {
  const chunks = []
  for await (const chunk of createInterface({ input: fsRead(fdNumber) })) {
    const line = String(chunk)
    if (line.length > 0) chunks.push(line)
    break // one line only
  }
  const text = chunks.join('').trim()
  if (text.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters (read from fd ${fdNumber})`)
  }
  return text
}

function fsRead(fdNumber) {
  return createReadStream('', { fd: fdNumber, encoding: 'utf8', autoClose: true })
}

/** Load the vault file contents as text. */
function readVaultFile(vaultDir) {
  return readFileSync(join(vaultDir, 'vault.json'), 'utf8')
}

export async function runExport({ vaultDir, out, passphrase, log = () => {}, error = () => {} }) {
  if (!existsSync(vaultDir)) {
    error(`no vault at ${vaultDir}`)
    return 2
  }
  const store = createVaultStore(vaultDir)
  const { entries, corrupt } = store.exportEntries()
  const envelope = sealEnvelope(passphrase, { sourceVaultVersion: 3, entries })
  writeFileSync(out, JSON.stringify(envelope, null, 2) + '\n', { mode: 0o600 })
  log(`exported ${entries.length} entries (${corrupt} corrupt skipped) to ${out}`)
  if (corrupt > 0) log('NOTE: corrupt entries were skipped; inspect the panel for details')
  return 0
}

export async function runImport({ vaultDir, in: inFile, passphrase, mode = 'skip', dryRun = false, log = () => {}, error = () => {} }) {
  // Importing into a FRESH device is the whole point: the target vault may not
  // exist yet. createVaultStore creates the directory and a new master key.
  if (!existsSync(inFile)) {
    error(`no import file at ${inFile}`)
    return 2
  }
  if (!existsSync(inFile)) {
    error(`no import file at ${inFile}`)
    return 2
  }
  const content = readFileSync(inFile, 'utf8')
  const envelope = JSON.parse(content)
  const payload = openEnvelope(passphrase, envelope)

  const store = createVaultStore(vaultDir)
  const localEntries = store.listMeta().map((entry) => ({
    id: entry.id, name: entry.name, updatedAt: entry.updatedAt,
  }))
  const merged = mergeImports({ localEntries, incomingEntries: payload.entries, mode })

  log(`${dryRun ? 'dry run' : 'import'}: ${merged.imported} imported, ${merged.updated} updated, ${merged.skipped} skipped, ${merged.stale} stale, ${merged.conflicts.length} conflicts`)
  for (const conflict of merged.conflicts) {
    log(`  conflict: incoming "${conflict.incomingName}" vs local "${conflict.localName ?? '?'}" (${conflict.reason})`)
  }
  if (dryRun) return merged.conflicts.length > 0 || merged.stale > 0 ? 1 : 0

  if (merged.writes.length > 0) store.applyImport(merged.writes)
  return merged.conflicts.length > 0 || merged.stale > 0 ? 1 : 0
}

export function runInspect({ in: inFile, log = () => {}, error = () => {} }) {
  if (!existsSync(inFile)) {
    error(`no import file at ${inFile}`)
    return 2
  }
  const envelope = JSON.parse(readFileSync(inFile, 'utf8'))
  const shapeOk =
    envelope.format === ENVELOPE_FORMAT &&
    envelope.version === ENVELOPE_VERSION &&
    envelope.kdf && envelope.kdf.name === ENVELOPE_KDF.name &&
    envelope.kdf.N === ENVELOPE_KDF.N && envelope.kdf.r === ENVELOPE_KDF.r && envelope.kdf.p === ENVELOPE_KDF.p
  if (!shapeOk) {
    error('this file is not a dsh-credential-vault export envelope (or its format is unknown)')
    return 2
  }
  log(`envelope ok: version ${envelope.version}, exported at ${envelope.exportedAt}, scrypt N=${envelope.kdf.N}`)
  return 0
}

/** CLI entry. Returns the process exit code. */
export async function main(argv = process.argv.slice(2), io = {}) {
  const { log = console.log, error = console.error, readPassphrase: readPw = readPassphrase } = io
  const parsed = parseArgs(argv)
  if (parsed.error) {
    error(parsed.error)
    return 2
  }
  const vaultDir = parsed.vault ? resolve(parsed.vault) : defaultVaultDir()

  let passphrase = null
  if (parsed.command !== 'inspect') {
    // inspect never decrypts, so it never needs the passphrase.
    if (parsed.passphraseFd !== undefined) {
      passphrase = await readPw({ fdNumber: Number(parsed.passphraseFd) })
    } else {
      passphrase = await readPw({ fdNumber: 0 })
    }
  }

  try {
    if (parsed.command === 'export') return runExport({ vaultDir, out: parsed.out, passphrase, log, error })
    if (parsed.command === 'import') {
      return await runImport({ vaultDir, in: parsed.in, passphrase, mode: parsed.mode, dryRun: parsed.dryRun, log, error })
    }
    return runInspect({ in: parsed.in, log, error })
  } catch (caught) {
    error(caught?.message ?? String(caught))
    return 2
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === `file://${resolve(process.argv[1])}`
if (invokedDirectly) {
  main()
    .then((code) => { process.exitCode = code })
    .catch((caught) => {
      console.error(caught?.message ?? caught)
      process.exitCode = 2
    })
}
