/**
 * Atomic file writes for the configs a crash must not truncate.
 *
 * `cordis.patch.yml` decides whether the host boots at all, and
 * `plugin-sync.json` holds the repository URL and token. A plain
 * `writeFileSync` truncates the target first, so a kill or power loss in the
 * middle leaves an unparsable file — and the read side then sees "no config"
 * rather than "the last good config" (#270).
 *
 * Write a temp file in the same directory, fix its mode, then rename over the
 * target: rename is atomic within a filesystem, so a reader sees either the old
 * bytes or the new ones.
 *
 * `fs` is injectable so a test can fail the write and prove the target is
 * untouched.
 */

import { randomBytes } from 'node:crypto'
import { closeSync, fchmodSync, openSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const REAL_FS = { closeSync, fchmodSync, openSync, renameSync, rmSync, writeFileSync }

/**
 * @param {string} path - target file (overwritten in place).
 * @param {string|Buffer} data
 * @param {{mode?: number, fs?: object}} [options]
 *   `mode` applies to the temp file before the rename, so an already-existing
 *   file gets its permissions corrected too (plain `writeFileSync` only sets
 *   the mode when it creates the file).
 */
export function atomicWrite(path, data, options = {}) {
  const io = options.fs ?? REAL_FS
  const mode = options.mode ?? 0o600
  // 同一毫秒内的两次写(面板连点)不能撞同一个临时文件名。
  const temp = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`
  try {
    const fd = io.openSync(temp, 'w', mode)
    try {
      io.writeFileSync(fd, data)
      io.fchmodSync(fd, mode)
    } finally {
      io.closeSync(fd)
    }
    io.renameSync(temp, path)
  } catch (error) {
    // A half-written temp file must not survive the failure it caused.
    try {
      io.rmSync(temp, { force: true })
    } catch {
      // best effort: the original error is the one worth reporting
    }
    throw error
  }
}
