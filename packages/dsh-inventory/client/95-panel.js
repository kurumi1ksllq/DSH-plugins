
    function InventoryPanel({ t, back }) {
      const [status, setStatus] = React.useState('loading')
      const [data, setData] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [wsQuery, setWsQuery] = React.useState('')
      // Official DSH bundles are noise for "what did I install"; hidden until
      // this switch is on.
      const [showOfficial, setShowOfficial] = React.useState(false)
      const [open, setOpen] = React.useState({
        packages: true,
        mcp: true,
        skills: false,
      })
      const [expanded, setExpanded] = React.useState({})
      // Navigation: 'global' is the tool overview, 'workspaces' the list,
      // 'workspace' the detail of `currentWorkspace` (a workspace id), 'sync'
      // the cross-machine manifest, and the last two the live settings that used
      // to have their own sidebar entries (web-search providers, prompt text).
      const [view, setView] = React.useState('global')
      // Live sections keep the panel's open-on-load default (packages on, the
      // long lists folded), because their data is not in the snapshot.
      const [providersOpen, setProvidersOpen] = React.useState(true)
      const [promptOpen, setPromptOpen] = React.useState(false)
      const [credentialsOpen, setCredentialsOpen] = React.useState(false)
      const [currentWorkspace, setCurrentWorkspace] = React.useState('')
      const [wsBusy, setWsBusy] = React.useState('')
      const [wsError, setWsError] = React.useState('')
      // Global (whole-installation) switch state: `globalBusy` is `kind|name`
      // for the row in flight, so only that row shows a spinner while every
      // switch stays disabled.
      const [globalBusy, setGlobalBusy] = React.useState('')
      const [globalError, setGlobalError] = React.useState('')
      const [globalNotice, setGlobalNotice] = React.useState('')
      // Vault moves: `vaultBusy` is `action|name` (or just `action` for in-all).
      const [vaultBusy, setVaultBusy] = React.useState('')
      const [vaultError, setVaultError] = React.useState('')
      const [detailOpen, setDetailOpen] = React.useState({ mcp: true, skills: true })
      // Skills hidden one by one from the list (by name, shared by every page and
      // remembered). `showHiddenSkills` is session-only: it reveals them so they
      // can be un-hidden again.
      const [hiddenSkills, setHiddenSkills] = React.useState(readHiddenSkills())
      const [showHiddenSkills, setShowHiddenSkills] = React.useState(false)
      // Apple's large-title pattern: the toolbar title only appears once the
      // large title has scrolled away. Threshold crossing only, so scrolling
      // does not re-render the panel.
      const [scrolled, setScrolled] = React.useState(false)

      const load = React.useCallback(async (force) => {
        setStatus('loading')
        setMessage('')
        try {
          // The host keeps a 15s cache; only an explicit refresh pays the cost
          // of rescanning plugin packages and session logs.
          const response = await fetch(force === true ? `${ROUTE}?refresh=1` : ROUTE, {
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const payload = await response.json()
          setData(payload)
          setStatus('ready')
        } catch (error) {
          setMessage(error && error.message ? error.message : String(error))
          setStatus('error')
        }
      }, [])

      /**
       * Assign/remove one server or skill in one workspace. The host answers
       * `{ ok: true }` on success (and drops its snapshot cache, hence the
       * forced reload) or `{ ok: false, error }` with a display-ready message.
       */
      const runWorkspaceAction = React.useCallback(
        async ({ workspace, kind, action, name }) => {
          setWsBusy(`${workspace?.path ?? ''}|${kind}|${action}|${name}`)
          setWsError('')
          try {
            const response = await fetch(WORKSPACE_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ workspace: workspace?.path, kind, action, name }),
            })
            if (!response.ok) {
              let detail = ''
              try {
                const payload = await response.json()
                if (payload && typeof payload.error === 'string' && payload.error.length > 0) detail = payload.error
              } catch {
                // A non-JSON error body still has a status worth showing.
                detail = ''
              }
              throw new Error(detail.length > 0 ? detail : `HTTP ${response.status}`)
            }
            await load(true)
          } catch (error) {
            setWsError(error && error.message ? error.message : String(error))
          } finally {
            setWsBusy('')
          }
        },
        [load],
      )

      /**
       * Switch one MCP server or skill for the whole installation. The host
       * answers `{ ok, changed, live }`: `live: false` means the change landed in
       * cordis.patch.yml and only applies on the next start, so the panel says so
       * instead of pretending the running process already changed.
       */
      const runGlobalAction = React.useCallback(
        async ({ kind, name, enabled }) => {
          setGlobalBusy(`${kind}|${name}`)
          setGlobalError('')
          setGlobalNotice('')
          try {
            const response = await fetch(GLOBAL_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ kind, name, enabled }),
            })
            if (!response.ok) {
              let detail = ''
              try {
                const payload = await response.json()
                if (payload && typeof payload.error === 'string' && payload.error.length > 0) detail = payload.error
              } catch {
                // A non-JSON error body still has a status worth showing.
                detail = ''
              }
              throw new Error(detail.length > 0 ? detail : `HTTP ${response.status}`)
            }
            let live = true
            try {
              const payload = await response.json()
              if (payload && payload.live === false) live = false
            } catch {
              // No body: the write itself succeeded, treat it as live.
              live = true
            }
            await load(true)
            if (!live) setGlobalNotice(t('restartNeeded'))
          } catch (error) {
            setGlobalError(error && error.message ? error.message : String(error))
          } finally {
            setGlobalBusy('')
          }
        },
        [load, t],
      )

      /**
       * Move skills between the global root and the vault. The host answers
       * `{ ok, moved, skipped }`; `moved` is what the notice counts, and the
       * snapshot is reloaded because the skill list changed on disk.
       */
      const runVaultAction = React.useCallback(
        async ({ action, name }) => {
          setVaultBusy(typeof name === 'string' && name.length > 0 ? `${action}|${name}` : action)
          setVaultError('')
          setGlobalNotice('')
          try {
            const response = await fetch(VAULT_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify(typeof name === 'string' && name.length > 0 ? { action, name } : { action }),
            })
            if (!response.ok) {
              let detail = ''
              try {
                const payload = await response.json()
                if (payload && typeof payload.error === 'string' && payload.error.length > 0) detail = payload.error
              } catch {
                // A non-JSON error body still has a status worth showing.
                detail = ''
              }
              throw new Error(detail.length > 0 ? detail : `HTTP ${response.status}`)
            }
            let moved = 0
            try {
              const payload = await response.json()
              if (payload && Array.isArray(payload.moved)) moved = payload.moved.length
            } catch {
              moved = 0
            }
            await load(true)
            if (moved > 0) setGlobalNotice(t('vaultDone').replace('{count}', String(moved)))
          } catch (error) {
            setVaultError(error && error.message ? error.message : String(error))
          } finally {
            setVaultBusy('')
          }
        },
        [load, t],
      )

      React.useEffect(() => installStyles(), [])
      React.useEffect(() => {
        load(false)
      }, [load])

      const q = query.trim().toLowerCase()
      const toggle = (key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))
      const toggleDetail = (key) => setDetailOpen((prev) => ({ ...prev, [key]: !prev[key] }))
      const toggleItem = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
      const setSkillHidden = (name, hidden) => {
        const next = hidden === true ? [...hiddenSkills.filter((entry) => entry !== name), name] : hiddenSkills.filter((entry) => entry !== name)
        setHiddenSkills(next)
        writeHiddenSkills(next)
      }

      const backToChat =
        typeof back === 'function'
          ? h(
              'button',
              { type: 'button', style: S.back, className: 'inv-btn', onClick: () => back() },
              h(Icon, { name: 'chevronLeft', size: 18 }),
              t('back'),
            )
          : null

      // One shell for every state (issue #179): the rail and the scroll host
      // must be in the first paint. Before this, loading and error rendered a
      // single column, so opening the panel jumped to two columns when the
      // snapshot landed. Counts are passed only when data exists.
      const navRailFor = (rails) =>
        h(NavRail, {
          label: t('navRailLabel'),
          active: view === 'workspace' ? 'workspaces' : view,
          onSelect: setView,
          groups: [
            {
              title: t('navGroupOverview'),
              items: [
                { key: 'global', label: t('wsOverview'), count: rails?.overview },
                { key: 'workspaces', label: t('wsWorkspaces'), count: rails?.workspaces },
              ],
            },
            {
              title: t('navGroupConfig'),
              items: [
                { key: 'sync', label: t('syncView') },
                { key: 'providers', label: t('providerSection') },
                { key: 'prompt', label: t('promptSection') },
                { key: 'credentials', label: t('credentialSection') },
              ],
            },
          ],
        })

      const shell = (navNode, children, rails) =>
        h(
          'div',
          { style: S.root },
          navNode,
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'row', flex: '1 1 auto', minHeight: 0, alignItems: 'stretch' } },
            navRailFor(rails),
            h(
              'div',
              {
                // The scroll host: the rail stays put while the main column
                // scrolls under the sticky nav.
                className: 'inv-scroll',
                style: S.scrollHost,
                onScroll: (event) => {
                  const next = event.currentTarget.scrollTop > 24
                  if (next !== scrolled) setScrolled(next)
                },
              },
              h('div', { style: S.page }, ...children),
            ),
          ),
        )

      if (status === 'loading' && data === null) {
        return shell(
          h(
            'div',
            { style: S.nav, className: 'inv-nav' },
            backToChat,
            h('span', { className: 'inv-nav-title', style: S.navTitle, 'aria-hidden': 'true' }, t('title')),
          ),
          [
          h('div', { style: S.hero }, h('h3', { style: S.h1 }, t('title')), h('p', { style: S.subtitle }, t('loading'))),
          h(
            'div',
            { className: 'inv-card', style: { ...S.card, padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' } },
            h('div', { className: 'inv-skeleton', style: S.skeleton }),
            h('div', { className: 'inv-skeleton', style: { ...S.skeleton, width: '70%' } }),
            h('div', { className: 'inv-skeleton', style: { ...S.skeleton, width: '85%' } }),
          ),
          ],
        )
      }

      if (status === 'error' && data === null) {
        return shell(
          h(
            'div',
            { style: S.nav, className: 'inv-nav' },
            backToChat,
            h('span', { className: 'inv-nav-title', style: S.navTitle, 'aria-hidden': 'true' }, t('title')),
          ),
          [
          h('div', { style: S.hero }, h('h3', { style: S.h1 }, t('title'))),
          h(
            'div',
            { style: S.errorBox },
            h(Icon, { name: 'alert', size: 18, style: { color: C.danger } }),
            h('span', { style: { flex: '1 1 auto' } }, t('error') + (message ? ' (' + message + ')' : '')),
            h('button', { type: 'button', className: 'inv-primary', style: S.primary, onClick: () => load(true) }, t('retry')),
          ),
          ],
        )
      }

      const counts = data?.counts ?? {}
      const allPackages = data?.packages ?? []
      const packages = allPackages.filter(
        (item) => listed(item, isOfficialEntry, showOfficial) && matches(q, item, filterFor('packages')),
      )
      const mcp = sortByEnabled(
        (data?.mcp ?? []).filter((item) => matches(q, item, filterFor('mcp'))),
        (item) => item.enabled === true,
        (item) => String(item.server ?? ''),
      )
      const skills = sortByEnabled(
        (data?.skills ?? []).filter(
          (item) => !isRuntimeSkill(item) && (showHiddenSkills || !hiddenSkills.includes(item.name)) && matches(q, item, filterFor('skills')),
        ),
        (item) => item.disabled !== true,
        (item) => String(item.name ?? ''),
      )
      // An empty section that is empty *because everything in it is official*
      // needs its own message; "nothing installed" would be a lie.
      const hiddenPackages = showOfficial ? 0 : allPackages.filter(isOfficialEntry).length
      const warnings = data?.warnings ?? []
      // Capability bits: a false means the host cannot persist that kind at all,
      // so the whole section renders its switches disabled.
      const globalMcpLocked = data?.globalToggle?.mcp === false
      const globalSkillLocked = data?.globalToggle?.skill === false
      const globalBlocked = globalBusy.length > 0
      // "Move all" only makes sense while a globally registered skill is still
      // outside the vault.
      const vaultCandidates = (data?.skills ?? []).filter((item) => item.global === true && item.vaulted !== true)
      const vaultBlocked = vaultBusy.length > 0

      const workspaceList = Array.isArray(data?.workspaces) ? data.workspaces : []
      const activeWorkspace = workspaceList.find((workspace) => workspace.id === currentWorkspace) ?? null
      // A stale id (workspace removed, snapshot reloaded) falls back to the list
      // instead of rendering an empty detail page.
      const showList = view === 'workspaces' || (view === 'workspace' && activeWorkspace === null)
      const openWorkspace = (id) => {
        setCurrentWorkspace(id)
        setWsQuery('')
        setView('workspace')
      }

      // Two views read live host state (web-search providers, prompt text) and
      // no inventory snapshot: the snapshot chrome — refresh, search, stats —
      // would be noise there, and re-reading the snapshot must not remount the
      // provider list while a reorder is in flight.
      const isLiveView = view === 'providers' || view === 'prompt' || view === 'credentials'

      const nav = h(
        'div',
        { style: S.nav, className: 'inv-nav' },
        view === 'workspace'
          ? h(
              'button',
              { type: 'button', style: S.back, className: 'inv-btn', onClick: () => setView('workspaces') },
              h(Icon, { name: 'chevronLeft', size: 18 }),
              t('wsBackToList'),
            )
          : backToChat,
        h('span', {
          className: 'inv-nav-title',
          style: { ...S.navTitle, opacity: scrolled ? 1 : 0, transition: 'opacity 180ms ease' },
          'aria-hidden': 'true',
        }, view === 'workspace' && activeWorkspace ? activeWorkspace.title : t('title')),
        isLiveView
          ? null
          : h(
              'button',
              {
                type: 'button',
                style: S.iconBtn,
                className: 'inv-btn',
                'aria-label': t('refresh'),
                title: t('refresh'),
                onClick: () => load(true),
              },
              h(Icon, { name: 'refresh', size: 19 }),
            ),
      )

      const stamp = h(
        'span',
        { style: S.stamp },
        `${t('generatedAt')} ${data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '-'}`,
      )

      const officialToggle = h(
        'button',
        {
          type: 'button',
          className: showOfficial ? 'inv-seg-btn inv-chip inv-chip-on' : 'inv-seg-btn inv-chip',
          'aria-pressed': showOfficial ? 'true' : 'false',
          style: { ...S.chip, ...(showOfficial ? S.chipOn : {}) },
          title: t('officialHint'),
          onClick: () => setShowOfficial((prev) => !prev),
        },
        showOfficial ? t('hideOfficial') : t('showOfficial'),
      )

      const hiddenSkillsChip =
        hiddenSkills.length === 0
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: showHiddenSkills ? 'inv-seg-btn inv-chip inv-chip-on' : 'inv-seg-btn inv-chip',
                'aria-pressed': showHiddenSkills ? 'true' : 'false',
                style: { ...S.chip, ...(showHiddenSkills ? S.chipOn : {}) },
                title: t('hiddenSkillsHint'),
                onClick: () => setShowHiddenSkills((prev) => !prev),
              },
              `${t('showHiddenSkills')} ${hiddenSkills.length}`,
            )

      const stats = h(
        'div',
        { className: 'inv-card', style: { ...S.card, ...S.stats } },
        ...[
          [t('packages'), packages.length],
          [t('mcp'), mcp.length],
          [t('skills'), skills.length],
          [t('wsWorkspaces'), Array.isArray(data?.workspaces) ? data.workspaces.length : 0],
        ].map(([label, value]) =>
          h(
            'div',
            { key: String(label), style: S.statCell },
            h('span', { style: S.statValue }, String(value)),
            h('span', { style: S.statLabel }, label),
          ),
        ),
      )

      const searchField = (value, onChange, placeholder, label) =>
        h(
          'div',
          { style: S.searchWrap, className: 'inv-search-wrap' },
          h(Icon, { name: 'search', size: 16, style: { color: C.secondary } }),
          h('input', {
            style: S.search,
            className: 'inv-search',
            value,
            placeholder,
            'aria-label': label,
            onChange: (event) => onChange(event.target.value),
          }),
        )

      const overviewSections = [
        h(
          Section,
          { key: 'packages', t, title: t('packages'), hint: t('packagesHint'), count: packages.length, open: open.packages, onToggle: () => toggle('packages') },
          packages.length === 0
            ? [h('div', { key: 'pkg-empty', style: S.empty }, q.length > 0 ? t('emptySearch') : hiddenPackages > 0 ? t('officialHidden') : t('noPackages'))]
            : packages.map((item, index) =>
                h(
                  'div',
                  { key: `pkg-${item.name}-${index}`, style: { ...S.row, ...(index === packages.length - 1 ? S.rowLast : {}) } },
                  h(
                    'div',
                    { style: S.rowMain },
                    h('span', { style: S.rowTitleMono }, item.name),
                    item.version || item.spec ? h('span', { style: S.rowSub }, item.version ?? item.spec) : null,
                  ),
                  ...item.declaredBy.map((source) => h(Badge, { key: `d-${source}`, label: source === 'dependencies' ? t('declaresDeps') : source })),
                  item.loaded ? h(Badge, { label: t('loaded'), tone: 'success', dot: true }) : null,
                  item.orphan ? h(Badge, { label: t('orphan'), tone: 'danger', dot: true }) : null,
                  !item.loaded && !item.orphan && item.rowless === true ? h(Badge, { label: t('noRow') }) : null,
                  !item.loaded && !item.orphan && item.rowless !== true && item.fiberPhase !== null && item.fiberPhase !== undefined
                    ? h(Badge, { label: t('inactive'), tone: 'warning', dot: true })
                    : null,
                ),
              ),
        ),
        h(
          Section,
          { key: 'mcp', t, title: t('mcp'), hint: `${t('mcpHint')} · ${t('globalHint')}`, count: mcp.length, open: open.mcp, onToggle: () => toggle('mcp') },
          mcp.length === 0
            ? [h('div', { key: 'mcp-empty', style: S.empty }, q.length > 0 ? t('emptySearch') : t('noMcp'))]
            : mcp.map((item, index) => {
                const key = `mcp-${item.entryId}`
                const isOpen = expanded[key] === true
                const tone =
                  item.status === 'connected' ? 'success' : item.status === 'failed' ? 'danger' : item.status === 'disabled' ? undefined : 'warning'
                const statusLabel =
                  item.status === 'connected'
                    ? t('statusConnected')
                    : item.status === 'failed'
                      ? t('statusFailed')
                      : item.status === 'disabled'
                        ? t('disabled')
                        : t('statusNoTools')
                const toggleRow = () => toggleItem(key)
                const isOn = item.enabled === true
                const rowLocked = item.toggleable === false
                const switchable = !rowLocked && !globalMcpLocked
                return h(
                  'div',
                  { key, style: { ...S.row, ...(index === mcp.length - 1 ? S.rowLast : {}), flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
                  h(
                    'div',
                    {
                      role: 'button',
                      tabIndex: 0,
                      'aria-expanded': isOpen ? 'true' : 'false',
                      className: 'inv-row',
                      'data-interactive': 'true',
                      style: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', minWidth: 0 },
                      onClick: toggleRow,
                      onKeyDown: activate(toggleRow),
                    },
                    h('span', { className: 'inv-chev', style: { ...S.chev, transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' } }, h(Icon, { name: 'chevronDown', size: 15 })),
                    h(
                      'div',
                      { style: S.rowMain },
                      h('span', { style: S.rowTitle }, item.server),
                      item.command || item.url ? h('span', { style: S.rowMono }, item.command ?? item.url) : null,
                      isOn ? null : h('span', { style: S.rowSub }, t('registryOnlyNote')),
                    ),
                    h(Badge, { label: statusLabel, tone, dot: true }),
                    h(Badge, { label: `${item.toolCount} ${t('toolsCount')}` }),
                    item.transport ? h(Badge, { label: item.transport }) : null,
                    item.source && item.source !== 'bundle' ? h(Badge, { label: t(`source_${item.source}`) }) : null,
                    !isOn ? h(Badge, { label: t('registryOnly') }) : null,
                    rowLocked ? h(Badge, { label: t('toggleUnavailableMcp'), tone: 'warning' }) : null,
                    h(Switch, {
                      checked: isOn,
                      disabled: !switchable || globalBlocked,
                      label: item.server,
                      stateLabel: isOn ? t('toggleOn') : t('toggleOff'),
                      onToggle: () => runGlobalAction({ kind: 'mcp', name: item.server, enabled: !isOn }),
                    }),
                    globalBusy === `mcp|${item.server}` ? h('span', { style: S.spinner, className: 'inv-spin' }) : null,
                  ),
                  isOpen
                    ? (item.toolNames ?? []).length === 0
                      ? h('div', { style: { ...S.empty, padding: '4px 0 2px 26px' } }, t('noTools'))
                      : h(
                          'ul',
                          { style: S.edgeList },
                          ...item.toolNames.map((name) => h('li', { key: `mt-${name}`, style: S.edge }, h('code', { style: { fontSize: '12.5px' } }, name))),
                        )
                    : null,
                )
              }),
        ),
        h(
          Section,
          { key: 'skills', t, title: t('skills'), hint: `${t('skillsHint')} · ${t('globalHint')}`, count: skills.length, open: open.skills, onToggle: () => toggle('skills') },
          skills.length === 0
            ? [h('div', { key: 'skills-empty', style: S.empty }, q.length > 0 ? t('emptySearch') : hiddenSkills.length > 0 && !showHiddenSkills ? t('hiddenSkillsEmpty') : t('noSkills'))]
            : [
                vaultCandidates.length === 0
                  ? null
                  : h(
                      'div',
                      { key: 'vault-in-all', style: S.rowActions },
                      h(RowButton, {
                        label: t('vaultInAll'),
                        disabled: vaultBlocked,
                        onClick: () => runVaultAction({ action: 'in-all' }),
                      }),
                    ),
                ...skills.map((item, index) => {
                const key = `skill-${item.name}`
                const isOpen = expanded[key] === true
                const edges = item.edges ?? []
                const toggleRow = () => toggleItem(key)
                const isOn = item.disabled !== true
                const rowLocked = item.toggleable === false
                const switchable = !rowLocked && !globalSkillLocked
                const vaulted = item.vaulted === true
                const globalSkill = item.global === true
                // Vault moves only apply to skills that are globally registered
                // and still live in the global root.
                const showVaultIn = !vaulted && globalSkill && item.toggleable !== false
                const vaultRowBusy = vaultBusy === `in|${item.name}` || vaultBusy === `out|${item.name}`
                // Anything the host cannot switch is a project-scoped skill.
                return h(
                  'div',
                  { key, style: { ...S.row, ...(index === skills.length - 1 ? S.rowLast : {}), flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
                  h(
                    'div',
                    {
                      role: 'button',
                      tabIndex: 0,
                      'aria-expanded': isOpen ? 'true' : 'false',
                      className: 'inv-row',
                      'data-interactive': 'true',
                      style: { display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', minWidth: 0 },
                      onClick: toggleRow,
                      onKeyDown: activate(toggleRow),
                    },
                    h('span', { className: 'inv-chev', style: { ...S.chev, transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' } }, h(Icon, { name: 'chevronDown', size: 15 })),
                    h(
                      'div',
                      { style: { ...S.rowMain, ...(hiddenSkills.includes(item.name) ? S.rowTextHidden : {}) } },
                      h(
                        'div',
                        { style: S.subRow },
                        h('span', { style: S.rowTitle }, item.name),
                        h(Badge, { label: item.source ?? 'disk' }),
                        h(Badge, { label: vaulted ? t('vaultScope') : globalSkill ? t('globalScope') : t('projectScope') }),
                        item.disabled ? h(Badge, { label: t('shadowed'), tone: 'warning', dot: true }) : null,
                      ),
                      vaulted ? h('span', { style: S.rowSub }, t('vaultedNote')) : null,
                      item.description ? h('span', { style: S.note }, item.description) : null,
                    ),
                    item.deps && item.deps.assets > 1
                      ? h(Badge, {
                          label: `${item.deps.assets} ${t('skillAssets')}`,
                          tone: item.deps.missing > 0 ? 'danger' : undefined,
                          dot: item.deps.missing > 0,
                        })
                      : null,
                    h(Badge, { label: `${edges.length} ${t('edges')}`, tone: edges.length > 0 ? 'success' : undefined, dot: edges.length > 0 }),
                    vaulted ? null : rowLocked ? h(Badge, { label: t('toggleUnavailableProject'), tone: 'warning' }) : null,
                    vaulted
                      ? h(RowButton, {
                          label: t('vaultOut'),
                          disabled: vaultBlocked,
                          onClick: () => runVaultAction({ action: 'out', name: item.name }),
                        })
                      : h(Switch, {
                          checked: isOn,
                          disabled: !switchable || globalBlocked,
                          label: item.name,
                          stateLabel: isOn ? t('toggleOn') : t('toggleOff'),
                          onToggle: () => runGlobalAction({ kind: 'skill', name: item.name, enabled: !isOn }),
                        }),
                    showVaultIn
                      ? h(RowButton, {
                          label: t('vaultIn'),
                          disabled: vaultBlocked,
                          onClick: () => runVaultAction({ action: 'in', name: item.name }),
                        })
                      : null,
                    vaultRowBusy ? h('span', { style: S.spinner, className: 'inv-spin' }) : null,
                    globalBusy === `skill|${item.name}` ? h('span', { style: S.spinner, className: 'inv-spin' }) : null,
                    h(RowIconButton, {
                      label: hiddenSkills.includes(item.name) ? `${t('unhideSkill')} ${item.name}` : `${t('hideSkill')} ${item.name}`,
                      icon: hiddenSkills.includes(item.name) ? 'eye' : 'eyeOff',
                      onClick: () => setSkillHidden(item.name, !hiddenSkills.includes(item.name)),
                    }),
                  ),
                  isOpen
                    ? h(
                        'div',
                        { style: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '2px 0 2px 26px' } },
                        item.deps && (item.deps.edges ?? []).length > 0
                          ? h(
                              'div',
                              { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
                              h('span', { style: S.note }, `${t('skillAssetRefs')} · ${t('skillAssetsHint')}`),
                              h(
                                'ul',
                                { style: S.edgeList },
                                ...item.deps.edges.map((dep, index3) =>
                                  h(
                                    'li',
                                    { key: `d-${index3}`, style: S.edge },
                                    h('code', { style: { fontSize: '12.5px' } }, `${dep.from} → ${dep.to}`),
                                    dep.exists ? null : h(Badge, { label: t('skillRefMissing'), tone: 'danger', dot: true }),
                                  ),
                                ),
                              ),
                            )
                          : null,
                        edges.length === 0
                          ? h('div', { style: S.empty }, t('noEdges'))
                          : h(
                              'ul',
                              { style: S.edgeList },
                              ...edges.map((edge, index2) =>
                                h(
                                  'li',
                                  { key: `e-${index2}`, style: S.edge },
                                  h('code', { style: { fontSize: '12.5px' } }, edge.id),
                                  h(Badge, { label: edgeKindLabel(t, edge.kind) }),
                                  h(Badge, { label: confidenceLabel(t, edge.confidence) }),
                                  edge.evidence?.count > 0 ? h(Badge, { label: t('edgeCount').replace('{count}', String(edge.evidence.count)), tone: 'success', dot: true }) : null,
                                  edge.evidence?.sample ? h('span', { style: S.evidence }, edge.evidence.sample) : null,
                                ),
                              ),
                            ),
                      )
                    : null,
                )
                }),
              ],
        ),
      ]

      // The two live sections lead the overview: they are the settings the
      // tool list only describes, and the provider list is the page's live,
      // actionable half. Same page, same switch-and-row language, different
      // data source. Both stay mounted, so folding one away does not throw
      // away a half-typed prompt.
      const liveSections = [
        h(
          Section,
          {
            key: 'providers',
            t,
            title: t('providerSection'),
            hint: t('providerHint'),
            count: 0,
            open: providersOpen,
            onToggle: () => setProvidersOpen((prev) => !prev),
            showCount: false,
          },
          providersOpen ? h(WebSearchProviders, { key: 'providers-panel', t }) : null,
        ),
        h(
          Section,
          {
            key: 'credentials',
            t,
            title: t('credentialSection'),
            hint: t('credentialToolHint'),
            count: 0,
            open: credentialsOpen,
            onToggle: () => setCredentialsOpen((prev) => !prev),
            showCount: false,
          },
          credentialsOpen ? h(CredentialVault, { key: 'credentials-panel', t }) : null,
        ),
        h(
          Section,
          {
            key: 'prompt',
            t,
            title: t('promptSection'),
            hint: t('promptDescription'),
            count: 0,
            open: promptOpen,
            onToggle: () => setPromptOpen((prev) => !prev),
            showCount: false,
          },
          promptOpen ? h(PromptInjector, { key: 'prompt-panel', t }) : null,
        ),
      ]

      // Left navigation rail (issue #91): the six views in two groups. Counts
      // mirror what the views will show; the workspace detail keeps the
      // highlight on 工作区 because it is the same view state.
      const pageChildren = [
              // (the page column is a fixed 780px list width on purpose: the tool
              // survey reads like an inset list, and the live sections follow it)
              h(
                'div',
                { style: S.hero },
                h(
                  'h3',
                  { style: S.h1 },
                  view === 'sync'
                    ? t('syncTitle')
                    : view === 'providers'
                      ? t('providerSection')
                      : view === 'prompt'
                        ? t('promptSection')
                        : view === 'credentials'
                          ? t('credentialSection')
                          : view === 'workspace' && activeWorkspace
                          ? activeWorkspace.title
                          : t('title'),
            ),
              view === 'sync'
                ? h('p', { style: S.subtitle }, t('syncSubtitle'))
                : view === 'providers'
                  ? h('p', { style: S.subtitle }, `${t('providerPriorityHint')} ${t('providerHint')}`)
                  : view === 'prompt'
                    ? h('p', { style: S.subtitle }, t('promptDescription'))
                    : view === 'credentials'
                      ? h('p', { style: S.subtitle }, t('credentialHint'))
                      : view === 'workspace' && activeWorkspace
                        ? h(
                            'div',
                            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                            h('span', { style: S.groupDir }, activeWorkspace.path),
                            activeWorkspace.default === true ? h(Badge, { label: t('wsDefault'), tone: 'success', dot: true }) : null,
                            activeWorkspace.available === false ? h(Badge, { label: t('wsUnavailableDir'), tone: 'danger', dot: true }) : null,
                          )
                        : h('p', { style: S.subtitle }, t('subtitle')),
            ),
            h('div', { style: S.controls }, view === 'global' ? officialToggle : null, hiddenSkillsChip, isLiveView ? null : stamp),
            view === 'sync' || isLiveView
              ? null
              : view === 'global'
                ? searchField(query, setQuery, t('search'), t('search'))
                : showList
                  ? searchField(wsQuery, setWsQuery, t('wsSearchList'), t('wsSearchList'))
                  : searchField(wsQuery, setWsQuery, t('wsSearch'), t('wsSearch')),
            view === 'sync' || isLiveView ? null : view === 'global' ? stats : null,
            view === 'global' && warnings.length > 0
              ? h(
                  'div',
                  { style: { ...S.warn, marginTop: '14px' } },
                  h(Icon, { name: 'alert', size: 18, style: { color: C.warning } }),
                  h(
                    'div',
                    { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                    h('strong', { style: { fontWeight: 600 } }, t('warnings')),
                    ...warnings.slice(0, 8).map((warning, index) => h('div', { key: `w-${index}` }, warning.message ?? warning.code)),
                  ),
                )
              : null,
            isLiveView
              ? h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: '12px', paddingTop: '12px', paddingBottom: '28px' } },
                  view === 'providers'
                    ? h(WebSearchProviders, { key: 'providers', t })
                    : view === 'credentials'
                      ? h(CredentialVault, { key: 'credentials', t })
                      : h(PromptInjector, { key: 'prompt', t }),
                )
              : view === 'sync'
              ? h(SyncPanel, { key: 'sync-panel', t, onReloadSnapshot: () => load(true) })
              : view === 'global'
                ? [...liveSections, ...overviewSections]
                : showList
                  ? h(WorkspaceList, { key: 'ws-list', t, data, onEnter: openWorkspace, query: wsQuery, hiddenSkills, showHiddenSkills })
                  : h(WorkspaceDetail, {
                      key: 'ws-detail',
                      t,
                      data,
                      workspace: activeWorkspace,
                      busy: wsBusy,
                      query: wsQuery,
                      onAssign: runWorkspaceAction,
                      hiddenSkills,
                      showHiddenSkills,
                      onSetSkillHidden: setSkillHidden,
                      mcpOpen: detailOpen.mcp,
                      skillsOpen: detailOpen.skills,
                      onToggleMcp: () => toggleDetail('mcp'),
                      onToggleSkills: () => toggleDetail('skills'),
                    }),
            wsError.length > 0
              ? h(
                  'div',
                  { style: S.toast, role: 'alert' },
                  h(Icon, { name: 'alert', size: 18, style: { color: C.danger } }),
                  h('span', { style: { flex: '1 1 auto' } }, `${t('wsActionFailed')}: ${wsError}`),
                  h('button', { type: 'button', className: 'inv-btn', style: S.toastBtn, onClick: () => setWsError('') }, t('wsDismiss')),
                )
              : null,
            globalError.length > 0
              ? h(
                  'div',
                  { style: S.toast, role: 'alert' },
                  h(Icon, { name: 'alert', size: 18, style: { color: C.danger } }),
                  h('span', { style: { flex: '1 1 auto' } }, `${t('globalToggleFailed')}: ${globalError}`),
                  h('button', { type: 'button', className: 'inv-btn', style: S.toastBtn, onClick: () => setGlobalError('') }, t('wsDismiss')),
                )
              : null,
            globalNotice.length > 0 ? h('div', { style: S.notice, role: 'status' }, globalNotice) : null,
            vaultError.length > 0
              ? h(
                  'div',
                  { style: S.toast, role: 'alert' },
                  h(Icon, { name: 'alert', size: 18, style: { color: C.danger } }),
                  h('span', { style: { flex: '1 1 auto' } }, `${t('vaultFailed')}: ${vaultError}`),
                  h('button', { type: 'button', className: 'inv-btn', style: S.toastBtn, onClick: () => setVaultError('') }, t('wsDismiss')),
                )
              : null,
      ]

      return shell(nav, pageChildren, {
        overview: packages.length + mcp.length + skills.length,
        workspaces: workspaceList.length,
      })
    }
