/**
 * Fetch the target repository's manifest into a throwaway clone.
 *
 * `--depth 1 --single-branch` keeps this cheap: the manifest is one small file
 * at the root and history is irrelevant. A private repository relies on the
 * ambient git credentials of the host, exactly like a manual clone would.
 *
 * Every failure returns `{ ok: false, reason }` instead of throwing: a network
 * outage must never stop the harness from booting.
 */
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { MANIFEST_NAME } from './config.js'
import { parseManifest } from './compare.js'

const execFileAsync = promisify(execFile)

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

export async function fetchManifest(config, options = {}) {
  const run = options.execFile ?? execFileAsync
  if (typeof config.repo !== 'string' || config.repo.length === 0) {
    return { ok: false, reason: 'no-repo-configured', plugins: [], problems: [] }
  }

  let workDir
  try {
    workDir = mkdtempSync(join(tmpdir(), 'dsh-plugin-sync-'))
  } catch (error) {
    return { ok: false, reason: `tempdir-failed: ${error?.message ?? error}`, plugins: [], problems: [] }
  }

  try {
    await run('git', ['clone', '--depth', '1', '--branch', config.ref, '--single-branch', config.repo, workDir], {
      timeout: config.gitTimeoutMs,
      windowsHide: true,
    })
    const manifestFile = join(workDir, MANIFEST_NAME)
    if (!existsSync(manifestFile)) {
      return { ok: false, reason: `manifest-missing: ${MANIFEST_NAME}`, plugins: [], problems: [] }
    }
    const raw = readJson(manifestFile)
    if (raw === null) return { ok: false, reason: 'manifest-unreadable', plugins: [], problems: [] }
    const { plugins, problems } = parseManifest(raw)
    return { ok: true, reason: null, plugins, problems }
  } catch (error) {
    const message = error?.stderr ? String(error.stderr).trim() : String(error?.message ?? error)
    return { ok: false, reason: `git-failed: ${message}`, plugins: [], problems: [] }
  } finally {
    // A leftover temp dir is not worth failing a boot over.
    try {
      if (workDir !== undefined) rmSync(workDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}
