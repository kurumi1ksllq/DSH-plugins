/**
 * dsh-inventory — browser half.
 *
 * Adds a left-sidebar entry (id `inventory`) with a full-height main panel.
 * Reads `GET /inventory/snapshot` from the host half and renders five read-only
 * views: counts, plugin packages + rows, MCP servers, skills with their tool
 * edges, and the tool registry.
 */

window.__ModuleLoader__.load({
  id: 'dsh-inventory',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'inventory'
    const ROUTE = '/inventory/snapshot'

    const zh = {
      tab: '安装总览',
      panel: '安装总览',
      back: '返回对话',
      title: '安装总览',
      subtitle: '只读快照：插件包、加载行、MCP 服务器、技能与工具，以及技能指向的工具。',
      refresh: '刷新',
      loading: '正在汇总安装信息…',
      error: '读取安装清单失败。',
      retry: '重试',
      generatedAt: '生成于',
      search: '搜索名称、描述、模块…',
      emptySearch: '没有匹配项。',
      counts: '统计',
      packages: '插件包',
      packagesHint: 'profile 声明的依赖与 bundle 清单',
      rows: '插件加载行',
      rowsHint: 'Cordis Loader 当前组合',
      mcp: 'MCP 服务器',
      mcpHint: '由 @deepseek-ai/dsh-mcp-client 条目提供',
      skills: '技能',
      skillsHint: '磁盘扫描（含被屏蔽的桩）+ 运行时注册',
      tools: '工具',
      toolsHint: '当前工具注册表的全量视图',
      warnings: '注意事项',
      orphan: '未安装',
      loaded: '已加载',
      inactive: '未激活',
      noRow: '无自身加载行',
      declaresDeps: '依赖',
      declaresBundle: 'bundle',
      enabled: '已启用',
      disabled: '已停用',
      shadowed: '已屏蔽',
      runtimeSnap: '运行时注册',
      fiberPending: '等待依赖',
      fiberLoading: '加载中',
      fiberActive: '运行中',
      fiberFailed: '启动失败',
      fiberUnloading: '卸载中',
      fiberNone: '无 fiber 记录',
      statusConnected: '已连接',
      statusNoTools: '无工具',
      statusFailed: '失败',
      toolsCount: '个工具',
      config: '配置',
      noConfig: '无配置字段',
      edges: '指向的工具',
      noEdges: '未识别到工具引用',
      edgeKindTool: '注册工具',
      edgeKindMcp: 'MCP 服务',
      edgeKindCli: '外部命令',
      edgeKindScript: '脚本',
      confidenceHigh: '高可信',
      confidenceMedium: '中可信',
      confidenceLow: '低可信',
      confidenceObserved: '会话实证',
      edgeCount: '会话命中 {count} 次',
      clickExpand: '展开',
      clickCollapse: '收起',
      ownerBuiltin: '内置',
      ownerPlugin: '插件',
      ownerMcp: 'MCP',
      ownerUnknown: '未识别',
      deferred: '已折叠',
      deferredHint: '被 tool-search 延迟加载',
      noSkills: '没有发现技能。',
      noTools: '工具注册表为空（可能尚未就绪）。',
      noMcp: '没有配置 MCP 服务器。',
      noPackages: 'profile 没有声明插件。',
    }

    const en = {
      tab: 'Inventory',
      panel: 'Inventory',
      back: 'Back to chat',
      title: 'Inventory',
      subtitle: 'Read-only snapshot: plugin packages, loader rows, MCP servers, skills, tools — and the tools each skill reaches for.',
      refresh: 'Refresh',
      loading: 'Collecting installation data…',
      error: 'Could not read the inventory.',
      retry: 'Retry',
      generatedAt: 'Generated',
      search: 'Search names, descriptions, modules…',
      emptySearch: 'Nothing matches.',
      counts: 'Counts',
      packages: 'Plugin packages',
      packagesHint: 'Dependencies and bundles declared by the profile',
      rows: 'Loader rows',
      rowsHint: 'Current Cordis Loader composition',
      mcp: 'MCP servers',
      mcpHint: 'Rows served by @deepseek-ai/dsh-mcp-client',
      skills: 'Skills',
      skillsHint: 'Disk scan (including shadowed stubs) plus runtime registrations',
      tools: 'Tools',
      toolsHint: 'Full view of the current tool registry',
      warnings: 'Notes',
      orphan: 'missing',
      loaded: 'loaded',
      inactive: 'not active',
      noRow: 'no own row',
      declaresDeps: 'dependency',
      declaresBundle: 'bundle',
      enabled: 'enabled',
      disabled: 'disabled',
      shadowed: 'shadowed',
      runtimeSnap: 'runtime',
      fiberPending: 'pending',
      fiberLoading: 'loading',
      fiberActive: 'active',
      fiberFailed: 'failed',
      fiberUnloading: 'unloading',
      fiberNone: 'no fiber',
      statusConnected: 'connected',
      statusNoTools: 'no tools',
      statusFailed: 'failed',
      toolsCount: 'tools',
      config: 'Config',
      noConfig: 'no config fields',
      edges: 'Tools it points at',
      noEdges: 'No tool reference detected',
      edgeKindTool: 'registered tool',
      edgeKindMcp: 'MCP server',
      edgeKindCli: 'external command',
      edgeKindScript: 'script',
      confidenceHigh: 'high',
      confidenceMedium: 'medium',
      confidenceLow: 'low',
      confidenceObserved: 'session evidence',
      edgeCount: '{count} calls seen',
      clickExpand: 'Expand',
      clickCollapse: 'Collapse',
      ownerBuiltin: 'builtin',
      ownerPlugin: 'plugin',
      ownerMcp: 'MCP',
      ownerUnknown: 'unknown',
      deferred: 'deferred',
      deferredHint: 'loaded on demand by tool-search',
      noSkills: 'No skills found.',
      noTools: 'The tool registry is empty (not ready yet).',
      noMcp: 'No MCP server configured.',
      noPackages: 'The profile declares no plugins.',
    }

    const color = {
      text: 'var(--dsw-alias-label-primary, #1f2328)',
      muted: 'var(--dsw-alias-label-secondary, #6b7280)',
      border: 'var(--dsw-alias-border, rgba(0,0,0,0.12))',
      surface: 'var(--dsw-alias-bg-secondary, rgba(0,0,0,0.03))',
      brand: 'var(--dsw-alias-brand-primary, #4d6bfe)',
      danger: 'var(--dsw-alias-label-danger, #d14343)',
      success: 'var(--dsw-alias-label-success, #1f9d55)',
      warning: 'var(--dsw-alias-label-warning, #b7791f)',
    }

    const S = {
      root: {
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        color: color.text,
        font: 'inherit',
        padding: '20px 24px 32px',
      },
      header: { display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0 },
      titleRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      back: {
        border: 'none',
        background: 'transparent',
        color: color.muted,
        fontSize: '12.5px',
        cursor: 'pointer',
        padding: '2px 0',
      },
      title: { fontSize: '15px', fontWeight: 600, margin: 0 },
      subtitle: { fontSize: '12.5px', color: color.muted, margin: 0, lineHeight: 1.5 },
      toolbar: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', flexShrink: 0 },
      search: {
        flex: '1 1 240px',
        minWidth: '180px',
        boxSizing: 'border-box',
        padding: '6px 10px',
        fontSize: '13px',
        color: color.text,
        background: 'var(--dsw-alias-bg-base, transparent)',
        border: `1px solid ${color.border}`,
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        outline: 'none',
      },
      button: {
        padding: '6px 12px',
        fontSize: '12.5px',
        fontWeight: 500,
        color: color.text,
        background: color.surface,
        border: `1px solid ${color.border}`,
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        cursor: 'pointer',
      },
      primary: {
        padding: '6px 14px',
        fontSize: '12.5px',
        fontWeight: 600,
        color: '#fff',
        background: color.brand,
        border: 'none',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        cursor: 'pointer',
      },
      chips: { display: 'flex', gap: '6px', flexWrap: 'wrap', flexShrink: 0 },
      chip: {
        fontSize: '11.5px',
        lineHeight: '18px',
        padding: '1px 8px',
        borderRadius: '999px',
        background: color.surface,
        border: `1px solid ${color.border}`,
        color: color.muted,
        whiteSpace: 'nowrap',
      },
      // The panel owns the scrollbar (root has overflowY:auto), so its children
      // must never shrink: a shrinking section clips its own rows away and the
      // scrollbar never appears.
      section: { border: `1px solid ${color.border}`, borderRadius: '10px', overflow: 'hidden', flexShrink: 0 },
      sectionHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '9px 12px',
        background: color.surface,
        cursor: 'pointer',
        userSelect: 'none',
      },
      sectionTitle: { fontSize: '13px', fontWeight: 600 },
      sectionHint: { fontSize: '11.5px', color: color.muted },
      sectionBody: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px' },
      row: {
        display: 'flex',
        gap: '8px',
        // Baseline alignment hangs a badge below the text it belongs to (its box
        // is taller than a text line), so every row is centred instead.
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '6px 8px',
        fontSize: '12.5px',
        borderRadius: '8px',
        border: `1px solid ${color.border}`,
      },
      rowMain: { fontWeight: 500, wordBreak: 'break-all' },
      rowSub: { fontSize: '11.5px', color: color.muted },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        boxSizing: 'border-box',
        height: '18px',
        fontSize: '10.5px',
        lineHeight: '16px',
        padding: '0 6px',
        borderRadius: '999px',
        border: `1px solid ${color.border}`,
        color: color.muted,
        whiteSpace: 'nowrap',
      },
      badgeSuccess: { color: color.success, borderColor: color.success },
      badgeDanger: { color: color.danger, borderColor: color.danger },
      badgeWarning: { color: color.warning, borderColor: color.warning },
      edgeList: {
        margin: '4px 0 0',
        padding: '8px 10px',
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        background: color.surface,
        borderRadius: '8px',
        width: '100%',
        boxSizing: 'border-box',
      },
      edge: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12px' },
      evidence: { fontSize: '11px', color: color.muted, wordBreak: 'break-word' },
      warn: {
        fontSize: '12px',
        padding: '8px 10px',
        borderRadius: '8px',
        border: `1px dashed ${color.warning}`,
        color: color.warning,
        display: 'flex',
        flexDirection: 'column',
        gap: '2px',
        flexShrink: 0,
      },
      errorBox: {
        padding: '12px',
        borderRadius: '8px',
        border: `1px solid ${color.danger}`,
        color: color.danger,
        fontSize: '12.5px',
        display: 'flex',
        gap: '10px',
        alignItems: 'center',
        flexShrink: 0,
      },
      skeleton: { height: '14px', borderRadius: '4px', background: color.surface, flexShrink: 0 },
      empty: { fontSize: '12px', color: color.muted, padding: '4px 0' },
    }

    const FILTERS = [
      ['packages', (item) => `${item.name} ${item.spec ?? ''} ${item.version ?? ''} ${item.declaredBy.join(' ')}`],
      ['rows', (item) => `${item.id} ${item.name} ${item.fiberPhase ?? ''}`],
      ['mcp', (item) => `${item.server} ${item.entryId} ${item.transport ?? ''} ${item.command ?? ''} ${item.status}`],
      ['skills', (item) => `${item.name} ${item.description ?? ''} ${item.source ?? ''} ${(item.edges ?? []).map((e) => e.id).join(' ')}`],
      ['tools', (item) => `${item.name} ${item.owner?.ref ?? ''} ${item.owner?.kind ?? ''}`],
    ]

    function matches(query, item, pick) {
      if (query.length === 0) return true
      return pick(item).toLowerCase().includes(query)
    }

    function Badge({ label, tone }) {
      const override = tone === 'success' ? S.badgeSuccess : tone === 'danger' ? S.badgeDanger : tone === 'warning' ? S.badgeWarning : {}
      return h('span', { style: { ...S.badge, ...override } }, label)
    }

    function Section({ title, hint, count, open, onToggle, children }) {
      return h(
        'div',
        { style: S.section },
        h(
          'div',
          { style: S.sectionHead, onClick: onToggle, role: 'button', tabIndex: 0 },
          h('span', { style: S.sectionTitle }, `${open ? '▾' : '▸'} ${title}`),
          h('span', { style: S.chip }, String(count)),
          h('span', { style: S.sectionHint }, hint),
        ),
        open ? h('div', { style: S.sectionBody }, children) : null,
      )
    }

    function fiberLabel(t, phase) {
      if (phase === 'pending') return t('fiberPending')
      if (phase === 'loading') return t('fiberLoading')
      if (phase === 'active') return t('fiberActive')
      if (phase === 'failed') return t('fiberFailed')
      if (phase === 'unloading') return t('fiberUnloading')
      return t('fiberNone')
    }

    function edgeKindLabel(t, kind) {
      if (kind === 'mcp-server') return t('edgeKindMcp')
      if (kind === 'cli') return t('edgeKindCli')
      if (kind === 'script') return t('edgeKindScript')
      return t('edgeKindTool')
    }

    function confidenceLabel(t, confidence) {
      if (confidence === 'high') return t('confidenceHigh')
      if (confidence === 'medium') return t('confidenceMedium')
      if (confidence === 'observed') return t('confidenceObserved')
      return t('confidenceLow')
    }

    /** Left-sidebar entry icon: a boxed list, matching what the panel shows. */
    function SidebarIcon(props) {
      const size = typeof props.size === 'number' && props.size > 0 ? props.size : 18
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', xmlns: 'http://www.w3.org/2000/svg', 'aria-hidden': 'true', focusable: 'false' },
        h('path', { d: 'M4 5.5h16V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5.5Z', stroke: 'currentColor', strokeWidth: 1.7, strokeLinejoin: 'round' }),
        h('path', { d: 'M4 9.5h16', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
        h('path', { d: 'M8 13h4M8 16h7', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }),
      )
    }

    function InventoryPanel({ t, back }) {
      const backButton =
        typeof back === 'function'
          ? h('button', { type: 'button', style: S.back, onClick: () => back() }, `‹ ${t('back')}`)
          : null
      const [status, setStatus] = React.useState('loading')
      const [data, setData] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [open, setOpen] = React.useState({
        packages: true,
        rows: false,
        mcp: true,
        skills: true,
        tools: false,
      })
      const [expanded, setExpanded] = React.useState({})

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

      React.useEffect(() => {
        load(false)
      }, [load])

      const q = query.trim().toLowerCase()
      const toggle = (key) => setOpen((prev) => ({ ...prev, [key]: !prev[key] }))
      const toggleItem = (key) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

      if (status === 'loading' && data === null) {
        return h(
          'div',
          { style: S.root },
          h('div', { style: S.header }, h('div', { style: S.titleRow }, backButton, h('h3', { style: S.title }, t('title'))), h('p', { style: S.subtitle }, t('loading'))),
          h('div', { style: S.skeleton }),
          h('div', { style: { ...S.skeleton, width: '70%' } }),
          h('div', { style: { ...S.skeleton, width: '85%' } }),
        )
      }

      if (status === 'error' && data === null) {
        return h(
          'div',
          { style: S.root },
          h('div', { style: S.titleRow }, backButton, h('h3', { style: S.title }, t('title'))),
          h(
            'div',
            { style: S.errorBox },
            h('span', null, `${t('error')} ${message ? `(${message})` : ''}`),
            h('button', { type: 'button', style: S.primary, onClick: () => load(true) }, t('retry')),
          ),
        )
      }

      const counts = data?.counts ?? {}
      const packages = (data?.packages ?? []).filter((item) => matches(q, item, FILTERS[0][1]))
      const rows = (data?.rows ?? []).filter((item) => matches(q, item, FILTERS[1][1]))
      const mcp = (data?.mcp ?? []).filter((item) => matches(q, item, FILTERS[2][1]))
      const skills = (data?.skills ?? []).filter((item) => matches(q, item, FILTERS[3][1]))
      const tools = (data?.tools ?? []).filter((item) => matches(q, item, FILTERS[4][1]))
      const warnings = data?.warnings ?? []

      return h(
        'div',
        { style: S.root },
        h(
          'div',
          { style: S.header },
          h('div', { style: S.titleRow }, backButton, h('h3', { style: S.title }, t('title'))),
          h('p', { style: S.subtitle }, t('subtitle')),
        ),
        h(
          'div',
          { style: S.toolbar },
          h('input', {
            style: S.search,
            value: query,
            placeholder: t('search'),
            onChange: (event) => setQuery(event.target.value),
          }),
          h('button', { type: 'button', style: S.button, onClick: () => load(true) }, t('refresh')),
          h(
            'span',
            { style: S.chip },
            `${t('generatedAt')} ${data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '-'}`,
          ),
        ),
        h(
          'div',
          { style: S.chips },
          h('span', { style: S.chip }, `${t('packages')} ${counts.packages ?? 0}`),
          h('span', { style: S.chip }, `${t('mcp')} ${counts.mcp ?? 0} (${counts.mcpConnected ?? 0})`),
          h('span', { style: S.chip }, `${t('skills')} ${counts.skills ?? 0} · ${t('shadowed')} ${counts.shadowedSkills ?? 0}`),
          h('span', { style: S.chip }, `${t('tools')} ${counts.tools ?? 0}`),
          h('span', { style: S.chip }, `${t('edges')} ${counts.edges ?? 0}`),
        ),
        warnings.length > 0
          ? h(
              'div',
              { style: S.warn },
              h('strong', null, t('warnings')),
              ...warnings.slice(0, 8).map((warning, index) => h('div', { key: `w-${index}` }, warning.message ?? warning.code)),
            )
          : null,
        h(
          Section,
          { title: t('packages'), hint: t('packagesHint'), count: packages.length, open: open.packages, onToggle: () => toggle('packages') },
          packages.length === 0
            ? h('div', { style: S.empty }, q.length > 0 ? t('emptySearch') : t('noPackages'))
            : packages.map((item, index) =>
                h(
                  'div',
                  { key: `pkg-${item.name}-${index}`, style: S.row },
                  h('span', { style: S.rowMain }, item.name),
                  item.version || item.spec ? h('span', { style: S.rowSub }, item.version ?? item.spec) : null,
                  ...item.declaredBy.map((source) => h(Badge, { key: `d-${source}`, label: source === 'dependencies' ? t('declaresDeps') : source })),
                  item.loaded ? h(Badge, { label: t('loaded'), tone: 'success' }) : null,
                  item.orphan ? h(Badge, { label: t('orphan'), tone: 'danger' }) : null,
                  // "No row" and "row but not running" are different facts; the
                  // panel must not show both as a bare package name. `rowless`
                  // only exists on newer payloads, so a package whose row state
                  // is simply absent still renders exactly as before.
                  !item.loaded && !item.orphan && item.rowless === true ? h(Badge, { label: t('noRow') }) : null,
                  !item.loaded && !item.orphan && item.rowless !== true && item.fiberPhase !== null && item.fiberPhase !== undefined
                    ? h(Badge, { label: t('inactive'), tone: 'warning' })
                    : null,
                ),
              ),
        ),
        h(
          Section,
          { title: t('rows'), hint: t('rowsHint'), count: rows.length, open: open.rows, onToggle: () => toggle('rows') },
          rows.length === 0
            ? h('div', { style: S.empty }, q.length > 0 ? t('emptySearch') : '-')
            : rows.map((item) =>
                h(
                  'div',
                  { key: `row-${item.id}`, style: S.row },
                  h('span', { style: S.rowMain }, item.id),
                  h('span', { style: S.rowSub }, item.name ?? ''),
                  h(Badge, { label: item.enabled ? t('enabled') : t('disabled'), tone: item.enabled ? 'success' : 'danger' }),
                  h(Badge, {
                    label: fiberLabel(t, item.fiberPhase),
                    tone: item.fiberPhase === 'failed' ? 'danger' : item.fiberPhase === 'active' ? 'success' : undefined,
                  }),
                ),
              ),
        ),
        h(
          Section,
          { title: t('mcp'), hint: t('mcpHint'), count: mcp.length, open: open.mcp, onToggle: () => toggle('mcp') },
          mcp.length === 0
            ? h('div', { style: S.empty }, q.length > 0 ? t('emptySearch') : t('noMcp'))
            : mcp.map((item) => {
                const key = `mcp-${item.entryId}`
                const isOpen = expanded[key] === true
                const tone = item.status === 'connected' ? 'success' : item.status === 'failed' ? 'danger' : 'warning'
                const statusLabel =
                  item.status === 'connected' ? t('statusConnected') : item.status === 'failed' ? t('statusFailed') : t('statusNoTools')
                return h(
                  'div',
                  { key, style: { ...S.row, flexDirection: 'column', alignItems: 'stretch', gap: '4px' } },
                  h(
                    'div',
                    { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }, onClick: () => toggleItem(key) },
                    h('span', { style: S.rowMain }, `${isOpen ? '▾' : '▸'} ${item.server}`),
                    h(Badge, { label: statusLabel, tone }),
                    h(Badge, { label: `${item.toolCount} ${t('toolsCount')}` }),
                    item.transport ? h(Badge, { label: item.transport }) : null,
                    item.command || item.url ? h('span', { style: S.rowSub }, item.command ?? item.url) : null,
                  ),
                  isOpen
                    ? (item.toolNames ?? []).length === 0
                      ? h('div', { style: S.empty }, t('noTools'))
                      : h(
                          'ul',
                          { style: S.edgeList },
                          ...item.toolNames.map((name) => h('li', { key: `mt-${name}`, style: S.edge }, h('code', { style: { fontSize: '11.5px' } }, name))),
                        )
                    : null,
                )
              }),
        ),
        h(
          Section,
          { title: t('skills'), hint: t('skillsHint'), count: skills.length, open: open.skills, onToggle: () => toggle('skills') },
          skills.length === 0
            ? h('div', { style: S.empty }, q.length > 0 ? t('emptySearch') : t('noSkills'))
            : skills.map((item) => {
                const key = `skill-${item.name}`
                const isOpen = expanded[key] === true
                const edges = item.edges ?? []
                return h(
                  'div',
                  { key, style: { ...S.row, flexDirection: 'column', alignItems: 'stretch', gap: '4px' } },
                  h(
                    'div',
                    { style: { display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', cursor: 'pointer' }, onClick: () => toggleItem(key) },
                    h('span', { style: S.rowMain }, `${isOpen ? '▾' : '▸'} ${item.name}`),
                    h(Badge, { label: item.source ?? 'disk' }),
                    item.disabled ? h(Badge, { label: t('shadowed'), tone: 'warning' }) : null,
                    h(Badge, { label: `${t('edges')} ${edges.length}`, tone: edges.length > 0 ? 'success' : undefined }),
                  ),
                  item.description ? h('div', { style: S.rowSub }, item.description) : null,                  isOpen
                    ? edges.length === 0
                      ? h('div', { style: S.empty }, t('noEdges'))
                      : h(
                          'ul',
                          { style: S.edgeList },
                          ...edges.map((edge, index) =>
                            h(
                              'li',
                              { key: `e-${index}`, style: S.edge },
                              h('code', { style: { fontSize: '11.5px' } }, edge.id),
                              h(Badge, { label: edgeKindLabel(t, edge.kind) }),
                              h(Badge, { label: confidenceLabel(t, edge.confidence) }),
                              edge.evidence?.count > 0 ? h(Badge, { label: t('edgeCount').replace('{count}', String(edge.evidence.count)), tone: 'success' }) : null,
                              edge.evidence?.sample ? h('span', { style: S.evidence }, edge.evidence.sample) : null,
                            ),
                          ),
                        )
                    : null,
                )
              }),
        ),
        h(
          Section,
          { title: t('tools'), hint: t('toolsHint'), count: tools.length, open: open.tools, onToggle: () => toggle('tools') },
          tools.length === 0
            ? h('div', { style: S.empty }, q.length > 0 ? t('emptySearch') : t('noTools'))
            : tools.map((item) => {
                const ownerLabel =
                  item.owner.kind === 'builtin'
                    ? t('ownerBuiltin')
                    : item.owner.kind === 'plugin'
                      ? t('ownerPlugin')
                      : item.owner.kind === 'mcp'
                        ? t('ownerMcp')
                        : t('ownerUnknown')
                return h(
                  'div',
                  { key: `tool-${item.name}`, style: S.row },
                  h('span', { style: S.rowMain }, item.name),
                  h(Badge, { label: `${ownerLabel}${item.owner.ref ? `: ${item.owner.ref}` : ''}` }),
                  item.deferred ? h(Badge, { label: t('deferred'), tone: 'warning' }) : null,
                )
              }),
        ),
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-inventory: dictionaries')
      const t = ctx.locale.bind(NS)

      // Sidebar entry and main panel share the same id/key, so selecting the
      // entry routes the shell to this panel (same contract as the shipped
      // prompt-inject sidebar panel).
      ctx.slots.inject('sidebar.panellist', () =>
        ctx.slots.register(
          {
            name: 'sidebar.panellist',
            id: 'inventory',
            order: 20,
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
            key: 'inventory',
            locale: NS,
            inject: () => ({
              t,
              back: () => ctx.layout.selectPanel(null),
            }),
          },
          InventoryPanel,
        ),
      )
    }

    return {
      name: 'dsh-inventory',
      inject: ['slots', 'locale', 'layout'],
      apply,
    }
  },
})
