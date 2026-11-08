/**
 * dsh-git-bash-tool - run every shell command in Git Bash instead of PowerShell.
 *
 * Why this exists: `@deepseek-ai/dsh-bash-local` hardcodes the child argv as
 * `['bash', '-c', command]` (lib/index.js:142-147) and has no bashPath config.
 * On Windows a bare `bash` resolves to `C:\\Windows\\System32\\bash.exe`, the WSL
 * stub, which prints "no distribution installed" garbage. The shipped
 * composition therefore disables the bash tool on win32 and mounts the pwsh
 * tool instead (dsh-base/cordis.patch.yml:249-287).
 *
 * This plugin keeps the stock executors (sandboxing, timeouts, spill files,
 * background jobs all unchanged) and rewrites the one place where the shell
 * binary is chosen: `spawnSpec`, the single seam both the confined and the
 * unconfined branch funnel through. The `bash` tool is then enabled and the
 * `pwsh` tool disabled by this bundle's cordis.patch.yml, so the model has no
 * PowerShell entry point at all.
 *
 * Confined (sandboxed) spawns wrap the real argv after a `--` separator -
 * [runner, ..., "--", "bash", "-c", cmd] - so the rewrite is separator-aware
 * and retargets the element right after the first `--` (#105).
 *
 * No `@deepseek-ai/*` imports: the class identity of the host's executor stays
 * untouched, and nothing here breaks when a package version changes.
 *
 * @module dsh-git-bash-tool
 */

import { existsSync } from 'node:fs'

/** Git for Windows' bash. Absolute on purpose: the whole point is to avoid PATH lookup. */
export const DEFAULT_GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'

/** Git for Windows' MSYS bin directory, used only by the PATH fallback. */
const GIT_BIN = 'C:\\Program Files\\Git\\usr\\bin'

export const name = 'git-bash-tool'
export const inject = ['shell']

/**
 * Build the argv rewrite for one effective Git Bash path.
 *
 * Only the spawn target is rewritten, by position - never by matching the
 * string `bash` anywhere in the argv. The direct convention is
 * `['bash', '-c', cmd]` (argv[0]); the confined convention is
 * `[runner, ..., '--', 'bash', '-c', cmd]` (the element after the first `--`).
 * A command that merely contains the word `bash` must not be rewritten.
 * @param gitBash - the absolute Git Bash path to rewrite targets to.
 * @returns a pure argv rewriter.
 */
function makeRewrite(gitBash) {
  return function rewriteArgv(argv) {
    if (!Array.isArray(argv) || argv.length === 0) return argv
    if (argv[0] === 'bash') return [gitBash, ...argv.slice(1)]
    if (argv[0] !== '--') {
      const sep = argv.indexOf('--', 1)
      if (sep > 0 && argv[sep + 1] === 'bash') {
        return [...argv.slice(0, sep + 1), gitBash, ...argv.slice(sep + 2)]
      }
    }
    return argv
  }
}

/**
 * Patch the mounted shell executor so every bash spawn uses Git Bash.
 * @param shell - the live `ctx.shell` service instance.
 * @param rewrite - the pure argv rewriter.
 * @returns a disposer restoring the previous behavior.
 */
function patchExecutor(shell, rewrite) {
  const original = shell.spawnSpec
  if (typeof original !== 'function') return undefined
  const patched = (spec, argv, stdoutMaxBytes, signal) =>
    original.call(shell, spec, rewrite(argv), stdoutMaxBytes, signal)
  shell.spawnSpec = patched
  return () => {
    if (shell.spawnSpec === patched) shell.spawnSpec = original
  }
}

/**
 * Fallback when the executor exposes no `spawnSpec` seam or the Git Bash
 * binary is missing: make a bare `bash` resolve to Git Bash for processes this
 * host spawns. Scoped to the Harness process, never to the machine.
 * @returns a disposer restoring the previous PATH, when it was changed.
 */
function prependPath() {
  const current = process.env.PATH ?? ''
  const entries = current.split(';').filter((entry) => entry !== '')
  const kept = entries.filter((entry) => entry.toLowerCase() !== GIT_BIN.toLowerCase())
  // Git's bin is usually on PATH already but *after* C:\\Windows\\system32, where the
  // WSL stub wins. Presence is not enough: it has to be first.
  process.env.PATH = [GIT_BIN, ...kept].join(';')
  return () => {
    process.env.PATH = current
  }
}

/**
 * Whether this host can actually use Git Bash.
 *
 * The platform gate belongs in `cordis.patch.yml`, which is static - this guard
 * only keeps the plugin from rewriting argv (to `C:\\Program Files\\...`) or
 * prepending a Windows PATH on a host where Git Bash cannot exist.
 * @returns true on Windows, where Git for Windows ships a bash binary.
 */
export function isSupported() {
  return process.platform === 'win32'
}

/**
 * @param ctx - the Cordis context.
 * @param {{gitBashPath?: string}} [options] - inject the binary path in tests;
 *   defaults to Git for Windows' installed location.
 */
export function apply(ctx, options = {}) {
  if (!isSupported()) {
    // Linux/macOS already ship a real `bash`; rewriting it would break every command.
    ctx.logger?.debug?.('git-bash-tool: not win32, leaving the shell executor untouched')
    return
  }
  const gitBash = typeof options.gitBashPath === 'string' && options.gitBashPath.length > 0
    ? options.gitBashPath
    : DEFAULT_GIT_BASH
  ctx.inject(['shell'], (scoped) => {
    const shell = scoped.shell
    scoped.effect(() => {
      if (!existsSync(gitBash)) {
        ctx.logger?.warn?.('git-bash-tool: ' + gitBash + ' is missing; falling back to a PATH prepend (#105)')
        return prependPath() ?? (() => {})
      }
      const restore = patchExecutor(shell, makeRewrite(gitBash))
      if (restore !== undefined) return restore
      ctx.logger?.warn?.('git-bash-tool: ctx.shell exposes no spawnSpec seam; falling back to a PATH prepend')
      return prependPath() ?? (() => {})
    })
  })
}
