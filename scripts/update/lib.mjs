/**
 * Shared helpers for `scripts/update.mjs`: subprocess running, git reads,
 * profile `link:` resolution, the advisory lock and the journal.
 *
 * Everything here is read-only with respect to a DSH profile. The tool never
 * writes profile files: profile mutation is delegated to DSH's own plugin
 * manager so it happens under the profile manifest write lock
 * (`dsh-plugin-manager/lib/index.js`, `lockWaitMs`).
 *
 * Design notes live in docs/update-scheme.md (§4.2) and docs/update-checkout.md.
 */
import { execFile } from 'node:child_process'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Run a command, never throwing. Always returns `{ ok, code, stdout, stderr }`. */
export async function sh(cmd, args, options = {}) {
  try {
    const { stdout, stderr } = await run(cmd, args, {
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 120000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      env: process.env,
    })
    return { ok: true, code: 0, stdout: String(stdout), stderr: String(stderr) }
  } catch (error) {
    return {
      ok: false,
      code: typeof error?.code === 'number' ? error.code : null,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? error?.message ?? error),
      timedOut: error?.killed === true || error?.code === 'ETIMEDOUT',
    }
  }
}

/** Last non-empty lines of a command's diagnostics, for a one-line report. */
export function tail(result, lines = 3) {
  const text = `${result.stderr}\n${result.stdout}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return text.slice(-lines).join(' | ')
}

export function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * Resolve a `link:` / `file:` dependency spec to a concrete path.
 * Mirrors the resolution rule used by dsh-inventory's profile reader.
 */
export function resolveLinkTarget(spec, profileDir) {
  if (typeof spec !== 'string') return null
  const match = /^(?:link|file):(.+)$/.exec(spec.trim())
  if (match === null) return null
  const raw = match[1]
  return isAbsolute(raw) ? raw : resolve(profileDir, raw)
}

/** Which checkout owns a path, per git. Null when the path is not in a repo. */
export async function owningCheckout(dir) {
  const top = await sh('git', ['-C', dir, 'rev-parse', '--show-toplevel'])
  if (!top.ok) return null
  return resolve(top.stdout.trim())
}

export async function gitHead(checkout) {
  const out = await sh('git', ['-C', checkout, 'rev-parse', 'HEAD'])
  return out.ok ? out.stdout.trim() : null
}

export async function gitDirty(checkout, path) {
  const out = await sh('git', ['-C', checkout, 'status', '--porcelain', '--', path])
  if (!out.ok) return null
  return out.stdout.trim()
}

/**
 * Advisory lock, mirroring `@deepseek-ai/dsh-atomic-write`'s rule: a lock file
 * whose recorded PID is gone may be taken over, but file age alone never
 * removes a lock. Only writers contend; readers never take it.
 */
export function acquireLock(lockPath, { waitMs = 30000 } = {}) {
  const deadline = Date.now() + waitMs
  mkdirSync(dirname(lockPath), { recursive: true })
  for (;;) {
    try {
      const fd = openSync(lockPath, 'wx')
      writeSync(fd, `${process.pid}\n`)
      fsyncSync(fd)
      closeSync(fd)
      return { release: () => rmSync(lockPath, { force: true }) }
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error
      let alive = false
      let holder = null
      try {
        holder = readFileSync(lockPath, 'utf8').trim()
        const pid = Number.parseInt(holder, 10)
        if (!Number.isNaN(pid)) {
          try {
            process.kill(pid, 0)
            alive = true
          } catch (probe) {
            alive = probe?.code !== 'ESRCH'
          }
        }
      } catch {
        alive = false
      }
      if (!alive) {
        rmSync(lockPath, { force: true })
        continue
      }
      if (Date.now() > deadline) return { error: `lock is held by pid ${holder}: ${lockPath}` }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200)
    }
  }
}

/**
 * State root: journal + lock live under `$DSH_HOME/update` by default so they
 * sit next to DSH's own state. `--state-dir` overrides it (tests, and any
 * machine where `~/.dsh` is not writable).
 */
export function stateDir(override = null) {
  if (override !== null && override !== undefined) return resolve(override)
  if (process.env.DSH_UPDATE_STATE) return resolve(process.env.DSH_UPDATE_STATE)
  const home = process.env.DSH_HOME ? resolve(process.env.DSH_HOME) : join(process.env.HOME ?? '.', '.dsh')
  return join(home, 'update')
}

export function journalDir(root) {
  return join(root, 'journal')
}

/** Append one JSON record to the journal; returns the file path. */
export function writeJournal(root, id, record) {
  const dir = journalDir(root)
  mkdirSync(dir, { recursive: true })
  // The file basename is the run id itself: stage discovery reads `<id>.jsonl`
  // straight from a staging path, so any extra prefix would break that lookup.
  const file = join(dir, `${id}.jsonl`)
  appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`, 'utf8')
  return file
}

/** Per-run id: sortable and unique enough for a single-machine tool. */
export function runId(prefix = 'update') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `${prefix}-${stamp}-${process.pid}`
}

/**
 * Byte-exact snapshot of the profile files an update can disturb. Written
 * before any swap so a rollback can restore them without guessing which ones
 * the plugin manager touched (`pnpm-workspace.yaml` is the classic omission —
 * the manager's own failure recovery deliberately does not restore it).
 */
export const PROFILE_SNAPSHOT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'cordis.patch.yml',
  'pnpm-workspace.yaml',
  'compatibility.json',
]

export function snapshotProfileFiles(profileDir, outDir) {
  mkdirSync(outDir, { recursive: true })
  const kept = []
  for (const name of PROFILE_SNAPSHOT_FILES) {
    const from = join(profileDir, name)
    if (!existsSync(from)) continue
    writeFileSync(join(outDir, name), readFileSync(from))
    kept.push({ name, bytes: statSync(from).size })
  }
  return { dir: outDir, kept }
}

export function restoreProfileFiles(snapshotDir, profileDir) {
  const restored = []
  if (!existsSync(snapshotDir)) return restored
  for (const name of PROFILE_SNAPSHOT_FILES) {
    const from = join(snapshotDir, name)
    if (!existsSync(from)) continue
    writeFileSync(join(profileDir, name), readFileSync(from))
    restored.push(name)
  }
  return restored
}

/** Short revision, for tables. */
export function short(rev, length = 7) {
  return typeof rev === 'string' ? rev.slice(0, length) : String(rev)
}
