#!/usr/bin/env node
/**
 * Run the completion gate in a clean copy of this checkout (issue #43, item 3).
 *
 * Several sessions share one checkout. A plain `pnpm test` / `pnpm verify`
 * there can fail for reasons that have nothing to do with the change under
 * review:
 *
 *   1. another session's uncommitted edits — `check-bundle-versions` reads the
 *      working tree and calls tagged bundles dirty (issue #36 did this);
 *   2. the host's global git config — a mirror `insteadOf` rewrote test
 *      remotes and failed `dsh-git-status` (issue #39 section 4).
 *
 * This script checks HEAD out into a throwaway git worktree, runs the gate
 * there under an isolated environment — `HOME` pointed at an empty dir,
 * `GIT_CONFIG_GLOBAL` at an empty file, `GIT_CONFIG_NOSYSTEM=1` so
 * `/etc/gitconfig` is ignored too — and cleans everything up afterwards. The
 * host checkout is never written.
 *
 *   node scripts/verify-clean.mjs                 # install + verify + test
 *   node scripts/verify-clean.mjs -- <command…>   # run a custom gate instead
 *
 * Exit code = the gate's exit code (1 on setup failure, 130 on SIGINT/SIGTERM).
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

/** The default gate, run in order; the first failure ends the run. */
const DEFAULT_GATE = [
  ['pnpm', 'install', '--frozen-lockfile'],
  ['pnpm', 'verify'],
  ['pnpm', 'test'],
]

function parseArgs(argv) {
  const rest = []
  let passthrough = false
  for (const arg of argv) {
    if (passthrough) rest.push(arg)
    else if (arg === '--') passthrough = true
    else if (arg === '--help' || arg === '-h') {
      console.log('usage: node scripts/verify-clean.mjs [-- <command...>]')
      process.exit(0)
    } else {
      console.error(`unknown argument: ${arg}`)
      process.exit(1)
    }
  }
  return rest
}

/** One env-var bundle for every child we spawn. */
function isolatedEnv(home) {
  const gitconfig = join(home, 'gitconfig')
  writeFileSync(gitconfig, '') // ambient includes, aliases, insteadOf: gone
  return {
    ...process.env,
    HOME: home,
    GIT_CONFIG_GLOBAL: gitconfig,
    GIT_CONFIG_NOSYSTEM: '1',
  }
}

/** `git` in the worktree, with the isolated env — never the host's config. */
function git(args, env, options = {}) {
  return spawnSync('git', args, { encoding: 'utf8', env, ...options })
}

const custom = parseArgs(process.argv.slice(2))

/**
 * Shared cleanup: idempotent, never throws, safe from both the `finally` and
 * a signal handler racing it — whichever runs first wins, the second is a no-op
 * on already-removed paths (git remove fails → prune still unregisters).
 */
function cleanup(scratch, worktree, registered) {
  if (registered) {
    const remove = git(['worktree', 'remove', '--force', worktree], process.env, { cwd: ROOT })
    if (remove.status !== 0) {
      console.error('verify-clean: worktree remove failed, pruning the registration instead')
      git(['worktree', 'prune'], process.env, { cwd: ROOT })
    }
  }
  try {
    rmSync(scratch, { recursive: true, force: true })
  } catch (error) {
    console.error(`verify-clean: could not remove the scratch dir ${scratch}: ${error.message}`)
  }
}

async function main() {
  const scratch = mkdtempSync(join(tmpdir(), 'verify-clean-'))
  const worktree = join(scratch, 'checkout')
  const home = join(scratch, 'home')
  let registered = false

  // Interrupts: while `spawnSync` blocks on the gate, Node defers signal
  // handlers and the `finally` below cannot be relied on. The handler performs
  // the same cleanup itself and exits 130 (128+SIGINT). The gate child shares
  // our process group, so the terminal delivers the signal to it as well.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      cleanup(scratch, worktree, registered)
      process.exit(130)
    })
  }

  try {
    // Setup drops host GIT_DIR/GIT_WORK_TREE (delete the keys — an empty string
    // is itself a GIT_DIR pointing nowhere): a session exporting either would
    // aim the registration somewhere else entirely.
    const setupEnv = { ...process.env }
    for (const key of ['GIT_DIR', 'GIT_WORK_TREE']) delete setupEnv[key]
    setupEnv.GIT_CONFIG_NOSYSTEM = '1'
    // A worktree of HEAD, not a copy of the working tree: the gate must see the
    // committed state, with none of the host's dirt — that is the entire point.
    const add = git(['worktree', 'add', '--detach', worktree, 'HEAD'], setupEnv, { cwd: ROOT })
    if (add.status !== 0) {
      console.error(`verify-clean: could not create the worktree:\n${add.stderr}`)
      return 1 // return, never exit: exit here would skip the cleanup in finally
    }
    registered = true
    mkdirSync(home) // empty, not just nonexistent — HOME must exist for pnpm caches

    const env = isolatedEnv(home)
    // A step is one `[command, ...args]` array — a custom gate arrives as a flat
    // argv tail and is wrapped into a single step, never destructured in place.
    const steps = custom.length > 0 ? [custom] : DEFAULT_GATE
    let failed = 0

    for (const step of steps) {
      const [command, ...args] = step
      console.error(`\n=== ${command} ${args.join(' ')}`)  // stderr: stdout belongs to the gate
      // Spawn + event loop, not `spawnSync`: a blocking spawnSync defers signal
      // handlers for the whole gate (minutes on `pnpm install`), which is what
      // left interrupted runs stranded before. Polling keeps the loop live so
      // the SIGINT/SIGTERM handler above can actually fire.
      const run = spawn(command, args, { env, cwd: worktree, stdio: 'inherit' })
      const status = await new Promise((resolve) => {
        let code = null
        run.on('exit', (exitCode) => { code = exitCode })
        run.on('close', () => resolve(code))
        const poll = setInterval(() => {
          if (code !== null) { clearInterval(poll); resolve(code) }
        }, 200)
      })
      if (status !== 0) {
        console.error(`\nverify-clean: gate step failed (exit ${status}): ${command} ${args.join(' ')}`)
        failed = status ?? 1
        break
      }
    }

    if (failed === 0) console.error('\nverify-clean: gate green in a clean tree')
    return failed
  } finally {
    cleanup(scratch, worktree, registered)
  }
}

main().then((code) => process.exit(code))
