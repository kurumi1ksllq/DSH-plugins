// Read audit log for dsh-credential-vault: one JSON line per credential read,
// appended under the vault directory. Best-effort — a failing append never fails
// the tool call itself.
//
// A record answers "who read what, how did they find it, and did they use the
// safe path": `sessionId` attributes the read to one agent session, `resolvedBy`
// names the matching rule that produced the credential, and `action` separates
// the zero-plaintext `use` path from the audited `reveal` escape hatch.
// No record ever contains a value.

import { closeSync, existsSync, fchmodSync, openSync, readFileSync, writeFileSync } from 'node:fs'
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
    ...(typeof record.action === 'string' && record.action.length > 0 ? { action: record.action } : {}),
    ...(typeof record.sessionId === 'string' && record.sessionId.length > 0 ? { sessionId: record.sessionId } : {}),
    ...(typeof record.resolvedBy === 'string' && record.resolvedBy.length > 0
      ? { resolvedBy: record.resolvedBy }
      : {}),
    ...('reason' in record ? { reason: String(record.reason).slice(0, 200) } : {}),
  }) + '\n'
  try {
    // The log names which credentials were read and when: keep it 0600 like the
    // vault itself, even when an older file was created with a wider mode.
    const fd = openSync(join(dir, AUDIT_FILE), 'a', 0o600)
    try {
      try {
        fchmodSync(fd, 0o600)
      } catch {
        /* the append still matters more than the mode */
      }
      writeFileSync(fd, line, 'utf8')
    } finally {
      closeSync(fd)
    }
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

function writeAll(file, text) {
  writeFileSync(file, text, 'utf8')
}
