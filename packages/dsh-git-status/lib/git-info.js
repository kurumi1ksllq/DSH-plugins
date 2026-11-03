/**
 * Local git facts: branches, dirty state, recent commits, remotes, stashes.
 * Everything here is `git <read-only-subcommand>`; nothing mutates the repo.
 */

import { readFile, stat } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

import { runCommand } from './run.js'

/** How many changed paths a snapshot carries (issue #18); the rest are counted. */
export const MAX_CHANGES = 200
/** How many open stashes a snapshot carries (issue #20). */
export const MAX_STASHES = 20
/** How many ahead-of-upstream commit subjects a branch carries (issue #20). */
export const MAX_AHEAD_COMMITS = 20

/**
 * All branches (local + remote-tracking) with upstream deltas and the tip
 * commit, so the panel can say "3 hours ago · Fix: …" (issue #20).
 * Each line of `git branch -a --format` is NUL-separated:
 *   HEAD-marker \0 refname:short \0 upstream:short \0 upstream:track
 *   \0 committerdate:relative \0 subject
 * @param {string} repoDir git worktree root
 * @returns {Promise<Array<{name:string,current:boolean,remote:boolean,upstream:string|null,ahead:number|null,behind:number|null,gone:boolean,lastCommitDate:string|null,lastCommitSubject:string|null}>>}
 */
export async function branchesOf(repoDir) {
  const out = await runCommand(
    'git',
    [
      '-C', repoDir,
      'branch', '-a', '--no-color',
      '--format=%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:relative)%00%(subject)',
    ],
    { allowFailure: true },
  )
  if (typeof out !== 'string') return []
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [head = '', name = '', upstream = '', track = '', date = '', ...subject] = line.split('\0')
      if (name.length === 0) return null
      const aheadMatch = /ahead (\d+)/.exec(track)
      const behindMatch = /behind (\d+)/.exec(track)
      const subjectText = subject.join('\0')
      return {
        name,
        current: head.trim() === '*',
        remote: name.startsWith('remotes/'),
        upstream: upstream.length > 0 ? upstream : null,
        ahead: aheadMatch ? Number.parseInt(aheadMatch[1], 10) : null,
        behind: behindMatch ? Number.parseInt(behindMatch[1], 10) : null,
        gone: track.includes('gone'),
        lastCommitDate: date.length > 0 ? date : null,
        lastCommitSubject: subjectText.length > 0 ? subjectText : null,
      }
    })
    .filter(Boolean)
}

/** `X`/`Y` porcelain status letters → the group the panel renders. */
export function changeKindOf(x, y) {
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict'
  if (x !== '.' && x !== ' ') return 'staged'
  return 'unstaged'
}

/**
 * Working-tree state from `status --porcelain=v2 -b -z`.
 *
 * Porcelain v2 record kinds, each with its own meaning (issue #19):
 *   `1 ` ordinary tracked change   `2 ` rename/copy
 *   `u ` UNMERGED — an unresolved merge conflict
 *   `? ` untracked                 `! ` ignored
 * Conflicts used to be counted as untracked, which told the user the exact
 * opposite of what to do with them (an untracked file should NOT be committed;
 * a conflict MUST be resolved first), so conflicts get their own counter.
 *
 * The paths themselves are kept up to `maxChanges` (issue #18) instead of being
 * discarded after counting, so the panel can show what actually changed.
 * @param {string} repoDir
 * @param {object} [opts]
 * @param {number} [opts.maxChanges] cap on carried entries (default 200)
 */
export async function statusOf(repoDir, opts = {}) {
  const maxChanges = Number.isInteger(opts.maxChanges) && opts.maxChanges > 0 ? opts.maxChanges : MAX_CHANGES
  const empty = {
    branch: null, detached: false, dirty: 0,
    changed: 0, untracked: 0, conflicts: 0, staged: 0, unstaged: 0,
    changes: [], changesTruncated: false, changesTotal: 0,
  }
  // `-uall` expands untracked DIRECTORIES into their files. Plain porcelain v2
  // collapses a new directory to `? sub/`, and a directory has no diff — the
  // panel listed a row whose preview was always empty (issue #18 was defeated
  // by its own data source). `--no-renames` keeps a rename as delete+add pairs,
  // so no path is ever reported only as its pre-rename name.
  const out = await runCommand(
    'git',
    ['-C', repoDir, 'status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all', '--no-renames'],
    { allowFailure: true },
  )
  if (typeof out !== 'string') return empty

  let branch = null
  let detached = false
  let changed = 0
  let untracked = 0
  let conflicts = 0
  let total = 0
  const changes = []
  const pushChange = (entry) => {
    total += 1
    if (changes.length < maxChanges) changes.push(entry)
  }

  // `-z` NUL-joins records, and a type-2 record is followed by its ORIGINAL
  // path as a bare record — so that one is consumed, not re-parsed.
  const records = out.split('\0')
  for (let i = 0; i < records.length; i += 1) {
    const line = records[i]
    if (typeof line !== 'string' || line.length === 0) continue
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length).trim()
      detached = branch === '(detached)'
      continue
    }
    if (line.startsWith('1 ') || line.startsWith('2 ')) {
      // `1 XY sub mH mI mW hH hI path`  → path starts at field 8
      // `2 XY sub mH mI mW hH hI Xscore path` → path starts at field 9
      const parts = line.split(' ')
      const x = (parts[1] ?? '..').slice(0, 1)
      const y = (parts[1] ?? '..').slice(1, 2)
      const pathAt = line.startsWith('2 ') ? 9 : 8
      let origPath = null
      if (line.startsWith('2 ')) {
        const next = records[i + 1]
        origPath = typeof next === 'string' && next.length > 0 ? next : null
        i += 1
      }
      changed += 1
      pushChange({
        path: parts.slice(pathAt).join(' '), origPath, index: x, worktree: y,
        kind: changeKindOf(x, y),
        untracked: false, conflict: false,
        staged: x !== '.' && x !== ' ',
      })
      continue
    }
    if (line.startsWith('u ')) {
      // `u XY sub m1 m2 m3 mW h1 h2 h3 path` — unmerged, never "untracked".
      const parts = line.split(' ')
      const xy = parts[1] ?? 'UU'
      conflicts += 1
      pushChange({
        path: parts.slice(10).join(' '), origPath: null,
        index: xy.slice(0, 1), worktree: xy.slice(1, 2),
        kind: 'conflict',
        untracked: false, conflict: true, staged: false,
      })
      continue
    }
    if (line.startsWith('? ')) {
      untracked += 1
      pushChange({
        path: line.slice(2), origPath: null, index: '?', worktree: '?',
        kind: 'untracked',
        untracked: true, conflict: false, staged: false,
      })
    }
  }

  return {
    branch,
    detached,
    // Conflicts are their own bucket: dirty still means "something is not
    // committed", but nothing downstream may treat a conflict as untracked.
    dirty: changed + untracked + conflicts,
    changed,
    untracked,
    conflicts,
    staged: changes.filter((c) => c.kind === 'staged').length,
    unstaged: changes.filter((c) => c.kind === 'unstaged').length,
    changes,
    changesTruncated: total > changes.length,
    changesTotal: total,
  }
}

/** Last N commits, newest first. */
export async function recentCommitsOf(repoDir, limit = 10) {
  const out = await runCommand(
    'git',
    ['-C', repoDir, 'log', `--max-count=${limit}`, '--date=relative', '--pretty=format:%h\t%H\t%an\t%ad\t%s'],
    { allowFailure: true },
  )
  if (typeof out !== 'string') return []
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [hash = '', fullHash = '', author = '', date = '', ...rest] = line.split('\t')
      return { hash, fullHash, author, date, subject: rest.join('\t') }
    })
}

/**
 * Commits on HEAD that are NOT on its upstream — the answer to "what are the
 * 3 commits I am ahead by?" (issue #20). Empty when there is no upstream.
 * @param {string} repoDir
 * @param {number} [limit]
 */
export async function aheadCommitsOf(repoDir, limit = MAX_AHEAD_COMMITS) {
  const out = await runCommand(
    'git',
    ['-C', repoDir, 'log', '@{u}..HEAD', `--max-count=${limit}`, '--pretty=format:%h%x00%H%x00%s'],
    { allowFailure: true },
  )
  if (typeof out !== 'string') return []
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [hash = '', fullHash = '', subject = ''] = line.split('\0')
      return { hash, fullHash, subject }
    })
}

/**
 * Strip credentials out of a remote URL before it is ever rendered.
 * `https://user:ghp_xxx@github.com/o/r.git` becomes `https://user@github.com/…`
 * (the user name is kept: it is the one part that is not a secret), and any
 * `user:pass@` in a bare URL loses the password. A token pasted into a remote
 * is a real leak vector for a panel every local process can read.
 * @param {string} url
 */
export function redactRemoteUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return url
  const known = /^(?:git|oauth2|x-access-token|token|anonymous)$/i
  const scp = /^([^/:\s]+):([^/@\s]+)@([^/:\s]+:)/.exec(url)
  if (scp !== null) {
    // user:secret@host:path — the secret goes, a well-known user name too.
    return known.test(scp[1]) ? `***@${scp[3]}` : `${scp[1]}@${scp[3]}`
  }
  const scheme = /^([a-z][a-z0-9+.-]*:\/\/)(.*)$/i.exec(url)
  if (scheme === null) return url
  const [rest, tail] = [scheme[2], scheme[1]]
  const at = rest.lastIndexOf('@')
  if (at < 0) return url
  const userinfo = rest.slice(0, at)
  const host = rest.slice(at + 1)
  const colon = userinfo.indexOf(':')
  if (colon < 0) {
    // No password part: the "user name" is either a name or a pasted token.
    return known.test(userinfo) ? url : `${tail}***@${host}`
  }
  const user = userinfo.slice(0, colon)
  return known.test(user) ? `${tail}***@${host}` : `${tail}${user}@${host}`
}

/**
 * Configured remotes: [{ name, url }] (fetch URL only), credential-free.
 *
 * Read from `git config` rather than `git remote -v`: the latter prints the URL
 * *after* `url.<base>.insteadOf` rewriting, so on a machine configured with a
 * mirror the panel received `https://mirror/…/https://github.com/me/repo.git`
 * and could no longer parse owner/repo for its GitHub links. `git config` reports
 * what the repository actually says.
 */
export async function remotesOf(repoDir) {
  const out = await runCommand('git', ['-C', repoDir, 'config', '--get-regexp', '^remote\..*\.url$'], {
    allowFailure: true,
  })
  if (typeof out !== 'string') return []
  const seen = new Map()
  for (const line of out.split('\n')) {
    // `remote.<name>.url <url>`; the name may itself contain dots.
    const match = /^remote\.(.+)\.url (.+)$/.exec(line.trim())
    if (match) seen.set(match[1], redactRemoteUrl(match[2]))
  }
  return [...seen].map(([name, url]) => ({ name, url }))
}

/**
 * Open stashes with what they hold: `{ ref, when, subject }` (issue #20).
 * `%gd` is the `stash@{n}` selector (`--date=relative` would rewrite it to
 * `stash@{2 hours ago}`, so the date is formatted separately), `%ci` the
 * commit date and `%s` the stash message. Listing stays read-only: stash
 * contents are never popped or inspected.
 * @param {string} repoDir
 * @param {number} [limit]
 */
export async function stashListOf(repoDir, limit = MAX_STASHES) {
  const out = await runCommand(
    'git',
    ['-C', repoDir, 'stash', 'list', '--format=%gd%x00%ci%x00%s'],
    { allowFailure: true },
  )
  if (typeof out !== 'string') return []
  return out
    .split('\n')
    .filter((line) => line.length > 0)
    .slice(0, limit)
    .map((line) => {
      const [ref = '', when = '', ...subject] = line.split('\0')
      return { ref, when, subject: subject.join('\0') }
    })
}

/** Open stash count (cheap; used for the badge even when the list is capped). */
export async function stashCountOf(repoDir) {
  const out = await runCommand('git', ['-C', repoDir, 'stash', 'list'], { allowFailure: true })
  if (typeof out !== 'string') return 0
  return out.split('\n').filter((line) => line.length > 0).length
}

/**
 * One path's uncommitted diff, read-only, for the panel's diff preview
 * (issue #22). Unstaged and staged halves are concatenated when both exist.
 *
 * `allowAddedFallback` is the caller's promise that this path is untracked;
 * only then may an empty diff be rendered from the file's contents. Reading
 * any empty-diff path as "a new file" is how a clean, committed file could be
 * served in full to a route that any same-origin request can call.
 * @param {string} repoDir
 * @param {string} path repo-relative path (`absolute` also accepted)
 * @param {object} [opts]
 * @param {number} [opts.maxBytes] cap on the returned diff
 * @param {boolean} [opts.allowAddedFallback] read the file when it has no diff
 * @param {string} [opts.displayPath] path to report back (defaults to `path`)
 * @returns {Promise<{path:string,diff:string,truncated:boolean}|null>}
 */
export async function fileDiffOf(repoDir, path, opts = {}) {
  if (typeof path !== 'string' || path.length === 0) return null
  const maxBytes = Number.isInteger(opts.maxBytes) && opts.maxBytes > 0 ? opts.maxBytes : 200_000
  const displayPath = typeof opts.displayPath === 'string' && opts.displayPath.length > 0 ? opts.displayPath : path
  const parts = []
  for (const extra of [[], ['--cached']]) {
    const out = await runCommand(
      'git',
      ['-C', repoDir, 'diff', '--no-color', '--no-ext-diff', ...extra, '--', displayPath],
      // Bound the read itself, not just the returned string: the child is
      // killed once it would exceed this, instead of buffering a whole file.
      { allowFailure: true, maxBuffer: maxBytes * 4 },
    )
    // Trimmed so the unstaged and staged halves join without a blank line
    // between them: each `git diff` output ends with a newline of its own.
    if (typeof out === 'string' && out.trim().length > 0) parts.push(out.trimEnd())
  }
  if (parts.length === 0 && opts.allowAddedFallback === true) {
    const added = await addedFileHunkOf(repoDir, path, maxBytes)
    if (added !== null) parts.push(added.trimEnd())
  }
  const diff = parts.join('\n')
  const truncated = diff.length > maxBytes
  return { path: displayPath, diff: truncated ? diff.slice(0, maxBytes) : diff, truncated }
}

/**
 * Render an untracked file as a unified-diff "pure addition" hunk.
 * `git diff --no-index` needs two real paths (`-- /dev/null <path>` prints
 * nothing on GNU git), so the file is read directly instead. Read-only.
 * @param {string} repoDir
 * @param {string} path repo-relative path, or an absolute one inside it
 * @param {number} [maxBytes]
 * @returns {Promise<string|null>}
 */
async function addedFileHunkOf(repoDir, path, maxBytes = 200_000) {
  const absolute = resolve(repoDir, path)
  if (absolute !== resolve(repoDir) && !absolute.startsWith(resolve(repoDir) + sep)) return null
  try {
    const info = await stat(absolute)
    // A symlink is not an untracked file with content: following it is how a
    // path inside the repo would read a file outside it.
    if (info.isSymbolicLink() || !info.isFile()) return null
    // Cap the read so a huge binary never lands in a snapshot response.
    if (info.size > Math.max(maxBytes * 2, 400_000)) return null
    const text = await readFile(absolute, 'utf8')
    if (text.includes('\0')) return null // binary
    const lines = text.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    const body = lines.map((line) => `+${line}`).join('\n')
    const headerPath = absolute === resolve(repoDir) ? path : absolute.slice(resolve(repoDir).length + 1)
    return [
      `diff --git a/${headerPath} b/${headerPath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${headerPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      body,
    ].join('\n')
  } catch {
    return null
  }
}
