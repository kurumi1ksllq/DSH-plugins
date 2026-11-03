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
 * @returns {Promise<string|null>} stdout, or null on failure when allowFailure
 */
export function runCommand(file, args, opts = {}) {
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
      if (size > maxBuffer) {
        // Over the cap: stop the child instead of buffering the rest of it.
        try { child.kill('SIGKILL') } catch { /* already gone */ }
        finish(opts.allowFailure ? null : undefined)
        return
      }
      stdout += chunk
    })
    child.on('error', () => finish(null))
    child.on('close', (code) => {
      if (code === 0) finish(stdout)
      else if (opts.allowFailure && opts.keepStdoutOnFailure && stdout.length > 0) finish(stdout)
      else finish(opts.allowFailure ? null : undefined)
    })
  })
}

/** Is the given executable present on PATH? Uses `--version` as the probe. */
export async function commandAvailable(file) {
  const out = await runCommand(file, ['--version'], { allowFailure: true, timeoutMs: 5000 })
  return typeof out === 'string' && out.length > 0
}
