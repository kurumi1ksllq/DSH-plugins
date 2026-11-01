// Read audit log for dsh-credential-vault: one JSON line per reveal, appended
// under the vault directory. Best-effort — a failing append never fails the
// tool call itself.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const AUDIT_FILE = 'audit.log'
export const AUDIT_MAX_LINES = 2000

/** Append one audit record. Fields never include secret material. */
export function appendAudit(dir, record) {
  const line = JSON.stringify({
    at: new Date().toISOString(),
    name: record.name ?? null,
    outcome: record.outcome ?? 'ok',
    source: record.source ?? 'tool',
    ...('reason' in record ? { reason: String(record.reason).slice(0, 200) } : {}),
  }) + '\n'
  try {
    appendFileSync(join(dir, AUDIT_FILE), line, 'utf8')
  } catch {
    /* diagnostics only */
  }
}

/** Read the last `limit` audit records, newest first. */
export function readAudit(dir, limit = 100) {
  const file = join(dir, AUDIT_FILE)
  if (!existsSync(file)) return []
  const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0)
  const capped = typeof limit === 'number' && limit > 0 ? limit : 100
  return lines
    .slice(-capped)
    .reverse()
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return { at: null, name: null, outcome: 'corrupt', source: null }
      }
    })
}

/**
 * Trim the audit file to the most recent AUDIT_MAX_LINES lines. Called after
 * an append; failure is silent.
 */
export function trimAudit(dir) {
  try {
    const file = join(dir, AUDIT_FILE)
    if (!existsSync(file)) return
    const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0)
    if (lines.length <= AUDIT_MAX_LINES) return
    writeAll(file, lines.slice(-AUDIT_MAX_LINES).join('\n') + '\n')
  } catch {
    /* diagnostics only */
  }
}

import { writeFileSync } from 'node:fs'
function writeAll(file, text) {
  writeFileSync(file, text, 'utf8')
}
