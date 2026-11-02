/**
 * Install the items the user selected.
 *
 * Nothing here runs automatically. A sync pass is given an explicit list of
 * entries, installs exactly those, and reports per-item success — a partial
 * failure must leave the rest of the selection intact rather than aborting.
 *
 * Two install paths:
 *
 *   plugin   Written into the profile's `package.json` dependencies, then one
 *            `pnpm install` for the whole batch. Running pnpm once per plugin
 *            would be correct but slow and would thrash the lockfile.
 *   skill    Copied into `$DSH_HOME/inventory/skills/<name>/` (the vault) and
 *            linked into the profile's skill root, mirroring what
 *            `dsh-inventory` already does for its vault operations.
 *
 * `link:` specs are resolved against the local clone of the plugin repository,
 * not copied from the manifest — a path from another machine means nothing
 * here.
 */

import { execFile } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'

import { dshHome } from './dsh-home.js'
import { SKILL_NAME } from './scan-skills.js'

const run = promisify(execFile)

/** Where a plugin repository is cloned on this machine, for `repo` sources. */
export function defaultRepoRoot(env = process.env) {
  const explicit = env.DSH_PLUGIN_REPO
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const home = env.HOME ?? env.USERPROFILE
  return typeof home === 'string' && home.length > 0 ? join(home, '.dsh', 'plugin-repo') : null
}

/**
 * Resolve an entry to the spec that should go into `package.json`.
 *
 * `repo` entries resolve against the local clone. A missing clone is a
 * per-item error, not a reason to fail the whole batch.
 */
export function resolveSpec(entry, options = {}) {
  if (entry.kind !== 'plugin') return { error: `不是插件：${entry.name}` }
  const repoRoot = options.repoRoot ?? defaultRepoRoot()
  if (entry.source === 'repo') {
    if (repoRoot === null || !existsSync(repoRoot)) {
      return {
        error: `没有找到插件仓库副本（${repoRoot ?? '未配置 DSH_PLUGIN_REPO'}）`,
        // A fresh machine can bootstrap itself: the manifest carries the
        // plugin repository address, so the caller may offer one shallow
        // clone instead of dead-ending.
        cloneHint: typeof options.repoUrl === 'string' && options.repoUrl.length > 0 ? options.repoUrl : null,
      }
    }
    const local = findPackageDir(repoRoot, entry.name)
    if (local === null) return { error: `插件仓库里没有 ${entry.name}` }
    return { spec: `link:${local}` }
  }
  if (entry.source === 'npm') {
    const version = typeof entry.version === 'string' && entry.version.length > 0 ? entry.version : 'latest'
    return { spec: version }
  }
  if (entry.source === 'git' && typeof entry.spec === 'string' && entry.spec.length > 0) {
    return { spec: entry.spec }
  }
  return { error: `来源无法解析：${entry.source ?? '未知'}` }
}

/**
 * Find a package directory by its package.json name under a repository root.
 *
 * Names are matched against the real `name` field rather than the directory
 * name, because `@local/dsh-prompt-inject` lives in `packages/dsh-prompt-inject`
 * and `dsh-websearch-failover` lives in `packages/dsh-websearch-failover/plugin`.
 */
export function findPackageDir(root, name) {
  if (!existsSync(root)) return null
  const candidates = ['packages', 'plugins', '']
  for (const sub of candidates) {
    const base = sub.length > 0 ? join(root, sub) : root
    if (!existsSync(base)) continue
    for (const dir of listDirs(base)) {
      const found = matchName(join(base, dir), name)
      if (found !== null) return found
      // One more level for `packages/<x>/plugin`.
      for (const nested of listDirs(join(base, dir))) {
        const deep = matchName(join(base, dir, nested), name)
        if (deep !== null) return deep
      }
    }
  }
  return null
}

function matchName(dir, name) {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return null
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8'))
    return pkg?.name === name ? dir : null
  } catch {
    return null
  }
}

function listDirs(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
}

/**
 * Apply a selected set of entries.
 *
 * Returns one result per entry plus a batch summary. A failing item never
 * aborts the batch: the user picked several, and losing the successful ones
 * because one plugin name was misspelled would be the worst outcome.
 */
export async function applyItems(entries, options = {}) {
  const profileDir = options.profileDir
  if (typeof profileDir !== 'string' || !existsSync(profileDir)) {
    return { ok: false, error: '找不到 profile 目录', results: [] }
  }

  const plugins = []
  const skills = []
  const results = []

  // A fresh machine has no plugin repository clone. When the manifest tells us
  // where the repository lives, one shallow clone turns every repo-source entry
  // from a dead end into an installable row. Attempted at most once, and only
  // when at least one entry actually needs it.
  const needsClone = entries.some(
    (entry) => entry.kind === 'plugin' && entry.source === 'repo' && resolveNeedsClone(entry, options),
  )
  if (needsClone === true) {
    const bootstrapped = await bootstrapRepoClone(options)
    if (bootstrapped.ok !== true) {
      for (const entry of entries) {
        if (entry.kind !== 'plugin' || entry.source !== 'repo') continue
        results.push({ key: entryKeyOf(entry), ok: false, error: bootstrapped.error })
      }
    }
  }

  for (const entry of entries) {
    if (entry.kind === 'plugin') {
      const resolved = resolveSpec(entry, options)
      if (resolved.error !== undefined) {
        results.push({ key: entryKeyOf(entry), ok: false, error: resolved.error })
        continue
      }
      plugins.push({ entry, spec: resolved.spec })
      continue
    }
    if (entry.kind === 'skill') {
      // The name comes from a remote manifest and is later joined into paths
      // (repo skills dir and vault); a traversal name must never reach cpSync.
      if (typeof entry.name !== 'string' || !SKILL_NAME.test(entry.name)) {
        results.push({ key: entryKeyOf(entry), ok: false, error: '非法技能名' })
        continue
      }
      skills.push(entry)
      continue
    }
    results.push({ key: entryKeyOf(entry), ok: false, error: `${entry.kind} 暂不支持自动安装` })
  }

  // Plugins first: one pnpm run covers the whole batch.
  if (plugins.length > 0) {
    const written = writePluginDependencies(profileDir, plugins)
    if (written.error !== undefined) {
      for (const item of plugins) {
        results.push({ key: entryKeyOf(item.entry), ok: false, error: written.error })
      }
    } else {
      const installed = await runPnpmInstall(profileDir, options)
      if (installed.ok !== true && written.changed.length > 0) {
        // The install failed after `package.json` was already rewritten. The
        // written file may reference `link:` paths that do not exist here, and
        // DSH reads it at startup — leaving it broken silently is worse than
        // admitting the batch failed. Restore the exact prior content.
        const rolledBack = restorePackageJson(profileDir, written)
        // Both outcomes are reported: a silently failed rollback would leave
        // the user believing package.json was restored when it was not.
        installed.error = rolledBack.ok
          ? `${installed.error}（已回滚 package.json 改动）`
          : `${installed.error}（${rolledBack.error}）`
      }
      for (const item of plugins) {
        results.push({
          key: entryKeyOf(item.entry),
          ok: installed.ok,
          ...(installed.ok ? {} : { error: installed.error }),
          changed: written.changed.includes(item.entry.name),
        })
      }
    }
  }

  // Skills are file copies, independent of pnpm.
  for (const entry of skills) {
    const copied = copySkill(entry, options)
    // A copy that reached the vault but could not be linked is NOT a success:
    // no skill root scans the vault, so the skill stays inactive while the item
    // claims `ok` and the next diff would call it `current`. Surface the link
    // failure instead — the rest of the batch is still unaffected.
    const linkFailed = copied.ok === true && copied.linked === false
    results.push({
      key: entryKeyOf(entry),
      ok: copied.ok === true && !linkFailed,
      ...(copied.ok === true ? {} : { error: copied.error }),
      ...(linkFailed ? { error: copied.linkError, linked: false } : {}),
    })
  }

  const failed = results.filter((r) => r.ok !== true)
  return {
    ok: failed.length === 0,
    results: results.sort((a, b) => a.key.localeCompare(b.key)),
    applied: results.filter((r) => r.ok === true).length,
    failed: failed.length,
    ...(failed.length > 0 ? { error: `${failed.length} 项安装失败` } : {}),
  }
}

function entryKeyOf(entry) {
  return `${entry.kind}:${entry.name}`
}

/**
 * Restore `package.json` to the content captured before the batch wrote it.
 * Best effort: a failed rollback is reported, not thrown — the pnpm error the
 * user needs to see must not be swallowed by a secondary failure.
 */
function restorePackageJson(profileDir, written) {
  if (typeof written.previousContent !== 'string') {
    return { ok: false, error: '回滚 package.json 失败：没有保存原始内容' }
  }
  try {
    // The exact prior bytes, not a re-serialised approximation: DSH reads this
    // file at startup and the user may keep their own formatting in it.
    writeFileSync(join(profileDir, 'package.json'), written.previousContent)
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `回滚 package.json 失败：${error?.message ?? error}` }
  }
}

/**
 * Write the selected plugins into `package.json` dependencies.
 *
 * Returns the names that actually changed — a plugin already at the same spec
 * is not rewritten, so the caller can report "already installed" honestly.
 */
export function writePluginDependencies(profileDir, items) {
  const file = join(profileDir, 'package.json')
  let profile
  try {
    profile = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    return { error: `读取 profile package.json 失败：${error?.message ?? error}` }
  }
  if (profile === null || typeof profile !== 'object') {
    return { error: 'profile package.json 不是对象' }
  }
  const dependencies = profile.dependencies && typeof profile.dependencies === 'object' ? profile.dependencies : {}
  const changed = []
  for (const item of items) {
    if (dependencies[item.entry.name] === item.spec) continue
    dependencies[item.entry.name] = item.spec
    changed.push(item.entry.name)
  }
  if (changed.length === 0) return { changed }
  const before = readFileSync(file, 'utf8')
  profile.dependencies = dependencies
  try {
    writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`)
  } catch (error) {
    return { error: `写入 profile package.json 失败：${error?.message ?? error}` }
  }
  // Kept for rollback if the subsequent `pnpm install` fails (see applyItems).
  return { changed, previousContent: before }
}

/** Run one pnpm install for the batch. */
export async function runPnpmInstall(profileDir, options = {}) {
  const pnpm = typeof options.pnpmBin === 'string' && options.pnpmBin.length > 0 ? options.pnpmBin : 'pnpm'
  const timeout = typeof options.installTimeoutMs === 'number' ? options.installTimeoutMs : 300000
  try {
    await run(pnpm, ['install', '--prefer-offline'], {
      cwd: profileDir,
      timeout,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    })
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `pnpm install 失败：${describeInstallFailure(error, timeout)}` }
  }
}

/**
 * Explain a failed `git clone` in terms the user can act on.
 */
function describeCloneFailure(error) {
  const code = error?.code
  if (code === 'ENOENT') return '找不到 git 可执行文件'
  if (error?.killed === true || code === 'ETIMEDOUT') return '克隆超时'
  const message = String(error?.stderr ?? error?.message ?? error).split('\n').filter(Boolean).slice(-3).join(' ')
  return typeof code === 'number' ? `退出码 ${code}：${message}` : message
}


/**
 * Does this entry need a plugin repository clone that is not there yet?
 * Cheap, side-effect free: reuses resolveSpec's repo branch without doing work.
 */
function resolveNeedsClone(entry, options) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot()
  if (repoRoot === null || !existsSync(repoRoot)) {
    return typeof options.repoUrl === 'string' && options.repoUrl.length > 0
  }
  return false
}

/**
 * One `git clone --depth 1` of the plugin repository into the default
 * repo root. Never overwrites an existing clone; failures are per-batch
 * errors, not crashes.
 */
export async function bootstrapRepoClone(options = {}) {
  const repoUrl = typeof options.repoUrl === 'string' ? options.repoUrl.trim() : ''
  if (repoUrl.length === 0) {
    return { ok: false, error: '清单里没有 repoUrl，无法自动获取插件仓库' }
  }
  const repoRoot = options.repoRoot ?? defaultRepoRoot()
  if (repoRoot === null) return { ok: false, error: '无法确定插件仓库目录' }
  if (existsSync(repoRoot)) return { ok: true, cloned: false }
  const gitBin = typeof options.gitBin === 'string' && options.gitBin.length > 0 ? options.gitBin : 'git'
  try {
    await mkdir(repoRoot, { recursive: true })
    await run(gitBin, ['clone', '--depth', '1', '--quiet', repoUrl, repoRoot], {
      timeout: options.timeoutMs ?? 120000,
      windowsHide: true,
    })
    return { ok: true, cloned: true }
  } catch (error) {
    // Leave a clean slate so a later retry starts from "no clone".
    try {
      rmSync(repoRoot, { recursive: true, force: true })
    } catch {
      // best effort
    }
    return { ok: false, error: `克隆插件仓库失败：${explainError(error)}` }
  }
}

/**
 * Explain an `execFile` rejection in terms the user can act on.
 *
 * A missing binary, a timeout and a non-zero exit each need a different fix
 * (install pnpm / retry / read the log), so they must not collapse into one
 * opaque message.
 */
function describeInstallFailure(error, timeout) {
  const code = error?.code
  if (code === 'ENOENT') return '找不到 pnpm 可执行文件'
  if (error?.killed === true || code === 'ETIMEDOUT') return `执行超时（${timeout} 毫秒）`
  const message = String(error?.stderr ?? error?.message ?? error).split('\n').filter(Boolean).slice(-3).join(' ')
  return typeof code === 'number' ? `退出码 ${code}：${message}` : message
}

/**
 * Copy a skill into the vault and link it into the user skill root.
 *
 * The manifest names the skill; the content comes from the source repository's
 * `skills/<name>/` directory. A skill whose files are absent is an error the
 * user sees per item, not a silent skip.
 *
 * Copying alone would leave the skill vaulted — registered but never scanned
 * by any skill root — and the next diff would report it `current`, telling the
 * user the install worked when the model cannot invoke it. The copy is
 * therefore followed by a link into `$DSH_HOME/skills` so the skill is active
 * immediately, matching what the module header promises.
 */
export function copySkill(entry, options = {}) {
  const repoRoot = options.repoRoot ?? defaultRepoRoot()
  const vault = options.vaultDir
  if (typeof vault !== 'string' || vault.length === 0) {
    return { ok: false, error: '找不到 skill vault 目录' }
  }
  if (repoRoot === null) return { ok: false, error: '没有配置插件仓库副本' }
  const source = join(repoRoot, 'skills', entry.name)
  if (!existsSync(source)) return { ok: false, error: `仓库里没有 skills/${entry.name}` }
  const target = join(vault, entry.name)
  try {
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
  } catch (error) {
    return { ok: false, error: `复制 skill 失败：${error?.message ?? error}` }
  }

  // Link into the user skill root so the skill is model-invocable, not just
  // vaulted. A link that already exists (or a previous copy of the skill on
  // the root) is not an error: the skill is active either way.
  const linked = linkSkillToRoot(target, options)
  return { ok: true, path: target, linked: linked.ok, ...(linked.ok ? {} : { linkError: linked.error }) }
}

/**
 * Link one vaulted skill into `$DSH_HOME/skills`.
 *
 * `target` may be a directory (`<name>/SKILL.md`) or a single file. Symlink
 * where the platform allows it, fall back to a recursive copy — the skill
 * staying usable matters more than the deduplication a symlink buys.
 */
function linkSkillToRoot(target, options) {
  const root = skillRootOf(options)
  const name = basename(target)
  const linkPath = join(root, name)
  try {
    mkdirSync(root, { recursive: true })
    // A path already occupied by an earlier copy or link is not a failure: the
    // skill is reachable from the root either way, and replacing it could
    // clobber a directory the user manages by hand.
    if (existsSync(linkPath)) return { ok: true, path: linkPath }
    symlinkSync(target, linkPath, 'dir')
    return { ok: true, path: linkPath }
  } catch (error) {
    // Common failure: no symlink privilege on Windows without developer mode.
    try {
      cpSync(target, linkPath, { recursive: true })
      return { ok: true, path: linkPath, fallback: 'copy' }
    } catch (copyError) {
      return { ok: false, error: `链接技能到技能根失败：${copyError?.message ?? error?.message ?? error}` }
    }
  }
}

/**
 * The skill root a pulled skill is linked into.
 *
 * The profile's own root wins when the caller knows one (`options.skillRoot`).
 * Otherwise fall back to a root DSH actually scans, mirroring
 * `globalSkillRoots` in index.js: `$DSH_HOME/skills`, then the shared
 * `~/.agents/skills`, then `DSH_CUSTOM_SKILL_DIRS`. Linking into a directory no
 * root scans would leave the skill vaulted-only again — the bug this path
 * exists to fix.
 */
export function skillRootOf(options = {}) {
  const explicit = options.skillRoot
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  const env = options.env ?? process.env
  const first = join(dshHome(env), 'skills')
  const agentsHome =
    typeof env.DSH_AGENTS_HOME === 'string' && env.DSH_AGENTS_HOME.length > 0
      ? env.DSH_AGENTS_HOME
      : join(homedir(), '.agents')
  const candidates = [first, join(agentsHome, 'skills')]
  for (const dir of String(env.DSH_CUSTOM_SKILL_DIRS ?? '').split(delimiter)) {
    if (dir.length > 0) candidates.push(dir)
  }
  // An existing root wins; otherwise the DSH home root is created on demand.
  return candidates.find((candidate) => existsSync(candidate)) ?? first
}
