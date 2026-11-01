// PART 1 — header, locales
/**
 * dsh-git-status — browser half.
 *
 * Adds a left-sidebar entry (id `git-status`) with a full-height main panel.
 * Reads `GET /git-status/snapshot` from the host half and renders four grouped
 * views: current repo state, branches, open PRs, open issues. When the gh CLI
 * is unavailable the PR/issue cards are replaced by a one-line hint. When the
 * workspace is not a git project the panel shows an empty state.
 *
 * Visual language matches dsh-inventory: Apple grouped lists — one large
 * title, grouped inset cards, 44px rows separated by hairlines. Read-only:
 * nothing here issues anything but GET, and rows never mutate repo state.
 */

window.__ModuleLoader__.load({
  id: 'dsh-git-status',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'git-status'
    const ROUTE = '/git-status/snapshot'
    const DIFF_ROUTE = '/git-status/diff'

    const zh = {
      tab: 'Git',
      panel: 'Git',
      back: '返回对话',
      title: 'Git 概览',
      subtitle: '当前工作区的分支、改动、PR 与 issue(只读,不改动仓库)。',
      refresh: '刷新',
      loading: '正在读取仓库信息…',
      emptyTitle: '这里不是 git 项目',
      emptyBody: '当前工作区没有检测到 .git 仓库。打开一个 git 项目所在的工作区后,这里会显示分支、改动、PR 和 issue。',
      fetchFailed: '读取失败',
      retry: '重试',
      sectionRepo: '当前仓库',
      detached: '游离 HEAD',
      dirty: '未提交改动',
      untracked: '未跟踪',
      changed: '已跟踪改动',
      stashes: 'stash',
      aheadBehind: (a, b) => `领先 ${a} / 落后 ${b}`,
      clean: '工作区干净',
      sectionBranches: '分支',
      branchGone: '上游已删除',
      branchCurrent: '当前',
      branchRemote: '远程',
      branchNoUpstream: '未设置上游',
      noBranches: '没有分支信息',
      sectionPrs: '未合并 PR',
      prDraft: '草稿',
      prBlocked: '有冲突',
      prsMergedNote: '最近已合并(本地分支可能可以清理)',
      noPrs: '没有打开中的 PR',
      sectionIssues: 'Issue',
      noIssues: '没有打开中的 issue',
      ghHintNotInstalled: '未检测到 gh CLI。安装并 `gh auth login` 后,这里会显示 PR 和 issue。',
      ghHintNotLoggedIn: 'gh CLI 已安装但未登录。运行 `gh auth login` 后即可显示 PR 和 issue。',
      ghHintFailed: 'gh 查询失败,PR / issue 暂不可用。',
      ghHintNoRemote: '这个仓库还没有配置远程(remote),所以没有 PR / issue 可查。',
      ghHintNotGithub: '远程不是 GitHub,按 GitHub 口径的 PR / issue 查询不适用。',
      ghSource: (src) => `已认证:${src}`,
      conflicts: '冲突',
      conflictsWarn: '有未解决的合并冲突,需要先解决才能继续。',
      sectionChanges: '改动文件',
      changeStaged: '已暂存',
      changeUnstaged: '未暂存',
      changeUntracked: '未跟踪',
      changeConflict: '冲突',
      changesTruncated: (shown, total) => `只显示前 ${shown} 项,共 ${total} 项`,
      noChanges: '工作区干净,没有改动文件',
      sectionStash: 'Stash',
      stashEmpty: '没有 stash',
      sectionAhead: '领先上游的提交',
      openOnGithub: '在 GitHub 打开',
      viewDiff: '查看 diff',
      hideDiff: '收起 diff',
      diffLoading: '正在读取 diff…',
      diffFailed: '读取 diff 失败',
      diffEmpty: '这个文件没有可显示的 diff',
      diffTruncated: '改动文件太多,这个文件超出了面板列出的范围,没有可显示的 diff',
      copy: '复制',
      copied: '已复制',
      copyFailed: '复制失败,请手动选中',
      lastCommit: (when, subject) => `${when} · ${subject}`,
    }

    const en = {
      tab: 'Git',
      panel: 'Git',
      back: 'Back',
      title: 'Git overview',
      subtitle: 'Branches, changes, PRs and issues of the current workspace (read-only).',
      refresh: 'Refresh',
      loading: 'Reading repository…',
      emptyTitle: 'Not a git project',
      emptyBody: 'No .git repository was found in the current workspace. Open a workspace that is a git project and branches, changes, PRs and issues will appear here.',
      fetchFailed: 'Failed to load',
      retry: 'Retry',
      sectionRepo: 'Repository',
      detached: 'detached HEAD',
      dirty: 'Uncommitted changes',
      untracked: 'Untracked',
      changed: 'Tracked changes',
      stashes: 'stashes',
      aheadBehind: (a, b) => `${a} ahead / ${b} behind`,
      clean: 'Working tree clean',
      sectionBranches: 'Branches',
      branchGone: 'upstream gone',
      branchCurrent: 'current',
      branchRemote: 'remote',
      branchNoUpstream: 'no upstream',
      noBranches: 'No branch info',
      sectionPrs: 'Open PRs',
      prDraft: 'draft',
      prBlocked: 'conflicts',
      prsMergedNote: 'Recently merged (local branches may be cleanable)',
      noPrs: 'No open PRs',
      sectionIssues: 'Issues',
      noIssues: 'No open issues',
      ghHintNotInstalled: 'gh CLI not found. Install it and run `gh auth login` to see PRs and issues here.',
      ghHintNotLoggedIn: 'gh CLI is installed but not logged in. Run `gh auth login` to see PRs and issues here.',
      ghHintFailed: 'gh query failed; PRs / issues unavailable.',
      ghHintNoRemote: 'This repository has no remote configured, so there are no PRs or issues to query.',
      ghHintNotGithub: 'The remote is not GitHub, so GitHub-style PR / issue queries do not apply.',
      ghSource: (src) => `authenticated via ${src}`,
      conflicts: 'conflicts',
      conflictsWarn: 'Unresolved merge conflicts — resolve them before continuing.',
      sectionChanges: 'Changed files',
      changeStaged: 'staged',
      changeUnstaged: 'unstaged',
      changeUntracked: 'untracked',
      changeConflict: 'conflict',
      changesTruncated: (shown, total) => `Showing the first ${shown} of ${total}`,
      noChanges: 'Working tree clean — no changed files',
      sectionStash: 'Stash',
      stashEmpty: 'No stashes',
      sectionAhead: 'Commits ahead of upstream',
      openOnGithub: 'Open on GitHub',
      viewDiff: 'View diff',
      hideDiff: 'Hide diff',
      diffLoading: 'Loading diff…',
      diffFailed: 'Failed to load diff',
      diffEmpty: 'No diff to show for this file',
      diffTruncated: 'Too many changed files — this one is past the list the panel shows',
      copy: 'Copy',
      copied: 'Copied',
      copyFailed: 'Copy failed — select it manually',
      lastCommit: (when, subject) => `${when} · ${subject}`,
    }
// PART 2 — styles + primitives
    // ---- inline styles (Apple grouped list, same family as dsh-inventory) ----
    const S = {
      page: { padding: '20px 20px 48px', maxWidth: 720, margin: '0 auto' },
      title: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: '4px 0 2px' },
      subtitle: { fontSize: 13, opacity: 0.6, marginBottom: 16 },
      toolbar: { display: 'flex', justifyContent: 'flex-end', marginBottom: 12 },
      ghostBtn: {
        fontSize: 13, padding: '6px 14px', borderRadius: 999,
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
        background: 'transparent', cursor: 'pointer', color: 'inherit',
      },
      card: {
        background: 'var(--dsw-alias-bg-layer-2, rgba(128,128,128,0.08))', borderRadius: 14,
        padding: '4px 16px', marginBottom: 16,
      },
      cardTitle: { fontSize: 13, fontWeight: 600, opacity: 0.55, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '12px 2px 4px' },
      row: { display: 'flex', alignItems: 'center', gap: 10, minHeight: 44, padding: '8px 2px', borderTop: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.18))' },
      rowFirst: { borderTop: 'none' },
      rowMain: { flex: '1 1 auto', minWidth: 0 },
      rowTitle: { fontSize: 15, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      rowSub: { fontSize: 12, opacity: 0.55, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      badge: { fontSize: 11, padding: '2px 8px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))', opacity: 0.75, flex: '0 0 auto' },
      badgeAccent: { fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(88,140,255,0.18)', flex: '0 0 auto' },
      badgeWarn: { fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(255,159,10,0.2)', flex: '0 0 auto' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 },
      empty: { textAlign: 'center', padding: '64px 24px' },
      emptyTitle: { fontSize: 20, fontWeight: 600, marginBottom: 8 },
      emptyBody: { fontSize: 14, opacity: 0.6, maxWidth: 420, margin: '0 auto', lineHeight: 1.5 },
      hint: { fontSize: 13, opacity: 0.65, padding: '12px 2px' },
      link: { color: 'var(--dsw-alias-button-info-fill, #588cff)', textDecoration: 'none', fontSize: 13 },
      // issue #22: interactive affordances (open on GitHub, copy, diff).
      iconBtn: {
        fontSize: 12, padding: '3px 9px', borderRadius: 8, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
        background: 'transparent', color: 'inherit', opacity: 0.8, flex: '0 0 auto',
        textDecoration: 'none', lineHeight: '18px',
      },
      iconBtnOn: {
        fontSize: 12, padding: '3px 9px', borderRadius: 8, cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.3))',
        background: 'rgba(88,140,255,0.16)', color: 'inherit', flex: '0 0 auto',
        lineHeight: '18px',
      },
      warnBanner: {
        fontSize: 13, padding: '10px 12px', margin: '8px 0 12px', borderRadius: 10,
        background: 'rgba(255,159,10,0.16)', border: '1px solid rgba(255,159,10,0.35)',
      },
      diffBox: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
        lineHeight: '18px', whiteSpace: 'pre', overflow: 'auto', maxHeight: 360,
        background: 'rgba(128,128,128,0.10)', borderRadius: 10, padding: '8px 10px',
        margin: '4px 0 8px',
      },
      diffAdd: { color: 'var(--dsw-alias-state-success-primary, #2f9e5f)' },
      diffDel: { color: 'var(--dsw-alias-state-error-primary, #d1495b)' },
      diffMeta: { opacity: 0.55 },
    }

    function Badge({ text, tone }) {
      if (!text) return null
      const style = tone === 'accent' ? S.badgeAccent : tone === 'warn' ? S.badgeWarn : S.badge
      return h('span', { style }, text)
    }

    /**
     * One grouped-list row. `titleNode` lets a caller swap the plain title for
     * something interactive (a copyable hash, a branch name) without losing
     * the row layout.
     */
    function Row({ first, title, titleNode, sub, badges, right, mono }) {
      const titleElement = titleNode ?? h('div', { style: { ...S.rowTitle, ...(mono ? S.mono : {}) } }, title)
      return h(
        'div',
        { style: { ...S.row, ...(first ? S.rowFirst : {}) } },
        h(
          'div',
          { style: S.rowMain },
          titleElement,
          sub ? h('div', { style: S.rowSub }, sub) : null,
        ),
        ...(badges ?? []).map((b) => h(Badge, { key: `badge-${b.text}`, text: b.text, tone: b.tone })),
        right ?? null,
      )
    }

    /** `owner/repo` when known, then the workspace and its subdirectory. */
    function subtitleOf(snap) {
      const parts = []
      if (snap.repoSlug) parts.push(snap.repoSlug)
      parts.push(snap.workspace ?? '')
      const cwd = snap.sessionCwd
      if (typeof cwd === 'string' && typeof snap.workspace === 'string' && cwd !== snap.workspace && cwd.startsWith(snap.workspace)) {
        parts.push(cwd.slice(snap.workspace.length + 1) || '.')
      }
      return parts.filter((part) => part.length > 0).join(' · ')
    }


/**
 * Clipboard write with a fallback for browsers that refuse the async API
 * (issue #22). Returns whether the text actually reached the clipboard.
 */
function copyText(text) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      return navigator.clipboard.writeText(text).then(() => true, () => legacyCopy(text))
    }
  } catch {
    /* fall through */
  }
  return Promise.resolve(legacyCopy(text))
}

function legacyCopy(text) {
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok === true
  } catch {
    return false
  }
}

/**
 * A value the user can copy with one click (issue #22): branch names and
 * commit hashes were previously plain, unselectable-looking text.
 */
function Copyable({ t, value, mono = true, children }) {
  const [state, setState] = React.useState('idle')
  const onCopy = React.useCallback(() => {
    copyText(value).then((ok) => {
      setState(ok ? 'done' : 'failed')
      window.setTimeout(() => setState('idle'), 1500)
    })
  }, [value])
  const label = state === 'done' ? t('copied') : state === 'failed' ? t('copyFailed') : t('copy')
  return h(
    'span',
    { style: { display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 } },
    h('span', { style: mono ? { ...S.rowTitle, ...S.mono } : S.rowTitle }, children ?? value),
    h(
      'button',
      {
        type: 'button', onClick: onCopy, style: S.iconBtn,
        title: `${t('copy')}: ${value}`, 'aria-label': `${t('copy')} ${value}`,
      },
      label,
    ),
  )
}

/** Deep link to GitHub for a repo + optional path suffix (issue #22). */
function githubUrlFor(slug, suffix) {
  if (typeof slug !== 'string' || slug.length === 0) return null
  const tail = typeof suffix === 'string' && suffix.length > 0 ? `/${suffix.replace(/^\/+/, '')}` : ''
  return `https://github.com/${slug}${tail}`
}

function GithubLink({ slug, suffix, t }) {
  const url = githubUrlFor(slug, suffix)
  if (url === null) return null
  return h(
    'a',
    { href: url, target: '_blank', rel: 'noreferrer', style: S.iconBtn, title: t('openOnGithub') },
    '↗',
  )
}

/**
 * Render a remote URL without its credentials. The host already strips them,
 * but the panel is the last place a token could reach the screen (a snapshot
 * from an older build, a hand-made payload), so it strips again.
 */
function maskRemoteUrl(url) {
  if (typeof url !== 'string' || url.length === 0) return url
  return url
    .replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, '$1***@')
    .replace(/^([^/:\s]+):[^/@\s]+@([^/:\s]+:)/, '$1@$2')
}

/**
 * Read-only diff preview for one changed path (issue #22). Fetches the host's
 * `/git-status/diff` route lazily — only when the row is expanded — so opening
 * the panel never reads file contents the user did not ask for.
 */
function DiffView({ t, sessionId, path, statusSha }) {
  const [state, setState] = React.useState({ status: 'loading', diff: '', truncated: false })
  React.useEffect(() => {
    let alive = true
    setState({ status: 'loading', diff: '', truncated: false })
    const query = [`path=${encodeURIComponent(path)}`]
    if (sessionId) query.push(`sessionId=${encodeURIComponent(sessionId)}`)
    // The host only answers for a path that is in the changed-file list this
    // panel rendered; the hash proves both sides describe the same list.
    if (statusSha) query.push(`statusSha=${encodeURIComponent(statusSha)}`)
    fetch(`${DIFF_ROUTE}?${query.join('&')}`, { method: 'GET' })
      .then(async (res) => {
        if (res.ok) return res.json()
        // A 404 is not a failure: it names WHY this path has nothing to show
        // (reverted, resolved, stale list, or past the change-list cap).
        if (res.status === 404) {
          const body = await res.json().catch(() => ({}))
          return { diff: '', truncated: false, reason: body?.reason ?? 'not-changed' }
        }
        throw new Error(`HTTP ${res.status}`)
      })
      .then((body) => {
        if (!alive) return
        setState({
          status: 'ready',
          diff: body?.diff ?? '',
          truncated: body?.truncated === true,
          reason: body?.reason ?? null,
        })
      })
      .catch((e) => {
        if (alive) setState({ status: 'error', diff: String(e?.message ?? e), truncated: false })
      })
    return () => { alive = false }
  }, [sessionId, path, statusSha])

  if (state.status === 'loading') return h('div', { style: S.hint }, t('diffLoading'))
  if (state.status === 'error') return h('div', { style: S.hint }, `${t('diffFailed')}: ${state.diff}`)
  if (state.diff.length === 0) {
    // "No diff" and "this file is past the change-list cap" are different
    // answers for the user, and the host knows which one it gave.
    return h('div', { style: S.hint }, state.reason === 'truncated' ? t('diffTruncated') : t('diffEmpty'))
  }
  const lines = state.diff.split('\n').map((line, i) => {
    const tone =
      line.startsWith('+++') || line.startsWith('---') ? S.diffMeta
        : line.startsWith('+') ? S.diffAdd
          : line.startsWith('-') ? S.diffDel
            : line.startsWith('@@') ? S.diffMeta : null
    return h('div', { key: i, style: tone ?? undefined }, line.length > 0 ? line : ' ')
  })
  return h(
    'div',
    { style: S.diffBox },
    lines,
    state.truncated ? h('div', { style: S.diffMeta }, '…') : null,
  )
}

    function Card({ title, children }) {
      return h('div', { style: S.card }, title ? h('div', { style: S.cardTitle }, title) : null, children)
    }

    const FORGE_HINT_KEYS = {
      'not-installed': 'ghHintNotInstalled',
      'not-logged-in': 'ghHintNotLoggedIn',
      'no-remote': 'ghHintNoRemote',
      'not-github': 'ghHintNotGithub',
    }

    /**
     * Why the PR / issue cards are empty. The host reports a named reason
     * (`forgeHint`); a bare null PR list still means the query itself failed.
     */
    function ghHintText(t, snap) {
      const key = FORGE_HINT_KEYS[snap?.forgeHint]
      if (key !== undefined) return t(key)
      if (snap?.prs === null || snap?.issues === null) return t('ghHintFailed')
      return null
    }
// PART 3 — cards
    function RepoCard({ t, snap, sessionId }) {
      const status = snap.git?.status ?? {}
      const rows = []
      const branchName = status.detached ? t('detached') : status.branch ?? '—'
      const currentBranch = (snap.git?.branches ?? []).find((b) => b.current)
      const ab =
        currentBranch && (currentBranch.ahead > 0 || currentBranch.behind > 0)
          ? t('aheadBehind')(currentBranch.ahead ?? 0, currentBranch.behind ?? 0)
          : null
      const conflictCount = status.conflicts ?? 0
      rows.push(
        h(Row, {
          key: 'branch', first: true, mono: false, title: null,
          right: h(
            'span',
            { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
            h(GithubLink, { slug: snap.repoSlug, suffix: branchName, t }),
          ),
          titleNode: status.detached
            ? h('div', { style: S.rowTitle }, branchName)
            : h(Copyable, { t, value: status.branch ?? branchName }),
          sub: ab,
          // One badge, one fact: the conflict count and the dirty count each
          // render once here (the "未提交改动" row below breaks dirty further
          // down), so no digit appears twice in a row.
          badges: [
            ...(conflictCount > 0 ? [{ text: `${t('conflicts')} ${conflictCount}`, tone: 'warn' }] : []),
            ...(status.dirty > 0 ? [{ text: `${t('dirty')} ${status.dirty}`, tone: 'warn' }] : []),
          ],
        }),
      )
      rows.push(
        h(Row, {
          key: 'dirty', title: t('dirty'),
          sub:
            status.dirty === 0
              ? t('clean')
              : `${t('changed')}: ${status.changed ?? 0} · ${t('untracked')}: ${status.untracked ?? 0}`
                + (conflictCount > 0 ? ` · ${t('conflicts')}: ${conflictCount}` : ''),
        }),
      )
      for (const c of (snap.git?.commits ?? []).slice(0, 5)) {
        rows.push(
          h(Row, {
            key: c.hash, title: null,
            titleNode: h(Copyable, { t, value: c.hash, children: c.subject }),
            sub: `${c.author} · ${c.date}`,
            right: h(GithubLink, { slug: snap.repoSlug, suffix: `commit/${c.fullHash ?? c.hash}`, t }),
          }),
        )
      }
      for (const r of snap.git?.remotes ?? []) {
        rows.push(h(Row, { key: `r-${r.name}`, title: r.name, sub: maskRemoteUrl(r.url), mono: true }))
      }
      return h(
        Card,
        { title: t('sectionRepo') },
        conflictCount > 0 ? h('div', { style: S.warnBanner }, t('conflictsWarn')) : null,
        rows,
      )
    }

    function BranchCard({ t, snap }) {
      const branches = snap.git?.branches ?? []
      const local = branches.filter((b) => !b.remote)
      const remote = branches.filter((b) => b.remote)
      if (local.length === 0 && remote.length === 0) {
        return h(Card, { title: t('sectionBranches') }, h('div', { style: S.hint }, t('noBranches')))
      }
      const rows = []
      for (const b of local) {
        // issue #20: the tip commit answers "when did this branch last move?"
        const tip =
          b.lastCommitDate && b.lastCommitSubject
            ? t('lastCommit')(b.lastCommitDate, b.lastCommitSubject)
            : null
        // A tracked branch with an upstream that happens to be neither ahead
        // nor behind used to fall through to "no upstream" — the two facts are
        // independent: `upstream === null` alone means unset.
        const ab = b.ahead > 0 || b.behind > 0 ? t('aheadBehind')(b.ahead ?? 0, b.behind ?? 0) : null
        const upstream = b.upstream === null || b.upstream === undefined ? t('branchNoUpstream') : b.upstream
        rows.push(
          h(Row, {
            key: b.name, first: rows.length === 0, mono: true, title: null,
            titleNode: h(
              'span',
              { style: { display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 } },
              h(Copyable, { t, value: b.name }),
              b.current ? h(Badge, { text: t('branchCurrent'), tone: 'accent' }) : null,
            ),
            sub: [ab, tip ?? upstream].filter(Boolean).join(' · '),
            badges: b.gone ? [{ text: t('branchGone'), tone: 'warn' }] : [],
            right: h(GithubLink, { slug: snap.repoSlug, suffix: `tree/${encodeURIComponent(b.name)}`, t }),
          }),
        )
      }
      for (const b of remote.slice(0, 12)) {
        rows.push(
          h(Row, {
            key: b.name, first: rows.length === 0, mono: true, title: null,
            titleNode: h(Copyable, { t, value: b.name }),
            sub: b.lastCommitSubject ? t('lastCommit')(b.lastCommitDate ?? '', b.lastCommitSubject) : null,
            badges: [{ text: t('branchRemote') }],
          }),
        )
      }
      return h(Card, { title: t('sectionBranches') }, rows)
    }

    /** Group heading inside the changed-files card (issue #18). */
    function ChangeGroup({ t, title, entries, sessionId, statusSha }) {
      if (entries.length === 0) return null
      return h(
        'div',
        null,
        h('div', { style: { ...S.cardTitle, textTransform: 'none', letterSpacing: 0 } }, `${title} · ${entries.length}`),
        entries.map((c) =>
          h(ChangeRow, { key: `${c.kind}-${c.path}`, t, change: c, sessionId }),
        ),
      )
    }

    /**
     * One changed path: click to expand its read-only diff (issue #22), with
     * the GitHub link for the file when the repo slug is known.
     */
    function ChangeRow({ t, change, sessionId, statusSha }) {
      const [open, setOpen] = React.useState(false)
      const label = change.origPath ? `${change.origPath} → ${change.path}` : change.path
      return h(
        'div',
        null,
        h(
          'div',
          { style: { ...S.row, cursor: 'pointer' }, onClick: () => setOpen((v) => !v) },
          h(
            'div',
            { style: S.rowMain },
            h('div', { style: { ...S.rowTitle, ...S.mono } }, label),
            h('div', { style: S.rowSub }, `${change.index}${change.worktree}`),
          ),
          h('span', { style: S.iconBtn }, open ? t('hideDiff') : t('viewDiff')),
        ),
        open ? h(DiffView, { t, sessionId, path: change.path, statusSha }) : null,
      )
    }

    /** issue #18: a dirty count is not a file list — this is the file list. */
    function ChangesCard({ t, snap, sessionId }) {
      const status = snap.git?.status ?? {}
      const changes = status.changes ?? []
      const statusSha = snap.git?.statusSha
      if (changes.length === 0) {
        return h(Card, { title: t('sectionChanges') }, h('div', { style: S.hint }, t('noChanges')))
      }
      const conflicts = changes.filter((c) => c.kind === 'conflict')
      const staged = changes.filter((c) => c.kind === 'staged')
      const unstaged = changes.filter((c) => c.kind === 'unstaged')
      const untracked = changes.filter((c) => c.kind === 'untracked')
      return h(
        Card,
        { title: t('sectionChanges') },
        h(ChangeGroup, { t, title: t('changeConflict'), entries: conflicts, sessionId, statusSha }),
        h(ChangeGroup, { t, title: t('changeStaged'), entries: staged, sessionId, statusSha }),
        h(ChangeGroup, { t, title: t('changeUnstaged'), entries: unstaged, sessionId, statusSha }),
        h(ChangeGroup, { t, title: t('changeUntracked'), entries: untracked, sessionId, statusSha }),
        status.changesTruncated
          ? h('div', { style: S.hint }, t('changesTruncated')(changes.length, status.changesTotal ?? changes.length))
          : null,
      )
    }

    /** issue #20: stash rows with what each one holds, not just a count. */
    function StashCard({ t, snap }) {
      const list = snap.git?.stashList ?? []
      const count = snap.git?.stashes ?? 0
      if (count === 0) return h(Card, { title: t('sectionStash') }, h('div', { style: S.hint }, t('stashEmpty')))
      const rows = list.map((s, i) =>
        h(Row, {
          key: s.ref ?? i, first: i === 0, mono: true,
          titleNode: h(Copyable, { t, value: s.ref }),
          sub: [s.when, s.subject].filter(Boolean).join(' · '),
        }),
      )
      if (count > list.length) rows.push(h('div', { style: S.hint }, `${list.length} / ${count}`))
      return h(Card, { title: t('sectionStash') }, rows)
    }

    /** issue #20: *which* commits am I ahead by? */
    function AheadCard({ t, snap }) {
      const ahead = snap.git?.aheadCommits ?? []
      if (ahead.length === 0) return null
      return h(
        Card,
        { title: t('sectionAhead') },
        ahead.map((c, i) =>
          h(Row, {
            key: c.fullHash ?? c.hash ?? i, first: i === 0,
            titleNode: h(Copyable, { t, value: c.hash, children: c.subject }),
            right: h(GithubLink, { slug: snap.repoSlug, suffix: `commit/${c.fullHash ?? c.hash}`, t }),
          }),
        ),
      )
    }

    function PrCard({ t, snap }) {
      const hint = ghHintText(t, snap)
      if (hint) return h(Card, { title: t('sectionPrs') }, h('div', { style: S.hint }, hint))
      const source = typeof snap.gh?.source === 'string' && snap.gh.source.length > 0 ? t('ghSource')(snap.gh.source) : null
      const prs = snap.prs ?? []
      if (prs.length === 0) return h(Card, { title: t('sectionPrs') }, h('div', { style: S.hint }, t('noPrs')))
      const rows = source ? [h('div', { key: 'gh-source', style: { ...S.hint, padding: '8px 2px 0' } }, source)] : []
      for (const pr of prs) {
        const i = prs.indexOf(pr)
        rows.push(
        h(Row, {
          key: pr.number ?? i, first: i === 0, title: `#${pr.number} ${pr.title}`,
          sub: `${pr.headRefName} → ${pr.baseRefName} · ${pr.author?.login ?? ''}`,
          badges: [
            ...(pr.isDraft ? [{ text: t('prDraft') }] : []),
            ...(pr.mergeable === 'CONFLICTING' ? [{ text: t('prBlocked'), tone: 'warn' }] : []),
          ],
          right: pr.url ? h('a', { href: pr.url, target: '_blank', rel: 'noreferrer', style: S.link }, '↗') : null,
        }),
        )
      }
      for (const pr of (snap.mergedPrs ?? []).slice(0, 5)) {
        rows.push(
          h(Row, {
            key: `m-${pr.number}`, title: `#${pr.number} ${pr.title}`, sub: `${pr.headRefName} · ${pr.mergedAt ?? ''}`,
            badges: [{ text: t('prsMergedNote') }],
            right: pr.url ? h('a', { href: pr.url, target: '_blank', rel: 'noreferrer', style: S.link }, '↗') : null,
          }),
        )
      }
      return h(Card, { title: t('sectionPrs') }, rows)
    }

    function IssueCard({ t, snap }) {
      const hint = ghHintText(t, snap)
      if (hint) return h(Card, { title: t('sectionIssues') }, h('div', { style: S.hint }, hint))
      const issues = snap.issues ?? []
      if (issues.length === 0) return h(Card, { title: t('sectionIssues') }, h('div', { style: S.hint }, t('noIssues')))
      return h(
        Card,
        { title: t('sectionIssues') },
        issues.map((it, i) =>
          h(Row, {
            key: it.number ?? i, first: i === 0, title: `#${it.number} ${it.title}`,
            sub: it.author?.login ?? '',
            right: it.url ? h('a', { href: it.url, target: '_blank', rel: 'noreferrer', style: S.link }, '↗') : null,
          }),
        ),
      )
    }
// PART 4 — panel, sidebar icon, apply
    /**
     * The Session the shell currently shows in the Conversation: the row the
     * main view retains (the same fact the window title reads). Absent while
     * the user is browsing panels instead of a conversation.
     */
    function retainedSessionId(ctx) {
      try {
        const state = ctx.get('sessions')?.list?.getSnapshot?.()
        const rows = state?.byId ?? {}
        for (const row of Object.values(rows)) {
          if (typeof row?.retainedBy?.mainView === 'number' && row.retainedBy.mainView > 0) {
            return typeof row.id === 'string' ? row.id : ''
          }
        }
      } catch {
        /* no Session list on this client */
      }
      return ''
    }

    function GitPanel({ t, sessionId: boundSessionId, initialSnap }) {
      const [snap, setSnap] = React.useState(initialSnap ?? null)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const sessionId = typeof boundSessionId === 'string' ? boundSessionId : ''

      const load = React.useCallback(async (refresh) => {
        setLoading(true)
        setError(null)
        try {
          const query = []
          if (refresh) query.push('refresh=1')
          if (sessionId.length > 0) query.push(`sessionId=${encodeURIComponent(sessionId)}`)
          const suffix = query.length > 0 ? `?${query.join('&')}` : ''
          const res = await fetch(`${ROUTE}${suffix}`, { method: 'GET' })
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          setSnap(await res.json())
        } catch (e) {
          setError(String(e?.message ?? e))
        } finally {
          setLoading(false)
        }
      }, [sessionId])

      React.useEffect(() => {
        // A host-supplied first snapshot (tests, and a future server-rendered
        // first paint) skips the initial round trip.
        if (initialSnap) {
          setLoading(false)
          return
        }
        load(false)
      }, [load])

      if (loading && snap === null && error === null) {
        return h('div', { style: S.page }, h('div', { style: S.empty }, t('loading')))
      }
      if (error !== null) {
        return h(
          'div', { style: S.page },
          h('div', { style: S.empty },
            h('div', { style: S.emptyTitle }, `${t('fetchFailed')}: ${error}`),
            h('button', { type: 'button', style: S.ghostBtn, onClick: () => load(true) }, t('retry')),
          ),
        )
      }
      if (!snap?.isGit) {
        return h(
          'div', { style: S.page },
          h('div', { style: S.empty },
            h('div', { style: S.emptyTitle }, t('emptyTitle')),
            h('div', { style: S.emptyBody }, t('emptyBody')),
          ),
        )
      }
      return h(
        'div',
        { style: S.page },
        h('div', { style: S.title }, t('title')),
        h('div', { style: S.subtitle }, subtitleOf(snap)),
        h('div', { style: S.toolbar },
          h('button', { type: 'button', style: S.ghostBtn, disabled: loading, onClick: () => load(true) }, t('refresh')),
        ),
        h(RepoCard, { t, snap, sessionId }),
        h(ChangesCard, { t, snap, sessionId }),
        h(AheadCard, { t, snap }),
        h(StashCard, { t, snap }),
        h(BranchCard, { t, snap }),
        h(PrCard, { t, snap }),
        h(IssueCard, { t, snap }),
      )
    }

    function SidebarIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true', focusable: 'false' },
        h('circle', { cx: 6, cy: 6, r: 2.2, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('circle', { cx: 6, cy: 18, r: 2.2, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('circle', { cx: 18, cy: 12, r: 2.2, stroke: 'currentColor', strokeWidth: 1.7 }),
        h('path', { d: 'M6 8.2v7.6M8.2 6h5.3a2 2 0 0 1 2 2v1.8', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-git-status: dictionaries')
      const t = ctx.locale.bind(NS)

      // Sidebar entry and main panel share the same id/key (same contract as
      // the dsh-inventory sidebar panel).
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'git-status',
            order: 21,
            label: () => t('panel'),
            locale: NS,
          },
          SidebarIcon,
        ),
      )
      ctx.slots.inject('main', () =>
        ctx.slots.register(
          {
            name: 'main',
            key: 'git-status',
            locale: NS,
            // `sessionId` decides which workspace the host reports: that
            // Session's header cwd is the repo, never the directory the web
            // process was launched from. The keyed main scope never carries one,
            // so fall back to the Session the Conversation is currently showing.
            inject: (props) => ({
              t,
              back: () => ctx.layout.selectPanel(null),
              sessionId:
                typeof props?.sessionId === 'string' && props.sessionId.length > 0
                  ? props.sessionId
                  : retainedSessionId(ctx),
            }),
          },
          GitPanel,
        ),
      )
    }

    return {
      name: 'dsh-git-status',
      inject: ['slots', 'locale', 'layout'],
      apply,
    }
  },
})
