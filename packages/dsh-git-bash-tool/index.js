/**
 * dsh-git-bash-tool — run every shell command in Git Bash instead of PowerShell.
 *
 * Why this exists: `@deepseek-ai/dsh-bash-local` hardcodes the child argv as
 * `['bash', '-c', command]` (lib/index.js:142-147) and has no bashPath config.
 * On Windows a bare `bash` resolves to `C:\Windows\System32\bash.exe`, the WSL
 * stub, which prints "no distribution installed" garbage. The shipped
 * composition therefore disables the bash tool on win32 and mounts the pwsh
 * tool instead (dsh-base/cordis.patch.yml:249-287).
 *
 * This plugin keeps the stock executors (sandboxing, timeouts, spill files,
 * background jobs all unchanged) and rewrites the one place where the shell
 * binary is chosen: `spawnSpec`, the single seam both the confined and the
 * unconfined branches funnel through. The `bash` tool is then enabled and the
 * `pwsh` tool disabled by this bundle's cordis.patch.yml, so the model has no
 * PowerShell entry point at all.
 *
 * No `@deepseek-ai/*` imports: the class identity of the host's executor stays
 * untouched, and nothing here breaks when a package version changes.
 *
 * @module dsh-git-bash-tool
 */

/** Git for Windows' bash. Absolute on purpose: the whole point is to avoid PATH lookup. */
const GIT_BASH = 'C:\\Program Files\\Git\\bin\\bash.exe'

/** Git for Windows' MSYS bin directory, used only by the PATH fallback. */
const GIT_BIN = 'C:\\Program Files\\Git\\usr\\bin'

export const name = 'git-bash-tool'
export const inject = ['shell']

/**
 * Rewrite the shell binary in one spawn argv.
 * @param argv - the exact argv the executor is about to spawn.
 * @returns the same argv with a bare `bash` replaced by the absolute Git Bash path.
 */
function rewriteArgv(argv) {
  if (!Array.isArray(argv)) return argv
  return argv.map((arg) => (arg === 'bash' ? GIT_BASH : arg))
}

/**
 * Patch the mounted shell executor so every bash spawn uses Git Bash.
 * @param shell - the live `ctx.shell` service instance.
 * @returns a disposer restoring the previous behavior.
 */
function patchExecutor(shell) {
  const original = shell.spawnSpec
  if (typeof original !== 'function') return undefined
  const patched = (spec, argv, stdoutMaxBytes, signal) =>
    original.call(shell, spec, rewriteArgv(argv), stdoutMaxBytes, signal)
  shell.spawnSpec = patched
  return () => {
    if (shell.spawnSpec === patched) shell.spawnSpec = original
  }
}

/**
 * Fallback when the executor exposes no `spawnSpec` seam: make a bare `bash`
 * resolve to Git Bash for processes this host spawns. Scoped to the Harness
 * process, never to the machine.
 * @returns a disposer restoring the previous PATH, when it was changed.
 */
function prependPath() {
  const current = process.env.PATH ?? ''
  const entries = current.split(';').filter((entry) => entry !== '')
  const kept = entries.filter((entry) => entry.toLowerCase() !== GIT_BIN.toLowerCase())
  // Git's bin is usually on PATH already but *after* C:\Windows\system32, where the
  // WSL stub wins. Presence is not enough: it has to be first.
  process.env.PATH = [GIT_BIN, ...kept].join(';')
  return () => {
    process.env.PATH = current
  }
}

export function apply(ctx) {
  ctx.inject(['shell'], (scoped) => {
    const shell = scoped.shell
    scoped.effect(() => {
      const restore = patchExecutor(shell)
      if (restore !== undefined) return restore
      ctx.logger?.warn?.(
        'git-bash-tool: ctx.shell exposes no spawnSpec seam; falling back to a PATH prepend'
      )
      return prependPath() ?? (() => {})
    })
  })
}
