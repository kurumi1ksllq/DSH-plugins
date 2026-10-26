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
    const WORKSPACE_ROUTE = '/inventory/workspace'

    const zh = {
      tab: '安装总览',
      panel: '安装总览',
      back: '返回对话',
      title: '安装总览',
      subtitle: '总览：插件包、加载行、MCP 服务器、技能与工具；工作区：点进去，用开关决定它开哪些 MCP 与技能。',
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
      wsOverview: '总览',
      wsWorkspaces: '工作区',
      wsNoWorkspaces: '还没有工作区。先在侧边栏新建或打开一个目录。',
      wsUnavailable: 'workspaceRegistry 不可用，无法列出工作区。',
      wsUnavailableDir: '目录不可用',
      wsNoDeclaration: '未声明 .dsh/mcp.json',
      wsInvalidDeclaration: '声明无法解析',
      wsMountedAs: '挂载为',
      wsSourceCustom: '自定义目录',
      wsSourceUserDsh: '用户 ~/.dsh/skills',
      wsSourceUserAgents: '用户 ~/.agents/skills',
      wsSourceBundled: '随包提供',
      wsCount: '个工作区',
      wsEnter: '进入 ›',
      wsBackToList: '工作区列表',
      wsMcpSection: 'MCP 服务器',
      wsSkillsSection: '技能',
      wsSwitchOn: '已开启',
      wsSwitchOff: '已关闭',
      wsDeclaredCount: '已声明',
      wsEnabledCount: '已开',
      wsGlobalMounted: '全局已挂载',
      wsNotLinked: '非本页链接',
      wsRuntimeOnly: '运行时注册（无磁盘目录）',
      wsActionFailed: '操作失败',
      wsDismiss: '关闭',
    }

    const en = {
      tab: 'Inventory',
      panel: 'Inventory',
      back: 'Back to chat',
      title: 'Inventory',
      subtitle: 'Overview: plugin packages, loader rows, MCP servers, skills and tools. Workspaces: open one and flip a switch per MCP server or skill.',
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
      wsOverview: 'Overview',
      wsWorkspaces: 'Workspaces',
      wsNoWorkspaces: 'No workspaces yet. Create or open a directory from the sidebar first.',
      wsUnavailable: 'The workspaceRegistry service is unavailable, so workspaces cannot be listed.',
      wsUnavailableDir: 'directory unavailable',
      wsNoDeclaration: 'no .dsh/mcp.json',
      wsInvalidDeclaration: 'declaration unreadable',
      wsMountedAs: 'mounted as',
      wsSourceCustom: 'custom dirs',
      wsSourceUserDsh: 'user ~/.dsh/skills',
      wsSourceUserAgents: 'user ~/.agents/skills',
      wsSourceBundled: 'bundled',
      wsCount: 'workspaces',
      wsEnter: 'Open ›',
      wsBackToList: 'Workspace list',
      wsMcpSection: 'MCP servers',
      wsSkillsSection: 'Skills',
      wsSwitchOn: 'on',
      wsSwitchOff: 'off',
      wsDeclaredCount: 'declared',
      wsEnabledCount: 'on',
      wsGlobalMounted: 'mounted globally',
      wsNotLinked: 'not linked by this page',
      wsRuntimeOnly: 'runtime only (no directory)',
      wsActionFailed: 'Action failed',
      wsDismiss: 'Dismiss',
    }

    // Only tokens the theme actually defines: a missing one silently falls back
    // and looks right in one theme only. `brand-primary` is a *contrast* colour
    // (#f9fafb dark / #1f2328 light), so it is never a fill.
    const color = {
      text: 'var(--dsw-alias-label-primary, #1f2328)',
      muted: 'var(--dsw-alias-label-secondary, #6b7280)',
      border: 'var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
      surface: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03))',
      base: 'var(--dsw-alias-bg-base, #fff)',
      accent: 'var(--dsw-alias-button-info-fill, #4176e6)',
      activeFill: 'var(--dsw-alias-button-ghost-active-fill, rgba(127,127,127,0.16))',
      activeBorder: 'var(--dsw-alias-button-ghost-active-border, rgba(127,127,127,0.5))',
      danger: 'var(--dsw-alias-state-error-primary, #d14343)',
      success: 'var(--dsw-alias-state-success-primary, #1f9d55)',
      warning: 'var(--dsw-static-amber-500, #b7791f)',
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
      title: { fontSize: '16px', fontWeight: 700, margin: 0 },
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
      // A switch is a control, not a container: the 34×18 track is a pill, so it
      // may sit inside a row without nesting a second box (see the nesting
      // contract in test/client.test.mjs). `marginLeft: auto` pins it right.
      switchTrack: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        boxSizing: 'border-box',
        width: '34px',
        height: '18px',
        padding: '0 1px',
        flexShrink: 0,
        marginLeft: 'auto',
        borderRadius: '999px',
        border: 'none',
        background: 'var(--dsw-alias-state-idle-primary, rgba(127,127,127,0.45))',
        cursor: 'pointer',
        transition: 'background 120ms ease',
      },
      switchTrackOn: { justifyContent: 'flex-end', background: color.accent },
      switchDisabled: { opacity: 0.45, cursor: 'default' },
      switchKnob: {
        display: 'block',
        width: '16px',
        height: '16px',
        borderRadius: '999px',
        background: color.base,
        boxShadow: '0 1px 2px rgba(0,0,0,0.35)',
      },
      viewSwitch: { display: 'flex', gap: '4px', flexShrink: 0 },
      wsRoot: { display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: 0 },
      detailHead: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', flexShrink: 0 },
      cardMeta: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      enterHint: { marginLeft: 'auto', fontSize: '12px', fontWeight: 600, color: color.accent, whiteSpace: 'nowrap' },
      // Workspace list: one bordered card per workspace (a real block of colour)
      // holding a title row and two counter lines. Rows inside a detail section
      // are separated by hairlines instead: nesting boxes inside boxes is what
      // made the panel read as one grey wall.
      card: {
        border: `1px solid ${color.border}`,
        borderRadius: '12px',
        background: color.surface,
        overflow: 'hidden',
        flexShrink: 0,
      },
      cardHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 14px',
        cursor: 'pointer',
        userSelect: 'none',
        background: 'transparent',
      },
      cardBody: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '2px 14px 12px' },
      groupDir: { fontSize: '10.5px', color: color.muted, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', wordBreak: 'break-all' },
      plainRow: {
        display: 'flex',
        gap: '8px',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '5px 0',
        fontSize: '12.5px',
        borderBottom: `1px solid ${color.border}`,
      },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '11.5px' },
      rowName: {
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '13px',
        fontWeight: 600,
        wordBreak: 'break-word',
      },
      cardTitle: { fontSize: '14.5px', fontWeight: 700 },
      countPill: { fontSize: '11px', color: color.muted, whiteSpace: 'nowrap' },
      viewActive: {
        padding: '6px 12px',
        fontSize: '12.5px',
        fontWeight: 700,
        // Accent text on the ghost fill: the fill alone is too quiet in the
        // light theme, where it is a pale grey on white.
        color: color.accent,
        background: color.activeFill,
        border: `1px solid ${color.activeBorder}`,
        borderRadius: 'var(--dsw-radius-sm, 6px)',
        cursor: 'pointer',
      },
      primary: {
        padding: '6px 14px',
        fontSize: '12.5px',
        fontWeight: 600,
        // Text in the page colour: it inverts with the theme, so the label keeps
        // its contrast against an accent fill that also inverts.
        color: color.base,
        background: color.accent,
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
      section: { border: `1px solid ${color.border}`, borderRadius: '12px', overflow: 'hidden', flexShrink: 0 },
      sectionHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '10px 14px',
        background: color.surface,
        cursor: 'pointer',
        userSelect: 'none',
      },
      sectionTitle: { fontSize: '13.5px', fontWeight: 700 },
      sectionHint: { fontSize: '11.5px', color: color.muted },
      sectionBody: { display: 'flex', flexDirection: 'column', gap: '0px', padding: '2px 14px 8px' },
      row: {
        display: 'flex',
        gap: '8px',
        // Baseline alignment hangs a badge below the text it belongs to (its box
        // is taller than a text line), so every row is centred instead.
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '5px 0',
        fontSize: '12.5px',
        // A hairline instead of a box: a full border on every row turned the
        // panel into a grid of identical rectangles with no hierarchy.
        borderBottom: `1px solid ${color.border}`,
      },
      rowMain: { fontSize: '13px', fontWeight: 600, wordBreak: 'break-all' },
      rowSub: { fontSize: '11.5px', color: color.muted },
      // A description under a row: full width so it never pushes a button away.
      rowNote: {
        fontSize: '11.5px',
        color: color.muted,
        flex: '1 1 100%',
        lineHeight: 1.45,
        wordBreak: 'break-word',
        // Two lines is enough to recognise a skill; the rest would only
        // push the next name out of sight.
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
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

    function sourceLabel(t, source) {
      if (source === 'project-dsh') return 'project .dsh/skills'
      if (source === 'project-agents') return 'project .agents/skills'
      if (source === 'user-dsh') return t('wsSourceUserDsh')
      if (source === 'user-agents') return t('wsSourceUserAgents')
      if (source === 'custom') return t('wsSourceCustom')
      if (source === 'bundled') return t('wsSourceBundled')
      return source
    }

    /**
     * One switch per row: a `role="switch"` button drawn as a 34×18 track with a
     * 16px knob, so a row toggles a capability in place instead of carrying a
     * separate action button. Pure function — no hooks, for the same reason as
     * WorkspaceDetail.
     */
    function Switch({ checked, disabled, label, stateLabel, onToggle }) {
      const isOn = checked === true
      const isDisabled = disabled === true
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': isOn ? 'true' : 'false',
          'aria-label': label,
          title: stateLabel ? `${label} · ${stateLabel}` : label,
          disabled: isDisabled,
          style: { ...S.switchTrack, ...(isOn ? S.switchTrackOn : {}), ...(isDisabled ? S.switchDisabled : {}) },
          onClick: () => {
            if (isDisabled) return
            onToggle()
          },
        },
        h('span', { style: S.switchKnob }),
      )
    }

    /** A section that never folds: header + hairline rows. */
    function Block({ title, hint, count, children }) {
      const body = Array.isArray(children) ? children : children === undefined || children === null ? [] : [children]
      return h(
        'div',
        { style: S.section },
        h(
          'div',
          { style: S.sectionHead },
          h('span', { style: S.sectionTitle }, title),
          h('span', { style: S.chip }, String(count ?? 0)),
          hint ? h('span', { style: S.sectionHint }, hint) : null,
        ),
        h('div', { style: S.sectionBody }, ...body),
      )
    }

    /**
     * Workspace list: one card per workspace, the whole card clickable. No rows
     * and no folding here — the detail page owns the switches.
     */
    function WorkspaceList({ t, data, onEnter }) {
      const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : []
      if (data?.workspaceRegistryAvailable === false) return h('div', { style: S.empty }, t('wsUnavailable'))
      if (workspaces.length === 0) return h('div', { style: S.empty }, t('wsNoWorkspaces'))
      return h(
        'div',
        { style: S.wsRoot },
        h('span', { style: S.chip }, `${workspaces.length} ${t('wsCount')}`),
        ...workspaces.map((workspace) =>
          h(
            'div',
            {
              key: `ws-${workspace.id}`,
              style: S.card,
              role: 'button',
              tabIndex: 0,
              'aria-label': `${t('wsEnter')} ${workspace.title}`,
              onClick: () => onEnter(workspace.id),
            },
            h(
              'div',
              { style: S.cardHead },
              h('span', { style: S.cardTitle }, workspace.title),
              workspace.available === false ? h(Badge, { label: t('wsUnavailableDir'), tone: 'danger' }) : null,
              h('span', { style: S.enterHint }, t('wsEnter')),
            ),
            h(
              'div',
              { style: S.cardBody },
              // One meta line: path plus the two counters, so a 14-workspace
              // list stays scannable instead of four lines per card.
              h(
                'div',
                { style: S.cardMeta },
                h('span', { style: S.groupDir }, workspace.path),
                h('span', { style: S.chip }, `MCP ${workspace.counts?.declared ?? 0} ${t('wsDeclaredCount')}`),
                h('span', { style: S.chip }, `${t('skills')} ${workspace.counts?.projectSkills ?? 0} ${t('wsEnabledCount')}`),
              ),
            ),
          ),
        ),
      )
    }

    /**
     * Workspace detail: the MCP and skill sets of one workspace, one row each
     * with a switch on the right. Pure function, zero hooks: InventoryPanel owns
     * the in-flight key, the error bar and the request itself, because the
     * offline test runtime shares one hook cursor across nested components.
     */
    function WorkspaceDetail(props) {
      const { t, data, workspace, busy, onAssign, onBack } = props
      const globalMcp = Array.isArray(data?.globalMcp) ? data.globalMcp : []
      const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : []
      const installedMcp = Array.isArray(data?.mcp) ? data.mcp : []
      const installedSkills = Array.isArray(data?.skills) ? data.skills : []
      const blocked = typeof busy === 'string' && busy.length > 0

      // MCP set = every installed server ∪ every server any workspace declares,
      // so a server another workspace already mounted can still be switched on.
      const declared = Array.isArray(workspace.mcp?.servers) ? workspace.mcp.servers : []
      const mcpNames = []
      for (const item of installedMcp) {
        const name = item?.server
        if (typeof name === 'string' && name.length > 0 && !mcpNames.includes(name)) mcpNames.push(name)
      }
      for (const other of workspaces) {
        for (const server of Array.isArray(other.mcp?.servers) ? other.mcp.servers : []) {
          const name = server?.name
          if (typeof name === 'string' && name.length > 0 && !mcpNames.includes(name)) mcpNames.push(name)
        }
      }
      mcpNames.sort((left, right) => left.localeCompare(right))

      const mcpRows = mcpNames.map((name) => {
        const declaredEntry = declared.find((server) => server?.name === name)
        const installedEntry = installedMcp.find((item) => item?.server === name)
        // Declared rows keep their mounted-as/transport/detail facts; an
        // installed-but-not-declared server borrows what the global list knows.
        const transport = declaredEntry?.transport ?? installedEntry?.transport
        const detail = declaredEntry?.detail ?? installedEntry?.command ?? installedEntry?.url
        const isGlobal = globalMcp.includes(name)
        const isDeclared = declaredEntry !== undefined
        // A globally registered server already reaches every workspace: there is
        // nothing to switch off, so its row states the fact and cannot be toggled.
        const locked = !isDeclared && isGlobal
        const isOn = isDeclared || isGlobal
        return h(
          'div',
          { key: `ws-mcp-${workspace.id}-${name}`, style: S.plainRow },
          h('span', { style: S.rowName }, name),
          transport ? h('span', { style: S.countPill }, transport) : null,
          detail ? h('span', { style: S.rowSub }, detail) : null,
          declaredEntry?.mountedAs && declaredEntry.mountedAs !== name
            ? h(Badge, { label: `${t('wsMountedAs')} ${declaredEntry.mountedAs}`, tone: 'success' })
            : null,
          isGlobal ? h(Badge, { label: t('wsGlobalMounted') }) : null,
          h(Switch, {
            checked: isOn,
            disabled: locked || blocked,
            label: name,
            stateLabel: isOn ? t('wsSwitchOn') : t('wsSwitchOff'),
            onToggle: () => onAssign({ workspace, kind: 'mcp', action: isDeclared ? 'remove' : 'add', name }),
          }),
        )
      })

      // Skill set = installed skills ∪ this workspace's own, keyed by name. The
      // workspace entry wins because it carries `linked` (the host's lstat
      // verdict); the installed entry keeps the skill's real origin.
      const skillsByName = new Map()
      for (const skill of installedSkills) {
        if (typeof skill?.name === 'string' && skill.name.length > 0) skillsByName.set(skill.name, { ...skill })
      }
      for (const group of workspace.skills ?? []) {
        for (const skill of group.skills ?? []) {
          if (typeof skill?.name !== 'string' || skill.name.length === 0) continue
          const known = skillsByName.get(skill.name) ?? {}
          skillsByName.set(skill.name, { ...known, ...skill, source: skill.source ?? known.source ?? group.source, assigned: true })
        }
      }
      const skillRows = [...skillsByName.values()]
        .sort((left, right) => String(left.name).localeCompare(String(right.name)))
        .map((skill) => {
          const assigned = skill.assigned === true
          const linked = skill.linked === true
          // A runtime-registered skill has no directory to link into, and a
          // hand-copied directory is not ours to unlink: both stay read-only.
          const runtimeOnly = skill.source === 'runtime'
          const locked = (assigned && !linked) || (!assigned && runtimeOnly)
          return h(
            'div',
            { key: `ws-skill-${workspace.id}-${skill.name}`, style: S.plainRow },
            h('span', { style: S.rowName }, skill.name),
            h(Badge, { label: skill.source ? sourceLabel(t, skill.source) : 'disk' }),
            skill.shadowed ? h(Badge, { label: t('shadowed'), tone: 'warning' }) : null,
            assigned && !linked ? h(Badge, { label: t('wsNotLinked'), tone: 'warning' }) : null,
            !assigned && runtimeOnly ? h(Badge, { label: t('wsRuntimeOnly'), tone: 'warning' }) : null,
            h(Switch, {
              checked: assigned,
              disabled: locked || blocked,
              label: skill.name,
              stateLabel: assigned ? t('wsSwitchOn') : t('wsSwitchOff'),
              onToggle: () => onAssign({ workspace, kind: 'skill', action: assigned ? 'remove' : 'add', name: skill.name }),
            }),
            skill.description ? h('span', { style: S.rowNote }, skill.description) : null,
          )
        })

      const mcpOn = mcpNames.filter((name) => declared.some((server) => server?.name === name) || globalMcp.includes(name)).length
      const skillsOn = [...skillsByName.values()].filter((skill) => skill.assigned === true).length
      const mcpStatus =
        workspace.mcp?.status === 'invalid'
          ? `${t('wsInvalidDeclaration')}: ${workspace.mcp.error ?? ''}`
          : workspace.mcp?.status === 'missing'
            ? t('wsNoDeclaration')
            : undefined
      const mcpHint = [mcpStatus, `${t('wsSwitchOn')} ${mcpOn}/${mcpNames.length}`].filter(Boolean).join(' · ')
      const skillsHint = `${t('wsSwitchOn')} ${skillsOn}/${skillRows.length}`

      return h(
        'div',
        { style: S.wsRoot },
        h(
          'div',
          { style: S.detailHead },
          h('button', { type: 'button', style: S.back, onClick: () => onBack() }, `‹ ${t('wsBackToList')}`),
          h('span', { style: S.title }, workspace.title),
          workspace.available === false ? h(Badge, { label: t('wsUnavailableDir'), tone: 'danger' }) : null,
          h('span', { style: { ...S.groupDir, flex: '1 1 100%' } }, workspace.path),
        ),
        h(
          Block,
          { title: t('wsMcpSection'), count: mcpNames.length, hint: mcpHint },
          mcpRows.length === 0 ? [h('div', { key: 'mcp-empty', style: S.empty }, t('noMcp'))] : mcpRows,
        ),
        h(
          Block,
          { title: t('wsSkillsSection'), count: skillRows.length, hint: skillsHint },
          skillRows.length === 0 ? [h('div', { key: 'sk-empty', style: S.empty }, t('noSkills'))] : skillRows,
        ),
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
      // Two-level navigation: 'global' is the overview, 'workspaces' the list,
      // 'workspace' the detail of `currentWorkspace` (a workspace id). Every
      // piece of view state lives here so no child component needs a hook.
      const [view, setView] = React.useState('global')
      const [currentWorkspace, setCurrentWorkspace] = React.useState('')
      // Switch-driven assignment: `wsBusy` is the key of the single request in
      // flight (`<path>|<kind>|<action>|<name>`), `wsError` the last failure.
      const [wsBusy, setWsBusy] = React.useState('')
      const [wsError, setWsError] = React.useState('')

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

      const workspaceList = Array.isArray(data?.workspaces) ? data.workspaces : []
      const activeWorkspace = workspaceList.find((workspace) => workspace.id === currentWorkspace) ?? null
      // A stale id (workspace removed, snapshot reloaded) falls back to the list
      // instead of rendering an empty detail page.
      const showList = view === 'workspaces' || (view === 'workspace' && activeWorkspace === null)
      const openWorkspace = (id) => {
        setCurrentWorkspace(id)
        setView('workspace')
      }

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
          h(
            'div',
            { style: S.viewSwitch },
            h(
              'button',
              { type: 'button', style: view === 'global' ? S.viewActive : S.button, onClick: () => setView('global') },
              t('wsOverview'),
            ),
            h(
              'button',
              { type: 'button', style: view !== 'global' ? S.viewActive : S.button, onClick: () => setView('workspaces') },
              t('wsWorkspaces'),
            ),
          ),
          // The filter only drives the overview sections; the workspace views
          // have their own lists, so a dead search box would just mislead.
          view === 'global'
            ? h('input', {
                style: S.search,
                value: query,
                placeholder: t('search'),
                onChange: (event) => setQuery(event.target.value),
              })
            : null,
          h('button', { type: 'button', style: S.button, onClick: () => load(true) }, t('refresh')),
          h(
            'span',
            { style: S.chip },
            `${t('generatedAt')} ${data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString() : '-'}`,
          ),
        ),
        view === 'global'
          ? h(
              'div',
              { style: S.chips },
              h('span', { style: S.chip }, `${t('packages')} ${counts.packages ?? 0}`),
              h('span', { style: S.chip }, `${t('mcp')} ${counts.mcp ?? 0} (${counts.mcpConnected ?? 0})`),
              h('span', { style: S.chip }, `${t('skills')} ${counts.skills ?? 0} · ${t('shadowed')} ${counts.shadowedSkills ?? 0}`),
              h('span', { style: S.chip }, `${t('tools')} ${counts.tools ?? 0}`),
              h('span', { style: S.chip }, `${t('edges')} ${counts.edges ?? 0}`),
            )
          : null,
        view === 'global' && warnings.length > 0
          ? h(
              'div',
              { style: S.warn },
              h('strong', null, t('warnings')),
              ...warnings.slice(0, 8).map((warning, index) => h('div', { key: `w-${index}` }, warning.message ?? warning.code)),
            )
          : null,
        // Last failed assign/remove. Dismissible, and the next action clears it.
        wsError.length > 0
          ? h(
              'div',
              { style: S.errorBox },
              h('span', { style: { flex: '1 1 auto' } }, `${t('wsActionFailed')}: ${wsError}`),
              h('button', { type: 'button', style: S.button, onClick: () => setWsError('') }, t('wsDismiss')),
            )
          : null,
        ...(view === 'global'
          ? [
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
            ]
          : showList
            ? [
                h(WorkspaceList, { key: 'ws-list', t, data, onEnter: openWorkspace }),
              ]
            : [
                h(WorkspaceDetail, {
                  key: 'ws-detail',
                  t,
                  data,
                  workspace: activeWorkspace,
                  busy: wsBusy,
                  onAssign: runWorkspaceAction,
                  onBack: () => setView('workspaces'),
                }),
              ]),
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
