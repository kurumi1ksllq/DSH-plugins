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
 * Run one read-only command and capture stdout.
 * @param {string} file executable to spawn (resolved via PATH)
 * @param {string[]} args argument array, never a shell string
 * @param {object} [opts]
 * @param {string} [opts.cwd] working directory; defaults to the process cwd
 * @param {number} [opts.timeoutMs] kill the child after this long
 * @param {boolean} [opts.allowFailure] resolve null on non-zero exit instead of throwing
 * @returns {Promise<string|null>} stdout, or null on failure when allowFailure
 */
export function runCommand(file, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
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
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      resolve(opts.allowFailure ? null : undefined)
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => { stdout += chunk })
    child.on('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(null)
    })
    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else resolve(opts.allowFailure ? null : undefined)
    })
  })
}

/** Is the given executable present on PATH? Uses `--version` as the probe. */
export async function commandAvailable(file) {
  const out = await runCommand(file, ['--version'], { allowFailure: true, timeoutMs: 5000 })
  return typeof out === 'string' && out.length > 0
}
