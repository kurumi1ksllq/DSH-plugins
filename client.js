/**
 * dsh-inventory — browser half.
 *
 * Adds a left-sidebar entry (id `inventory`) with a full-height main panel.
 * Reads `GET /inventory/snapshot` from the host half and renders five read-only
 * views plus a per-workspace view that assigns or removes an MCP server / skill.
 *
 * Visual language: Apple grouped lists — one large title, grouped inset cards,
 * 44px rows separated by hairlines, a segmented control, iOS switches, and a
 * translucent sticky toolbar. Base styling is inline (the offline preview
 * renders inline styles only); pseudo-states and motion live in `STYLES`, which
 * is injected once so :hover / :focus-visible / reduced-motion exist at all.
 */

window.__ModuleLoader__.load({
  id: 'dsh-inventory',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'inventory'
    const ROUTE = '/inventory/snapshot'
    const WORKSPACE_ROUTE = '/inventory/workspace'
    const GLOBAL_ROUTE = '/inventory/global'
    const VAULT_ROUTE = '/inventory/vault'

    // Sections hidden by the eye button on their header, keyed by section id and
    // remembered across panel opens.
    const HIDDEN_KEY = 'dsh-inventory:hidden-sections'

    function readHiddenSections() {
      try {
        const stored = JSON.parse(window.localStorage.getItem(HIDDEN_KEY) ?? '{}')
        return stored !== null && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
      } catch {
        // No localStorage (test harness, private mode) or garbage stored: hide nothing.
        return {}
      }
    }

    function writeHiddenSections(value) {
      try {
        window.localStorage.setItem(HIDDEN_KEY, JSON.stringify(value))
      } catch {
        // Hiding still works for this panel even when it cannot be remembered.
      }
    }

    const zh = {
      tab: '工具管理',
      panel: '工具管理',
      back: '返回对话',
      title: '工具管理',
      subtitle: '插件包、加载行、MCP 服务器、技能与工具，以及每个工作区开了哪些 MCP 与技能。',
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
      skillAssets: '资产',
      skillAssetRefs: '文件引用',
      skillRefMissing: '引用缺失',
      noSkillRefs: '没有文件引用。',
      skillAssetsHint: '含 refs/ 下的附属资源',
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
      showOfficial: '显示官方',
      hideOfficial: '隐藏官方',
      officialHidden: '官方条目已隐藏。',
      officialHint: '官方 = @deepseek-ai/* 插件与内置工具',
      hideSection: '隐藏此栏目',
      showHiddenSkills: '显示技能栏目',
      wsOverview: '总览',
      wsWorkspaces: '工作区',
      wsNoWorkspaces: '还没有工作区。先在侧边栏新建或打开一个目录。',
      wsUnavailable: 'workspaceRegistry 不可用，无法列出工作区。',
      wsUnavailableDir: '目录不可用',
      wsDefault: '默认工作区',
      wsNoDeclaration: '未声明 .dsh/mcp.json',
      wsInvalidDeclaration: '声明无法解析',
      wsMountedAs: '挂载为',
      wsSourceCustom: '自定义目录',
      wsSourceUserDsh: '用户 ~/.dsh/skills',
      wsSourceUserAgents: '用户 ~/.agents/skills',
      wsSourceProjectDsh: '项目 .dsh/skills',
      wsSourceProjectAgents: '项目 .agents/skills',
      wsSourceBundled: '随包提供',
      wsCount: '个工作区',
      wsOpen: '打开',
      wsBackToList: '工作区列表',
      wsMcpSection: 'MCP 服务器',
      wsSkillsSection: '技能',
      wsSwitchOn: '已开启',
      wsSwitchOff: '已关闭',
      wsDeclaredCount: '已声明',
      wsEnabledCount: '已开',
      wsGlobalMounted: '全局已挂载',
      wsGlobalShort: '全局',
      wsGlobalNote: '对所有工作区生效',
      wsNotLinked: '非本页链接',
      wsNotLinkedNote: '手工复制，未由本页创建',
      wsRuntimeOnly: '运行时注册',
      wsRuntimeNote: '没有可链接的目录',
      wsGlobalSkillOn: '全局可用',
      wsGlobalSkillOnNote: '已对所有工作区生效，在总览里关闭',
      wsGlobalSkillOff: '全局已禁用',
      wsGlobalSkillOffNote: '在总览里开启后所有工作区可用',
      wsDuplicateNote: '与全局根上的同名技能重复，可移除链接',
      wsShareCount: '共享',
      wsItemCount: '项',
      wsSearch: '搜索 MCP 与技能',
      wsSearchList: '搜索工作区',
      wsActionFailed: '操作失败',
      wsDismiss: '关闭',
      globalScope: '全局',
      projectScope: '项目',
      toggleOn: '启用',
      toggleOff: '停用',
      globalToggleFailed: '全局开关失败',
      globalToggling: '处理中…',
      toggleUnavailableRuntime: '运行时注册，无磁盘文件',
      toggleUnavailableProject: '项目级技能',
      toggleUnavailableMcp: '该条目无法持久化开关',
      restartNeeded: '下次启动生效',
      globalHint: '已启用的排在前面',
      toggleSuccess: '已更新',
      registryOnly: '仅注册',
      registryOnlyNote: '停用全局挂载后，在工作区页按工作区启用',
      vaultScope: '仓库',
      vaultIn: '收进仓库',
      vaultOut: '移回全局根',
      vaultInAll: '全部收进仓库',
      vaultedNote: '仓库内技能只在启用的工作区里加载',
      vaultFailed: '仓库操作失败',
      vaultDone: '已移动 {count} 个',
    }

    const en = {
      tab: 'Tools',
      panel: 'Tools',
      back: 'Back to chat',
      title: 'Tools',
      subtitle: 'Plugin packages, loader rows, MCP servers, skills and tools — plus what each workspace has switched on.',
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
      skillAssets: 'assets',
      skillAssetRefs: 'file refs',
      skillRefMissing: 'missing ref',
      noSkillRefs: 'No file reference detected.',
      skillAssetsHint: 'includes files under refs/',
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
      showOfficial: 'Show official',
      hideOfficial: 'Hide official',
      officialHidden: 'Official entries are hidden.',
      officialHint: 'official = @deepseek-ai/* plugins and builtin tools',
      hideSection: 'Hide this section',
      showHiddenSkills: 'Show skills section',
      wsOverview: 'Overview',
      wsWorkspaces: 'Workspaces',
      wsNoWorkspaces: 'No workspaces yet. Create or open a directory from the sidebar first.',
      wsUnavailable: 'The workspaceRegistry service is unavailable, so workspaces cannot be listed.',
      wsUnavailableDir: 'directory unavailable',
      wsDefault: 'Default',
      wsNoDeclaration: 'no .dsh/mcp.json',
      wsInvalidDeclaration: 'declaration unreadable',
      wsMountedAs: 'mounted as',
      wsSourceCustom: 'custom dirs',
      wsSourceUserDsh: 'user ~/.dsh/skills',
      wsSourceUserAgents: 'user ~/.agents/skills',
      wsSourceProjectDsh: 'project .dsh/skills',
      wsSourceProjectAgents: 'project .agents/skills',
      wsSourceBundled: 'bundled',
      wsCount: 'workspaces',
      wsOpen: 'Open',
      wsBackToList: 'Workspace list',
      wsMcpSection: 'MCP servers',
      wsSkillsSection: 'Skills',
      wsSwitchOn: 'on',
      wsSwitchOff: 'off',
      wsDeclaredCount: 'declared',
      wsEnabledCount: 'on',
      wsGlobalMounted: 'mounted globally',
      wsGlobalShort: 'global',
      wsGlobalNote: 'applies to every workspace',
      wsNotLinked: 'not linked by this page',
      wsNotLinkedNote: 'hand-copied, not created here',
      wsRuntimeOnly: 'runtime only',
      wsRuntimeNote: 'no directory to link',
      wsGlobalSkillOn: 'global',
      wsGlobalSkillOnNote: 'on for every workspace; turn it off in the overview',
      wsGlobalSkillOff: 'disabled globally',
      wsGlobalSkillOffNote: 'enable it in the overview; it then applies to every workspace',
      wsDuplicateNote: 'duplicates the global copy; remove the link',
      wsShareCount: 'shared',
      wsItemCount: 'items',
      wsSearch: 'Search MCP servers and skills',
      wsSearchList: 'Search workspaces',
      wsActionFailed: 'Action failed',
      wsDismiss: 'Dismiss',
      globalScope: 'Global',
      projectScope: 'Project',
      toggleOn: 'On',
      toggleOff: 'Off',
      globalToggleFailed: 'Global toggle failed',
      globalToggling: 'Working…',
      toggleUnavailableRuntime: 'Runtime-only, no file',
      toggleUnavailableProject: 'Project skill',
      toggleUnavailableMcp: 'Not switchable',
      restartNeeded: 'Takes effect next start',
      globalHint: 'Enabled first',
      toggleSuccess: 'Updated',
      registryOnly: 'Registry only',
      registryOnlyNote: 'Not mounted; enable per workspace',
      vaultScope: 'Vault',
      vaultIn: 'Move to vault',
      vaultOut: 'Move out of vault',
      vaultInAll: 'Move all to vault',
      vaultedNote: 'Vaulted skills load only where enabled',
      vaultFailed: 'Vault action failed',
      vaultDone: 'Moved {count}',
    }

    // Tokens the theme actually defines. Fills that must read on both themes are
    // derived from label tokens with color-mix, so they never fall back to a
    // colour that only looks right in one theme.
    const C = {
      text: 'var(--dsw-alias-label-primary, #1f2328)',
      secondary: 'var(--dsw-alias-label-secondary, #6b7280)',
      hairline: 'var(--dsw-alias-border-l2, rgba(0,0,0,0.12))',
      card: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03))',
      base: 'var(--dsw-alias-bg-base, #fff)',
      accent: 'var(--dsw-alias-button-info-fill, #4176e6)',
      danger: 'var(--dsw-alias-state-error-primary, #d14343)',
      success: 'var(--dsw-alias-state-success-primary, #1f9d55)',
      warning: 'var(--dsw-static-amber-500, #b7791f)',
      // A quiet fill for search fields, segmented tracks and chips. 12% of the
      // label colour composites to a light grey on light and a raised dark grey
      // on dark — one value, both themes.
      fill: 'color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 12%, transparent)',
      fillStrong: 'color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 20%, transparent)',
      // Inverted pill: label colour as the fill, page colour as the text. Reads
      // ~15:1 in light and ~13:1 in dark, and it is the only selected-state
      // treatment that stays legible when the accent token inverts.
      invertedFill: 'var(--dsw-alias-label-primary, #1f2328)',
      invertedText: 'var(--dsw-alias-bg-base, #fff)',
      // iOS systemGray for the off switch track: 3:1+ against both page colours.
      switchOff: 'color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 72%, transparent)',
      knob: '#fff',
    }

    const FONT_MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Consolas, "Cascadia Mono", Menlo, monospace'
    const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

    const T = {
      large: { fontSize: '28px', fontWeight: 700, lineHeight: 1.15, letterSpacing: '-0.02em', margin: 0 },
      nav: { fontSize: '17px', fontWeight: 600, letterSpacing: '-0.01em' },
      listTitle: { fontSize: '17px', fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.01em' },
      rowTitle: { fontSize: '15px', fontWeight: 500, lineHeight: 1.3 },
      caption: { fontSize: '13px', lineHeight: 1.4 },
      captionStrong: { fontSize: '13px', fontWeight: 600 },
      badge: { fontSize: '12px', fontWeight: 500 },
      stat: { fontSize: '20px', fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.01em' },
      mono: { fontFamily: FONT_MONO, fontSize: '12.5px' },
    }

    const S = {
      root: {
        position: 'relative',
        boxSizing: 'border-box',
        width: '100%',
        height: '100%',
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        color: C.text,
        font: 'inherit',
        padding: 0,
      },
      // Translucent chrome: content scrolls under it (Apple "material").
      nav: {
        position: 'sticky',
        top: 0,
        zIndex: 10,
        display: 'flex',
        alignItems: 'center',
        gap: '2px',
        height: '52px',
        padding: '0 8px',
        flexShrink: 0,
        background: 'color-mix(in srgb, var(--dsw-alias-bg-base, #fff) 78%, transparent)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: `1px solid ${C.hairline}`,
      },
      navTitle: { ...T.nav, flex: '1 1 auto', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', padding: '0 6px' },
      back: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '2px',
        height: '40px',
        padding: '0 8px 0 4px',
        border: 'none',
        borderRadius: '10px',
        background: 'transparent',
        color: C.text,
        fontSize: '15px',
        fontWeight: 500,
        cursor: 'pointer',
        flexShrink: 0,
      },
      iconBtn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '40px',
        height: '40px',
        border: 'none',
        borderRadius: '10px',
        background: 'transparent',
        color: C.text,
        cursor: 'pointer',
        flexShrink: 0,
      },
      page: {
        width: '100%',
        maxWidth: '780px',
        margin: '0 auto',
        padding: '0 24px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
      },
      hero: { display: 'flex', flexDirection: 'column', gap: '8px', padding: '20px 0 4px', flexShrink: 0 },
      h1: { ...T.large },
      subtitle: { ...T.caption, color: C.secondary, margin: 0, maxWidth: '62ch' },
      controls: { display: 'flex', alignItems: 'center', gap: '12px', padding: '16px 0 0', flexWrap: 'wrap', flexShrink: 0 },
      seg: {
        display: 'inline-flex',
        gap: '2px',
        padding: '2px',
        borderRadius: '10px',
        background: C.fill,
        flexShrink: 0,
      },
      segBtn: {
        minHeight: '30px',
        padding: '0 16px',
        border: 'none',
        borderRadius: '8px',
        background: 'transparent',
        color: C.secondary,
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        transition: `background-color 200ms ${EASE}, color 200ms ${EASE}`,
      },
      segBtnActive: {
        background: C.invertedFill,
        color: C.invertedText,
        fontWeight: 600,
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
      },
      chip: {
        display: 'inline-flex',
        alignItems: 'center',
        height: '32px',
        padding: '0 12px',
        border: 'none',
        borderRadius: '9px',
        background: C.fill,
        color: C.secondary,
        fontSize: '13px',
        fontWeight: 500,
        cursor: 'pointer',
        flexShrink: 0,
        transition: `background-color 200ms ${EASE}, color 200ms ${EASE}`,
      },
      chipOn: { background: C.invertedFill, color: C.invertedText, fontWeight: 600 },
      stamp: { ...T.caption, color: C.secondary, marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' },
      searchWrap: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        height: '36px',
        padding: '0 10px',
        borderRadius: '10px',
        background: C.fill,
        flexShrink: 0,
        marginTop: '10px',
      },
      search: {
        flex: '1 1 auto',
        minWidth: 0,
        height: '100%',
        border: 'none',
        background: 'transparent',
        color: C.text,
        fontSize: '15px',
        outline: 'none',
        padding: 0,
      },
      card: {
        borderRadius: '14px',
        background: C.card,
        border: `1px solid ${C.hairline}`,
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      },
      stats: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(104px, 1fr))',
        gap: 0,
        flexShrink: 0,
      },
      statCell: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '12px 16px', flexShrink: 0 },
      statLabel: { ...T.caption, color: C.secondary },
      statValue: { ...T.stat },
      sectionHead: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        width: '100%',
        padding: '22px 4px 8px',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        userSelect: 'none',
        flexShrink: 0,
      },
      sectionTitle: { ...T.captionStrong, color: C.secondary },
      sectionCount: { ...T.caption, color: C.secondary, opacity: 0.75, fontVariantNumeric: 'tabular-nums' },
      sectionHint: { ...T.caption, color: C.secondary, opacity: 0.75, marginLeft: 'auto', paddingRight: '4px', whiteSpace: 'nowrap' },
      // Sits on the section header's right edge, level with the caption line.
      hideBtn: {
        position: 'absolute',
        top: '18px',
        right: '0px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '24px',
        height: '24px',
        padding: 0,
        border: 'none',
        borderRadius: '7px',
        background: 'transparent',
        color: C.secondary,
        opacity: 0.7,
        cursor: 'pointer',
        flexShrink: 0,
      },
      chev: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: C.secondary, transition: `transform 200ms ${EASE}`, flexShrink: 0 },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        minHeight: '44px',
        padding: '10px 16px',
        boxSizing: 'border-box',
        borderBottom: `1px solid ${C.hairline}`,
        flexShrink: 0,
      },
      rowLast: { borderBottom: 'none' },
      rowMain: { display: 'flex', flexDirection: 'column', gap: '2px', flex: '1 1 auto', minWidth: 0 },
      rowTitle: { ...T.rowTitle, wordBreak: 'break-word' },
      rowTitleMono: { ...T.rowTitle, fontFamily: FONT_MONO, fontSize: '14px', wordBreak: 'break-all' },
      rowSub: { ...T.caption, color: C.secondary, wordBreak: 'break-word' },
      rowMono: { ...T.mono, color: C.secondary, wordBreak: 'break-all' },
      note: {
        ...T.caption,
        color: C.secondary,
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
        overflow: 'hidden',
      },
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        height: '22px',
        padding: '0 8px',
        borderRadius: '999px',
        background: C.fill,
        color: C.text,
        ...T.badge,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      },
      dot: { width: '7px', height: '7px', borderRadius: '999px', flexShrink: 0 },
      lockLabel: { ...T.caption, color: C.secondary, whiteSpace: 'nowrap', flexShrink: 0 },
      // iOS switch: 51×31 track, 27px knob. The knob is always white, so the dark
      // theme no longer paints it with the page colour (a "hole" in the track).
      switchTrack: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'flex-start',
        boxSizing: 'border-box',
        width: '51px',
        height: '31px',
        padding: '2px',
        flexShrink: 0,
        marginLeft: 'auto',
        borderRadius: '999px',
        border: 'none',
        background: C.switchOff,
        cursor: 'pointer',
        transition: `background-color 220ms ${EASE}`,
      },
      switchTrackOn: { background: C.accent },
      switchDisabled: { opacity: 0.4, cursor: 'default' },
      switchKnob: {
        display: 'block',
        width: '27px',
        height: '27px',
        borderRadius: '999px',
        background: C.knob,
        boxShadow: '0 2px 4px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.04)',
      },
      chevronMuted: { color: C.secondary, opacity: 0.7 },
      listRow: { cursor: 'pointer' },
      subRow: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', minWidth: 0 },
      edgeList: {
        margin: '4px 0 0',
        padding: '8px 10px',
        listStyle: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        background: C.fill,
        borderRadius: '10px',
        width: '100%',
        boxSizing: 'border-box',
      },
      edge: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12.5px' },
      evidence: { ...T.caption, color: C.secondary, wordBreak: 'break-word' },
      warn: {
        display: 'flex',
        gap: '10px',
        padding: '12px 14px',
        borderRadius: '14px',
        background: 'color-mix(in srgb, var(--dsw-static-amber-500, #b7791f) 14%, transparent)',
        color: C.text,
        ...T.caption,
        flexShrink: 0,
      },
      errorBox: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '12px 14px',
        borderRadius: '14px',
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d14343) 12%, transparent)',
        color: C.text,
        ...T.caption,
        flexShrink: 0,
      },
      toast: {
        position: 'sticky',
        bottom: '16px',
        alignSelf: 'center',
        zIndex: 20,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        width: 'min(720px, calc(100% - 32px))',
        margin: '16px auto 0',
        padding: '12px 14px',
        borderRadius: '14px',
        background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary, #d14343) 14%, var(--dsw-alias-bg-layer-2, #fff))',
        border: `1px solid ${C.hairline}`,
        boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
        color: C.text,
        ...T.caption,
        flexShrink: 0,
      },
      toastBtn: {
        border: 'none',
        borderRadius: '8px',
        background: C.fillStrong,
        color: C.text,
        fontSize: '13px',
        fontWeight: 600,
        padding: '6px 12px',
        cursor: 'pointer',
        flexShrink: 0,
      },
      primary: {
        border: 'none',
        borderRadius: '10px',
        background: C.invertedFill,
        color: C.invertedText,
        fontSize: '13px',
        fontWeight: 600,
        padding: '8px 16px',
        cursor: 'pointer',
        flexShrink: 0,
      },
      skeleton: { height: '14px', borderRadius: '6px', background: C.fill, flexShrink: 0 },
      // Quiet one-line note for "written to cordis.patch.yml, applies next start".
      notice: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        alignSelf: 'center',
        margin: '10px auto 0',
        padding: '6px 12px',
        borderRadius: '999px',
        background: C.fill,
        color: C.secondary,
        ...T.caption,
        flexShrink: 0,
      },
      empty: { ...T.caption, color: C.secondary, padding: '14px 16px' },
      // Small text button for row-level actions (vault moves); no fill, so it
      // reads as a link next to the row title instead of a second control.
      linkBtn: {
        border: 'none',
        background: 'transparent',
        color: C.accent,
        fontSize: '13px',
        fontWeight: 600,
        padding: '4px 6px',
        borderRadius: '8px',
        cursor: 'pointer',
        flexShrink: 0,
        whiteSpace: 'nowrap',
      },
      linkBtnDisabled: { opacity: 0.4, cursor: 'default' },
      rowActions: { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', padding: '6px 16px 2px', flexShrink: 0 },
      spinner: {
        width: '16px',
        height: '16px',
        borderRadius: '999px',
        border: `2px solid ${C.fillStrong}`,
        borderTopColor: C.accent,
        flexShrink: 0,
      },
      groupDir: { ...T.mono, color: C.secondary, wordBreak: 'break-all' },
    }

    /**
     * Pseudo-states and motion. Inline styles cannot express :hover,
     * :focus-visible or a media query, so the panel ships one stylesheet.
     */
    const STYLES = `
.inv-row { -webkit-tap-highlight-color: transparent; }
.inv-row[data-interactive="true"] { transition: background-color 120ms ease; }
@media (hover: hover) {
  .inv-row[data-interactive="true"]:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 8%, transparent); }
}
.inv-row[data-interactive="true"]:active { background: color-mix(in srgb, var(--dsw-alias-label-secondary, #6b7280) 14%, transparent); }
.inv-switch:active > span { transform: scale(0.94); }
@media (hover: hover) {
  .inv-hide:hover { color: var(--dsw-alias-label-primary, #111827); opacity: 1; }
}
.inv-switch, .inv-btn, .inv-seg-btn, .inv-row { outline: none; }
.inv-switch:focus-visible, .inv-btn:focus-visible, .inv-seg-btn:focus-visible, .inv-row[data-interactive="true"]:focus-visible {
  outline: 3px solid color-mix(in srgb, var(--dsw-alias-button-info-fill, #4176e6) 45%, transparent);
  outline-offset: 2px;
  border-radius: 10px;
}
.inv-search-wrap { transition: background-color 160ms ease, box-shadow 160ms ease; }
.inv-search-wrap:focus-within {
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dsw-alias-button-info-fill, #4176e6) 35%, transparent);
}
.inv-section-body { animation: inv-section-in 200ms ${EASE}; }
@keyframes inv-section-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.inv-spin { animation: inv-spin 720ms linear infinite; }
@keyframes inv-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .inv-row, .inv-switch, .inv-switch > span, .inv-seg-btn, .inv-search-wrap { transition-duration: 0ms !important; }
  .inv-section-body { animation: none; }
  .inv-spin { animation-duration: 1.6s; }
}
@media (prefers-reduced-transparency: reduce) {
  .inv-nav { background: var(--dsw-alias-bg-base, #fff) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
}
@media (prefers-contrast: more) {
  .inv-card { border-color: currentColor !important; }
}
`

    function installStyles() {
      if (typeof document === 'undefined' || document === null) return () => {}
      const existing = document.querySelector('style[data-dsh-inventory]')
      if (existing !== null) return () => {}
      const node = document.createElement('style')
      node.setAttribute('data-dsh-inventory', '')
      node.textContent = STYLES
      document.head.appendChild(node)
      return () => {
        if (node.parentNode !== null) node.parentNode.removeChild(node)
      }
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

    /**
     * First-party entries shipped inside the DSH app: bundles from the
     * `@deepseek-ai/` scope, loader rows for those modules, and the builtin
     * tools registered by the app itself. The panel exists to answer "what did
     * I install", so these are hidden by default and the toolbar has one
     * switch to bring them back.
     */
    const FIRST_PARTY_SCOPE = '@deepseek-ai/'

    const isOfficialEntry = (item) => String(item?.name ?? '').startsWith(FIRST_PARTY_SCOPE)

    const isOfficialTool = (item) => {
      const owner = item?.owner ?? {}
      if (owner.kind === 'builtin') return true
      return owner.kind === 'plugin' && String(owner.ref ?? '').startsWith(FIRST_PARTY_SCOPE)
    }

    /** True when the item should be listed given the "show official" switch. */
    function listed(item, isOfficial, showOfficial) {
      return showOfficial === true || isOfficial(item) !== true
    }

    /**
     * Enabled rows first, then by label. `sort` is stable, so rows that tie on
     * both keys keep the order the host sent.
     */
    function sortByEnabled(list, isOn, label) {
      return [...list].sort((left, right) => {
        const delta = (isOn(right) ? 1 : 0) - (isOn(left) ? 1 : 0)
        return delta !== 0 ? delta : label(left).localeCompare(label(right))
      })
    }

    /** Enter/Space activation for rows that are buttons in spirit. */
    function activate(run) {
      return (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        run()
      }
    }

    function Icon({ name, size = 18, style }) {
      const stroke = { stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' }
      const paths = {
        chevronLeft: [h('path', { key: 'p', d: 'M15 5l-7 7 7 7', ...stroke })],
        chevronRight: [h('path', { key: 'p', d: 'M9 5l7 7-7 7', ...stroke })],
        chevronDown: [h('path', { key: 'p', d: 'M5 9l7 7 7-7', ...stroke })],
        refresh: [
          h('path', { key: 'a', d: 'M20 11a8 8 0 1 0-2.3 5.6', ...stroke }),
          h('path', { key: 'b', d: 'M20 4.5V11h-6.5', ...stroke }),
        ],
        search: [
          h('circle', { key: 'c', cx: 11, cy: 11, r: 6.5, ...stroke }),
          h('path', { key: 'l', d: 'M16 16l4.5 4.5', ...stroke }),
        ],
        alert: [
          h('path', { key: 't', d: 'M12 4.5 21 20H3L12 4.5Z', ...stroke }),
          h('path', { key: 'i', d: 'M12 10v4.5', ...stroke }),
          h('circle', { key: 'd', cx: 12, cy: 17.5, r: 0.9, fill: 'currentColor', stroke: 'none' }),
        ],
        lock: [
          h('rect', { key: 'b', x: 5.5, y: 10.5, width: 13, height: 9.5, rx: 2.5, ...stroke }),
          h('path', { key: 's', d: 'M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5', ...stroke }),
        ],
        eyeOff: [
          h('path', { key: 'e', d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z', ...stroke }),
          h('path', { key: 's', d: 'M4.5 4.5l15 15', ...stroke }),
        ],
      }
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
          style: { flexShrink: 0, ...style },
        },
        ...(paths[name] ?? []),
      )
    }

    /** A tinted capsule. `dot` adds a status dot; text stays the label colour. */
    function Badge({ label, tone, dot }) {
      const dotColor = tone === 'success' ? C.success : tone === 'danger' ? C.danger : tone === 'warning' ? C.warning : null
      return h(
        'span',
        { style: S.badge },
        dot && dotColor !== null ? h('span', { style: { ...S.dot, background: dotColor } }) : null,
        label,
      )
    }

    function Section({ t, title, hint, count, open, onToggle, onHide, children }) {
      const body = children === undefined || children === null ? [] : Array.isArray(children) ? children : [children]
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'relative' } },
        h(
          'button',
          {
            type: 'button',
            style: S.sectionHead,
            'aria-expanded': open ? 'true' : 'false',
            className: 'inv-btn',
            onClick: onToggle,
          },
          h('span', { style: { ...S.chev, transform: open ? 'rotate(0deg)' : 'rotate(-90deg)' } }, h(Icon, { name: 'chevronDown', size: 16 })),
          h('span', { style: S.sectionTitle }, title),
          h('span', { style: S.sectionCount }, `${count} ${t('wsItemCount')}`),
          hint ? h('span', { style: { ...S.sectionHint, ...(onHide ? { paddingRight: '28px' } : {}) } }, hint) : null,
        ),
        // A sibling, not a child: the header is a button, and a button inside a
        // button is invalid markup.
        onHide
          ? h(
              'button',
              {
                type: 'button',
                className: 'inv-btn inv-hide',
                'aria-label': t('hideSection'),
                title: t('hideSection'),
                style: S.hideBtn,
                onClick: (event) => {
                  if (event !== undefined && event !== null) event.stopPropagation()
                  onHide()
                },
              },
              h(Icon, { name: 'eyeOff', size: 15 }),
            )
          : null,
        open ? h('div', { style: S.card, className: 'inv-section-body' }, ...body) : null,
      )
    }

    function sourceLabel(t, source) {
      if (source === 'project-dsh') return t('wsSourceProjectDsh')
      if (source === 'project-agents') return t('wsSourceProjectAgents')
      if (source === 'user-dsh') return t('wsSourceUserDsh')
      if (source === 'user-agents') return t('wsSourceUserAgents')
      if (source === 'custom') return t('wsSourceCustom')
      if (source === 'bundled') return t('wsSourceBundled')
      if (source === 'vault') return t('vaultScope')
      if (source === 'runtime') return t('wsRuntimeOnly')
      return source
    }

    /**
     * One switch per row. A `role="switch"` button drawn as a 51×31 iOS track
     * with a 27px knob; the knob slides with a transform so the state change is
     * continuous, and stays white in both themes.
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
          className: 'inv-switch',
          style: { ...S.switchTrack, ...(isOn ? S.switchTrackOn : {}), ...(isDisabled ? S.switchDisabled : {}) },
          onClick: (event) => {
            // Rows are expand buttons themselves: a switch click must not toggle
            // the row underneath it.
            if (event !== undefined && event !== null) event.stopPropagation()
            if (isDisabled) return
            onToggle()
          },
          onKeyDown: (event) => {
            if (event !== undefined && event !== null) event.stopPropagation()
          },
        },
        h('span', {
          style: { ...S.switchKnob, transform: isOn ? 'translateX(20px)' : 'translateX(0px)', transition: `transform 260ms ${EASE}` },
        }),
      )
    }

    /**
     * Text button that lives inside an expandable row. It must swallow click and
     * key events, or the row toggles underneath it.
     */
    function RowButton({ label, disabled, onClick }) {
      const isDisabled = disabled === true
      return h(
        'button',
        {
          type: 'button',
          className: 'inv-btn',
          style: { ...S.linkBtn, ...(isDisabled ? S.linkBtnDisabled : {}) },
          disabled: isDisabled,
          onClick: (event) => {
            if (event !== undefined && event !== null) event.stopPropagation()
            if (isDisabled) return
            onClick()
          },
          onKeyDown: (event) => {
            if (event !== undefined && event !== null) event.stopPropagation()
          },
        },
        label,
      )
    }

    /** Workspace list: one grouped card, one row per workspace. */
    function WorkspaceList({ t, data, onEnter, query }) {
      const all = Array.isArray(data?.workspaces) ? data.workspaces : []
      const q = typeof query === 'string' ? query.trim().toLowerCase() : ''
      const workspaces = all.filter((workspace) => q.length === 0 || `${workspace.title} ${workspace.path}`.toLowerCase().includes(q))
      if (data?.workspaceRegistryAvailable === false) return h('div', { style: S.empty }, t('wsUnavailable'))
      if (all.length === 0) return h('div', { style: S.empty }, t('wsNoWorkspaces'))
      if (workspaces.length === 0) return h('div', { style: S.empty }, t('emptySearch'))
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', flexShrink: 0, paddingTop: '8px' } },
        h(
          'div',
          { style: { ...S.sectionHead, cursor: 'default', paddingBottom: '8px' } },
          h('span', { style: S.sectionTitle }, t('wsWorkspaces')),
          h('span', { style: S.sectionCount }, `${workspaces.length}`),
        ),
        h(
          'div',
          { style: S.card, role: 'list' },
          ...workspaces.map((workspace, index) => {
            const counts = workspace.counts ?? {}
            const shared = Number(counts.sharedSkills ?? 0)
            const meta = [
              `MCP ${counts.declared ?? 0}`,
              `${t('skills')} ${counts.projectSkills ?? 0}`,
              shared > 0 ? `${t('wsShareCount')} ${shared}` : null,
            ]
              .filter(Boolean)
              .join(' · ')
            const open = () => onEnter(workspace.id)
            return h(
              'div',
              {
                key: `ws-${workspace.id}`,
                role: 'button',
                tabIndex: 0,
                'aria-label': `${t('wsOpen')} ${workspace.title}`,
                className: 'inv-row',
                'data-interactive': 'true',
                style: { ...S.row, ...(index === workspaces.length - 1 ? S.rowLast : {}), ...S.listRow },
                onClick: open,
                onKeyDown: activate(open),
              },
              h(
                'div',
                { style: S.rowMain },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 } },
                  h('span', { style: { ...T.listTitle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, workspace.title),
                  workspace.default === true ? h(Badge, { label: t('wsDefault'), tone: 'success', dot: true }) : null,
                  workspace.available === false ? h(Badge, { label: t('wsUnavailableDir'), tone: 'danger', dot: true }) : null,
                ),
                h('span', { style: S.rowMono }, workspace.path),
                h('span', { style: S.rowSub }, meta),
              ),
              h(Icon, { name: 'chevronRight', size: 16, style: S.chevronMuted }),
            )
          }),
        ),
      )
    }

    /**
     * Workspace detail: MCP and skill sets of one workspace, one row each with a
     * switch on the right. Rows that cannot be switched state why instead of
     * showing a disabled switch that still looks "on".
     */
    function WorkspaceDetail(props) {
      const { t, data, workspace, busy, onAssign, query } = props
      const globalMcp = Array.isArray(data?.globalMcp) ? data.globalMcp : []
      const workspaces = Array.isArray(data?.workspaces) ? data.workspaces : []
      const installedMcp = Array.isArray(data?.mcp) ? data.mcp : []
      const installedSkills = Array.isArray(data?.skills) ? data.skills : []
      const blocked = typeof busy === 'string' && busy.length > 0
      const q = typeof query === 'string' ? query.trim().toLowerCase() : ''

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

      const mcpRows = sortByEnabled(
        mcpNames
          .map((name) => {
            const declaredEntry = declared.find((server) => server?.name === name)
            const installedEntry = installedMcp.find((item) => item?.server === name)
            const transport = declaredEntry?.transport ?? installedEntry?.transport
            const detail = declaredEntry?.detail ?? installedEntry?.command ?? installedEntry?.url
            const isGlobal = globalMcp.includes(name)
            const isDeclared = declaredEntry !== undefined
            // A globally registered server already reaches every workspace: there
            // is nothing to switch off, so the row states the fact instead of
            // offering a disabled control.
            const locked = !isDeclared && isGlobal
            const isOn = isDeclared || isGlobal
            const sub = [transport, detail].filter((part) => typeof part === 'string' && part.length > 0).join(' · ')
            return {
              name,
              isOn,
              locked,
              isDeclared,
              declaredEntry,
              sub,
              search: `${name} ${sub} ${locked ? t('wsGlobalNote') : ''}`.toLowerCase(),
            }
          })
          .filter((row) => q.length === 0 || row.search.includes(q)),
        (row) => row.isOn,
        (row) => row.name,
      )

      const mcpNodes = mcpRows.map((row, index) =>
        h(
          'div',
          {
            key: `ws-mcp-${workspace.id}-${row.name}`,
            style: { ...S.row, ...(index === mcpRows.length - 1 ? S.rowLast : {}) },
          },
          h(
            'div',
            { style: S.rowMain },
            h('span', { style: S.rowTitle }, row.name),
            row.sub.length > 0 ? h('span', { style: S.rowMono }, row.sub) : null,
            row.locked ? h('span', { style: S.rowSub }, t('wsGlobalNote')) : null,
          ),
          row.declaredEntry?.mountedAs && row.declaredEntry.mountedAs !== row.name
            ? h(Badge, { label: `${t('wsMountedAs')} ${row.declaredEntry.mountedAs}`, tone: 'success', dot: true })
            : null,
          row.locked
            ? h('span', { style: S.lockLabel }, h(Icon, { name: 'lock', size: 14 }), ` ${t('wsGlobalMounted')}`)
            : h(Switch, {
                checked: row.isOn,
                disabled: blocked,
                label: row.name,
                stateLabel: row.isOn ? t('wsSwitchOn') : t('wsSwitchOff'),
                onToggle: () => onAssign({ workspace, kind: 'mcp', action: row.isDeclared ? 'remove' : 'add', name: row.name }),
              }),
          blocked && busy.includes('|mcp|') && busy.endsWith(`|${row.name}`) ? h('span', { style: S.spinner, className: 'inv-spin' }) : null,
        ),
      )

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
      const allSkills = [...skillsByName.values()]
      const skillRows = sortByEnabled(
        allSkills
          .map((skill) => {
            const assigned = skill.assigned === true
            const linked = skill.linked === true
            const shadowed = skill.shadowed === true || skill.disabled === true
            // A runtime-registered skill has no directory to link into, and a
            // hand-copied directory is not ours to unlink: both stay read-only.
            const runtimeOnly = skill.source === 'runtime'
            // A skill on a machine-wide root already reaches every workspace, and
            // linking it into the project root would only duplicate it (rank 100
            // shadows rank 400). A globally shadowed skill stays shadowed too: the
            // link points at the same SKILL.md. So only a vaulted skill — which no
            // root scans — needs a workspace switch. The host enforces the same
            // rule on POST /inventory/workspace.
            const globalReachable = skill.global === true && skill.vaulted !== true && !runtimeOnly
            const enabled = assigned || (globalReachable && !shadowed)
            const locked = assigned ? !linked : globalReachable || runtimeOnly
            const reason = assigned
              ? linked
                ? null
                : t('wsNotLinked')
              : globalReachable
                ? shadowed
                  ? t('wsGlobalSkillOff')
                  : t('wsGlobalSkillOn')
                : runtimeOnly
                  ? t('wsRuntimeOnly')
                  : null
            const note = assigned
              ? linked
                ? globalReachable
                  ? t('wsDuplicateNote')
                  : null
                : t('wsNotLinkedNote')
              : globalReachable
                ? shadowed
                  ? t('wsGlobalSkillOffNote')
                  : t('wsGlobalSkillOnNote')
                : runtimeOnly
                  ? t('wsRuntimeNote')
                  : null
            return {
              skill,
              assigned,
              enabled,
              shadowed,
              locked,
              reason,
              note,
              search: `${skill.name} ${skill.description ?? ''} ${skill.source ?? ''}`.toLowerCase(),
            }
          })
          .filter((row) => q.length === 0 || row.search.includes(q)),
        (row) => row.enabled,
        (row) => String(row.skill.name),
      )

      const skillNodes = skillRows.map((row, index) => {
        const skill = row.skill
        return h(
          'div',
          { key: `ws-skill-${workspace.id}-${skill.name}`, style: { ...S.row, ...(index === skillRows.length - 1 ? S.rowLast : {}) } },
          h(
            'div',
            { style: S.rowMain },
            h(
              'div',
              { style: S.subRow },
              h('span', { style: S.rowTitle }, skill.name),
              h(Badge, { label: skill.source ? sourceLabel(t, skill.source) : 'disk' }),
              row.shadowed ? h(Badge, { label: t('shadowed'), tone: 'warning', dot: true }) : null,
            ),
            row.note ? h('span', { style: S.rowSub }, row.note) : null,
            skill.description ? h('span', { style: S.note }, skill.description) : null,
          ),
          row.locked
            ? h('span', { style: S.lockLabel }, h(Icon, { name: 'lock', size: 14 }), ` ${row.reason}`)
            : h(Switch, {
                checked: row.assigned,
                disabled: blocked,
                label: skill.name,
                stateLabel: row.assigned ? t('wsSwitchOn') : t('wsSwitchOff'),
                onToggle: () => onAssign({ workspace, kind: 'skill', action: row.assigned ? 'remove' : 'add', name: skill.name }),
              }),
        )
      })

      const declaredOn = mcpNames.filter((name) => declared.some((server) => server?.name === name)).length
      const globalCount = mcpNames.filter((name) => globalMcp.includes(name) && !declared.some((server) => server?.name === name)).length
      // "On" for a workspace means the model can reach it: a project link, or a
      // machine-wide root that is not shadowed. Locked rows count too, or the
      // header would read 0/N on a workspace with every global skill available.
      const reachable = (skill) =>
        skill.assigned === true ||
        (skill.global === true &&
          skill.vaulted !== true &&
          skill.source !== 'runtime' &&
          skill.shadowed !== true &&
          skill.disabled !== true)
      const skillsOn = allSkills.filter(reachable).length
      const globalSkills = allSkills.filter((skill) => skill.assigned !== true && reachable(skill)).length
      const mcpStatus =
        workspace.mcp?.status === 'invalid'
          ? `${t('wsInvalidDeclaration')}: ${workspace.mcp.error ?? ''}`
          : workspace.mcp?.status === 'missing'
            ? t('wsNoDeclaration')
            : undefined
      const mcpHint = [`${t('wsSwitchOn')} ${declaredOn}`, globalCount > 0 ? `${t('wsGlobalShort')} ${globalCount}` : null, mcpStatus]
        .filter(Boolean)
        .join(' · ')
      const skillsHint = [`${t('wsSwitchOn')} ${skillsOn}/${allSkills.length}`, globalSkills > 0 ? `${t('wsGlobalShort')} ${globalSkills}` : null]
        .filter(Boolean)
        .join(' · ')

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', flexShrink: 0 } },
        h(
          Section,
          {
            t,
            title: t('wsMcpSection'),
            hint: mcpHint,
            count: mcpRows.length,
            open: props.mcpOpen,
            onToggle: props.onToggleMcp,
          },
          mcpRows.length === 0
            ? h('div', { key: 'mcp-empty', style: S.empty }, q.length > 0 ? t('emptySearch') : t('noMcp'))
            : mcpNodes,
        ),
        h(
          Section,
          {
            t,
            title: t('wsSkillsSection'),
            hint: skillsHint,
            count: skillRows.length,
            open: props.skillsOpen,
            onToggle: props.onToggleSkills,
          },
          skillRows.length === 0
            ? h('div', { key: 'sk-empty', style: S.empty }, q.length > 0 ? t('emptySearch') : t('noSkills'))
            : skillNodes,
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
      const [status, setStatus] = React.useState('loading')
      const [data, setData] = React.useState(null)
      const [message, setMessage] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [wsQuery, setWsQuery] = React.useState('')
      // Official DSH bundles, loader rows and builtin tools are noise for
      // "what did I install"; hidden until this switch is on.
      const [showOfficial, setShowOfficial] = React.useState(false)
      const [open, setOpen] = React.useState({
        packages: true,
        rows: false,
        mcp: true,
        skills: false,
        tools: false,
      })
      const [expanded, setExpanded] = React.useState({})
      // Two-level navigation: 'global' is the overview, 'workspaces' the list,
      // 'workspace' the detail of `currentWorkspace` (a workspace id).
      const [view, setView] = React.useState('global')
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
      // The eye button on a section header hides that section; the chip in the
      // controls brings it back, so hiding is never a dead end.
      const [hiddenSections, setHiddenSections] = React.useState(readHiddenSections())
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
      const setSectionHidden = (key, hidden) => {
        const next = { ...hiddenSections }
        if (hidden === true) next[key] = true
        else delete next[key]
        setHiddenSections(next)
        writeHiddenSections(next)
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

      if (status === 'loading' && data === null) {
        return h(
          'div',
          { style: S.root },
          h('div', { style: S.nav, className: 'inv-nav' }, backToChat, h('span', { style: S.navTitle }, t('title'))),
          h(
            'div',
            { style: S.page },
            h('div', { style: S.hero }, h('h3', { style: S.h1 }, t('title')), h('p', { style: S.subtitle }, t('loading'))),
            h('div', { style: { ...S.card, padding: '16px', display: 'flex', flexDirection: 'column', gap: '10px' } },
              h('div', { style: S.skeleton }),
              h('div', { style: { ...S.skeleton, width: '70%' } }),
              h('div', { style: { ...S.skeleton, width: '85%' } }),
            ),
          ),
        )
      }

      if (status === 'error' && data === null) {
        return h(
          'div',
          { style: S.root },
          h('div', { style: S.nav, className: 'inv-nav' }, backToChat, h('span', { style: S.navTitle }, t('title'))),
          h(
            'div',
            { style: S.page },
            h('div', { style: S.hero }, h('h3', { style: S.h1 }, t('title'))),
            h(
              'div',
              { style: S.errorBox },
              h(Icon, { name: 'alert', size: 18 }),
              h('span', { style: { flex: '1 1 auto' } }, `${t('error')} ${message ? `(${message})` : ''}`),
              h('button', { type: 'button', style: S.primary, onClick: () => load(true) }, t('retry')),
            ),
          ),
        )
      }

      const counts = data?.counts ?? {}
      const allPackages = data?.packages ?? []
      const allRows = data?.rows ?? []
      const allTools = data?.tools ?? []
      const packages = allPackages.filter((item) => listed(item, isOfficialEntry, showOfficial) && matches(q, item, FILTERS[0][1]))
      const rows = allRows.filter((item) => listed(item, isOfficialEntry, showOfficial) && matches(q, item, FILTERS[1][1]))
      const mcp = sortByEnabled(
        (data?.mcp ?? []).filter((item) => matches(q, item, FILTERS[2][1])),
        (item) => item.enabled === true,
        (item) => String(item.server ?? ''),
      )
      const skills = sortByEnabled(
        (data?.skills ?? []).filter((item) => matches(q, item, FILTERS[3][1])),
        (item) => item.disabled !== true,
        (item) => String(item.name ?? ''),
      )
      const tools = allTools.filter((item) => listed(item, isOfficialTool, showOfficial) && matches(q, item, FILTERS[4][1]))
      // An empty section that is empty *because everything in it is official*
      // needs its own message; "nothing installed" would be a lie.
      const hiddenPackages = showOfficial ? 0 : allPackages.filter(isOfficialEntry).length
      const hiddenRows = showOfficial ? 0 : allRows.filter(isOfficialEntry).length
      const hiddenTools = showOfficial ? 0 : allTools.filter(isOfficialTool).length
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
          style: { ...S.navTitle, opacity: scrolled ? 1 : 0, transition: 'opacity 180ms ease' },
          'aria-hidden': 'true',
        }, view === 'workspace' && activeWorkspace ? activeWorkspace.title : t('title')),
        h(
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

      const segmented = h(
        'div',
        { style: S.seg, role: 'group', 'aria-label': t('title') },
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': view === 'global' ? 'true' : 'false',
            style: { ...S.segBtn, ...(view === 'global' ? S.segBtnActive : {}) },
            className: 'inv-seg-btn',
            onClick: () => setView('global'),
          },
          t('wsOverview'),
        ),
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': view !== 'global' ? 'true' : 'false',
            style: { ...S.segBtn, ...(view !== 'global' ? S.segBtnActive : {}) },
            className: 'inv-seg-btn',
            onClick: () => setView('workspaces'),
          },
          t('wsWorkspaces'),
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
          className: 'inv-seg-btn',
          'aria-pressed': showOfficial ? 'true' : 'false',
          style: { ...S.chip, ...(showOfficial ? S.chipOn : {}) },
          title: t('officialHint'),
          onClick: () => setShowOfficial((prev) => !prev),
        },
        showOfficial ? t('hideOfficial') : t('showOfficial'),
      )

      const hiddenSkillsChip =
        hiddenSections.skills === true
          ? h(
              'button',
              {
                type: 'button',
                className: 'inv-seg-btn',
                style: S.chip,
                title: t('showHiddenSkills'),
                onClick: () => setSectionHidden('skills', false),
              },
              t('showHiddenSkills'),
            )
          : null

      const stats = h(
        'div',
        { style: { ...S.card, ...S.stats } },
        ...[
          [t('packages'), packages.length],
          [t('mcp'), mcp.length],
          [t('skills'), skills.length],
          [t('tools'), tools.length],
          [t('edges'), counts.edges ?? 0],
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
          { key: 'rows', t, title: t('rows'), hint: t('rowsHint'), count: rows.length, open: open.rows, onToggle: () => toggle('rows') },
          rows.length === 0
            ? [h('div', { key: 'rows-empty', style: S.empty }, q.length > 0 ? t('emptySearch') : hiddenRows > 0 ? t('officialHidden') : '-')]
            : rows.map((item, index) =>
                h(
                  'div',
                  { key: `row-${item.id}`, style: { ...S.row, ...(index === rows.length - 1 ? S.rowLast : {}) } },
                  h('div', { style: S.rowMain }, h('span', { style: S.rowTitleMono }, item.id), item.name ? h('span', { style: S.rowSub }, item.name) : null),
                  h(Badge, { label: item.enabled ? t('enabled') : t('disabled'), tone: item.enabled ? 'success' : 'danger', dot: true }),
                  h(Badge, {
                    label: fiberLabel(t, item.fiberPhase),
                    tone: item.fiberPhase === 'failed' ? 'danger' : item.fiberPhase === 'active' ? 'success' : undefined,
                  }),
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
                    h('span', { style: { ...S.chev, transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' } }, h(Icon, { name: 'chevronDown', size: 15 })),
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
        hiddenSections.skills === true
          ? null
          : h(
              Section,
              { key: 'skills', t, title: t('skills'), hint: `${t('skillsHint')} · ${t('globalHint')}`, count: skills.length, open: open.skills, onToggle: () => toggle('skills'), onHide: () => setSectionHidden('skills', true) },
          skills.length === 0
            ? [h('div', { key: 'skills-empty', style: S.empty }, q.length > 0 ? t('emptySearch') : t('noSkills'))]
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
                // A runtime registration has no file to rewrite; anything else
                // that cannot be switched is a project-scoped skill.
                const blockedLabel = item.disabledReason === 'runtime' ? t('toggleUnavailableRuntime') : t('toggleUnavailableProject')
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
                    h('span', { style: { ...S.chev, transform: isOpen ? 'rotate(0deg)' : 'rotate(-90deg)' } }, h(Icon, { name: 'chevronDown', size: 15 })),
                    h(
                      'div',
                      { style: S.rowMain },
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
                    vaulted ? null : rowLocked ? h(Badge, { label: blockedLabel, tone: 'warning' }) : null,
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
        h(
          Section,
          { key: 'tools', t, title: t('tools'), hint: t('toolsHint'), count: tools.length, open: open.tools, onToggle: () => toggle('tools') },
          tools.length === 0
            ? [h('div', { key: 'tools-empty', style: S.empty }, q.length > 0 ? t('emptySearch') : hiddenTools > 0 ? t('officialHidden') : t('noTools'))]
            : tools.map((item, index) => {
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
                  { key: `tool-${item.name}`, style: { ...S.row, ...(index === tools.length - 1 ? S.rowLast : {}) } },
                  h('div', { style: S.rowMain }, h('span', { style: S.rowTitleMono }, item.name)),
                  h(Badge, { label: `${ownerLabel}${item.owner.ref ? `: ${item.owner.ref}` : ''}` }),
                  item.deferred ? h(Badge, { label: t('deferred'), tone: 'warning', dot: true }) : null,
                )
              }),
        ),
      ]

      return h(
        'div',
        {
          style: S.root,
          onScroll: (event) => {
            const next = event.currentTarget.scrollTop > 24
            if (next !== scrolled) setScrolled(next)
          },
        },
        nav,
        h(
          'div',
          { style: S.page },
          h(
            'div',
            { style: S.hero },
            h('h3', { style: S.h1 }, view === 'workspace' && activeWorkspace ? activeWorkspace.title : t('title')),
            view === 'workspace' && activeWorkspace
              ? h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                  h('span', { style: S.groupDir }, activeWorkspace.path),
                  activeWorkspace.default === true ? h(Badge, { label: t('wsDefault'), tone: 'success', dot: true }) : null,
                  activeWorkspace.available === false ? h(Badge, { label: t('wsUnavailableDir'), tone: 'danger', dot: true }) : null,
                )
              : h('p', { style: S.subtitle }, t('subtitle')),
          ),
          h('div', { style: S.controls }, segmented, view === 'global' ? officialToggle : null, view === 'global' ? hiddenSkillsChip : null, stamp),
          view === 'global'
            ? searchField(query, setQuery, t('search'), t('search'))
            : showList
              ? searchField(wsQuery, setWsQuery, t('wsSearchList'), t('wsSearchList'))
              : searchField(wsQuery, setWsQuery, t('wsSearch'), t('wsSearch')),
          view === 'global' ? stats : null,
          view === 'global' && warnings.length > 0
            ? h(
                'div',
                { style: { ...S.warn, marginTop: '14px' } },
                h(Icon, { name: 'alert', size: 18 }),
                h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
                  h('strong', { style: { fontWeight: 600 } }, t('warnings')),
                  ...warnings.slice(0, 8).map((warning, index) => h('div', { key: `w-${index}` }, warning.message ?? warning.code)),
                ),
              )
            : null,
          view === 'global'
            ? overviewSections
            : showList
              ? h(WorkspaceList, { key: 'ws-list', t, data, onEnter: openWorkspace, query: wsQuery })
              : h(WorkspaceDetail, {
                  key: 'ws-detail',
                  t,
                  data,
                  workspace: activeWorkspace,
                  busy: wsBusy,
                  query: wsQuery,
                  onAssign: runWorkspaceAction,
                  mcpOpen: detailOpen.mcp,
                  skillsOpen: detailOpen.skills,
                  onToggleMcp: () => toggleDetail('mcp'),
                  onToggleSkills: () => toggleDetail('skills'),
                }),
          wsError.length > 0
            ? h(
                'div',
                { style: S.toast, role: 'alert' },
                h(Icon, { name: 'alert', size: 18 }),
                h('span', { style: { flex: '1 1 auto' } }, `${t('wsActionFailed')}: ${wsError}`),
                h('button', { type: 'button', style: S.toastBtn, onClick: () => setWsError('') }, t('wsDismiss')),
              )
            : null,
          globalError.length > 0
            ? h(
                'div',
                { style: S.toast, role: 'alert' },
                h(Icon, { name: 'alert', size: 18 }),
                h('span', { style: { flex: '1 1 auto' } }, `${t('globalToggleFailed')}: ${globalError}`),
                h('button', { type: 'button', style: S.toastBtn, onClick: () => setGlobalError('') }, t('wsDismiss')),
              )
            : null,
          globalNotice.length > 0 ? h('div', { style: S.notice, role: 'status' }, globalNotice) : null,
          vaultError.length > 0
            ? h(
                'div',
                { style: S.toast, role: 'alert' },
                h(Icon, { name: 'alert', size: 18 }),
                h('span', { style: { flex: '1 1 auto' } }, `${t('vaultFailed')}: ${vaultError}`),
                h('button', { type: 'button', style: S.toastBtn, onClick: () => setVaultError('') }, t('wsDismiss')),
              )
            : null,
        ),
      )
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-inventory: dictionaries')
      ctx.effect(installStyles, 'dsh-inventory: styles')
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
