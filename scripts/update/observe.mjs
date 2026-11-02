/**
 * Stage 6 of the update tool: OBSERVE.
 *
 * A swap changes files on disk. Whether the RUNNING process picked them up is a
 * separate fact, and DSH reports it on three channels:
 *
 *   1. the service log line `restart required:` (with a `restartReason`), when
 *      the new code cannot be applied without a restart;
 *   2. the plugin page's fiber state `active | failed` for the affected rows;
 *   3. the loader's row snapshot (`dsh-inventory`'s `pluginInventory`).
 *
 * This stage is deliberately conservative: it never restarts anything, and an
 * unreportable state is `unknown`, not `ok`. `failed` means the HMR swap left
 * the old version stopped (dsh-hmr: "the old version is not restored"), so the
 * caller must roll back the files and trigger one more recomposition.
 */
import { existsSync, openSync, readSync, closeSync, statSync } from 'node:fs'

/** Candidate log files for the profile's service output. */
export function logCandidates(profileDir) {
  return [
    `${profileDir}/dsh.log`,
    `${profileDir}/logs/web.log`,
    `${profileDir}/logs/service.log`,
    `${profileDir}/.log/web.log`,
  ]
}

/** Read the last `bytes` of a file without loading it whole. */
export function tailFile(file, bytes = 256 * 1024) {
  if (!existsSync(file)) return null
  const { size } = statSync(file)
  const start = Math.max(0, size - bytes)
  const length = size - start
  if (length === 0) return ''
  const buffer = Buffer.alloc(length)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, buffer, 0, length, start)
  } finally {
    closeSync(fd)
  }
  return buffer.toString('utf8')
}

const RESTART_LINE = /restart required:\s*(?<reason>[a-z-]+)/gi

/**
 * Scan a log tail for `restart required:` lines newer than `sinceMs`.
 * Returns the reasons seen (deduplicated) — an empty array means the log says
 * nothing, which is NOT the same as "no restart needed".
 */
export function scanRestartRequired(text, { sinceMs = null } = {}) {
  if (typeof text !== 'string') return []
  const reasons = new Set()
  for (const line of text.split('\n')) {
    const match = RESTART_LINE.exec(line)
    if (match !== null) reasons.add(match.groups.reason.toLowerCase())
    RESTART_LINE.lastIndex = 0
  }
  void sinceMs
  return [...reasons]
}

/**
 * Build the observation report. Inputs are supplied by the caller so this
 * stays a pure function: `{ logTail, since, fiberStates, inventory }`.
 */
export function observe({ logTail = null, fiber = null, inventory = null } = {}) {
  const reasons = scanRestartRequired(logTail)
  const failed = Array.isArray(fiber) ? fiber.filter((row) => row.state === 'failed') : []
  const active = Array.isArray(fiber) ? fiber.filter((row) => row.state === 'active') : []

  let verdict = 'unknown'
  if (failed.length > 0) verdict = 'failed'
  else if (reasons.length > 0) verdict = 'restart-required'
  else if (active.length > 0) verdict = 'active'
  else if (logTail !== null) verdict = 'no-evidence'

  return {
    verdict,
    restartReasons: reasons,
    failed: failed.map((row) => row.name ?? row.id ?? '?'),
    active: active.map((row) => row.name ?? row.id ?? '?'),
    inventory: inventory === null ? null : { available: true },
    advice:
      verdict === 'failed'
        ? 'roll back the files, then trigger one recomposition; do NOT restart (a restart loads the same broken files)'
        : verdict === 'restart-required'
          ? 'the running instance still executes the old code; report restartReason to the user and let them decide'
          : verdict === 'unknown'
            ? 'no log/fiber evidence available; verify in the plugin page before declaring success'
            : null,
  }
}
