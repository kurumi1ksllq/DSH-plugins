/**
 * Thin, safe wrapper around spawning `git` and `gh` CLI processes.
 *
 * Every command is read-only by construction: callers pass argument arrays
 * (no shell interpolation), spawn uses `shell: false`, and every call has a
 * timeout so a hung process can never hold the web route.
 */

import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 10_000
/**
 * Hard cap on captured stdout. `fileDiffOf` used to read a whole diff into
 * memory and only then cut it to `maxBytes`, so a very large (or binary) change
 * could balloon the web process even though the comment claimed a bound. The
 * cap stops reading and kills the child; it sits well above the largest
 * `maxBytes` any caller asks for, so ordinary truncation is still reported by
 * the caller rather than silently here.
 */
export const DEFAULT_MAX_BUFFER = 4 * 1024 * 1024

/**
 * Run one read-only command and capture stdout.
 * @param {string} file executable to spawn (resolved via PATH)
 * @param {string[]} args argument array, never a shell string
 * @param {object} [opts]
 * @param {string} [opts.cwd] working directory; defaults to the process cwd
 * @param {number} [opts.timeoutMs] kill the child after this long
 * @param {number} [opts.maxBuffer] kill the child past this many bytes of stdout
 * @param {boolean} [opts.allowFailure] resolve null on non-zero exit instead of throwing
 * @param {boolean} [opts.keepStdoutOnFailure] with allowFailure, resolve the captured
 *   stdout instead of null when the process exits non-zero. Needed for `gh`
 *   subcommands whose exit code carries meaning but whose JSON body is still
 *   valid (`gh pr checks` exits 1 with "no checks reported" and 8 while checks
 *   are pending). An EMPTY stdout still resolves to null, so "failed with
 *   nothing to say" stays distinguishable from "failed, here is the body".
 * @returns {Promise<{stdout: string, capped: boolean}|null|undefined>} the
 *   capture, null on an allowed failure, undefined on a fatal one.
 */
function runCapture(file, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBuffer = Number.isInteger(opts.maxBuffer) && opts.maxBuffer > 0 ? opts.maxBuffer : DEFAULT_MAX_BUFFER
  const cwd = typeof opts.cwd === 'string' && opts.cwd.length > 0 ? opts.cwd : undefined
  return new Promise((resolve) => {
    let child
    try {
      child = spawn(file, args, { cwd, shell: false, windowsHide: true })
    } catch {
      resolve(null)
      return
    }
    let stdout = ''
    let size = 0
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      finish(opts.allowFailure ? null : undefined)
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      const over = size > maxBuffer
      // Keep at most `maxBuffer` characters (the cap is compared in bytes, so a
      // multi-byte payload can keep slightly more), so `capped` is always visible
      // in the returned text: the caller can then report truncation instead of
      // receiving an empty string that reads as "nothing to show".
      const room = maxBuffer - stdout.length
      if (room > 0) stdout += chunk.length <= room ? chunk : chunk.slice(0, room)
      if (!over) return
      // Over the cap: stop the child instead of buffering the rest of it.
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      finish(opts.keepStdoutOnCap === true ? { stdout, capped: true } : opts.allowFailure ? null : undefined)
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (code === 0) finish({ stdout, capped: false })
      else if (opts.allowFailure && opts.keepStdoutOnFailure && stdout.length > 0) finish({ stdout, capped: false })
      else finish(opts.allowFailure ? null : undefined)
    })
  })
}

/**
 * Run one read-only command and capture stdout as a string, discarding the
 * capture metadata. @see runCommandCapped for the pair that keeps it.
 * @returns {Promise<string|null|undefined>} stdout; null when `allowFailure`,
 *   undefined when the caller asked the failure to be fatal.
 */
export async function runCommand(file, args, opts = {}) {
  const out = await runCapture(file, args, opts)
  if (out !== null && typeof out === 'object') return out.stdout
  // Fatal failures resolve `undefined`; a spawn error is the one case that used to
  // resolve `null` here (#256). Every caller today passes allowFailure, so the two
  // are indistinguishable in practice — but the value is part of what callers see.
  return opts.allowFailure ? null : undefined
}

/**
 * Run one read-only command and report whether stdout was cut short.
 *
 * `runCommand` throws the partial read away when the cap is hit, which is how
 * a diff larger than 4x the returned cap rendered as "no change at all"
 * (issue #242). Callers that must distinguish "empty" from "too big" use this.
 * @returns {Promise<{stdout: string, capped: boolean}|null>} null when the
 *   command failed.
 */
export async function runCommandCapped(file, args, opts = {}) {
  const out = await runCapture(file, args, { ...opts, keepStdoutOnCap: true })
  return out !== null && typeof out === 'object' ? out : null
}

/** Is the given executable present on PATH? Uses `--version` as the probe. */
export async function commandAvailable(file) {
  const out = await runCommand(file, ['--version'], { allowFailure: true, timeoutMs: 5000 })
  return typeof out === 'string' && out.length > 0
}
