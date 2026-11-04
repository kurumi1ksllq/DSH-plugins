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
    const SYNC_ROUTE = '/inventory/sync'
    const SYNC_CONFIG_ROUTE = '/inventory/sync/config'
    const SYNC_PREVIEW_ROUTE = '/inventory/sync/preview'
    const SYNC_APPLY_ROUTE = '/inventory/sync/apply'

    // Skills hidden one by one from the list, by name. Shared by the overview
    // and every workspace page, and remembered across panel opens.
    const HIDDEN_SKILLS_KEY = 'dsh-inventory:hidden-skills'

    function readHiddenSkills() {
      try {
        const stored = JSON.parse(window.localStorage.getItem(HIDDEN_SKILLS_KEY) ?? '[]')
        return Array.isArray(stored) ? stored.filter((name) => typeof name === 'string') : []
      } catch {
        // No localStorage (test harness, private mode) or garbage stored: hide nothing.
        return []
      }
    }

    function writeHiddenSkills(names) {
      try {
        window.localStorage.setItem(HIDDEN_SKILLS_KEY, JSON.stringify(names))
      } catch {
        // Hiding still works for this panel even when it cannot be remembered.
      }
    }

    const zh = {
      tab: '工具管理',
      panel: '工具管理',
      back: '返回对话',
      title: '工具管理',
      subtitle: '插件包、MCP 服务器与技能，以及每个工作区开了哪些 MCP 与技能。',
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
      mcp: 'MCP 服务器',
      mcpHint: '由 @deepseek-ai/dsh-mcp-client 条目提供',
      skills: '技能',
      skillsHint: '磁盘扫描（含被屏蔽的桩）+ 运行时注册',
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
      noSkills: '没有发现技能。',
      hiddenSkillsEmpty: '技能都隐藏了。工具栏的「显示已隐藏」可以把它们放出来。',
      noMcp: '没有配置 MCP 服务器。',
      noPackages: 'profile 没有声明插件。',
      showOfficial: '显示官方',
      hideOfficial: '隐藏官方',
      officialHidden: '官方条目已隐藏。',
      officialHint: '官方 = @deepseek-ai/* 插件包',
      hideSkill: '隐藏此技能',
      unhideSkill: '取消隐藏',
      showHiddenSkills: '显示已隐藏',
      hiddenSkillsHint: '显示已隐藏的技能，再点一次收起',
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
      wsGlobalDuplicate: '重复挂载',
      wsGlobalShort: '全局',
      wsGlobalSkillsFold: '全局已可用',
      wsGlobalSkillsFoldHint: '这些技能在所有工作区都已加载，开关在总览页',
      wsGlobalNote: '对所有工作区生效',
      wsNotLinked: '非本页链接',
      wsNotLinkedNote: '手工复制，未由本页创建',
      wsGlobalSkillOn: '全局可用',
      wsGlobalSkillOnNote: '已对所有工作区生效，在总览里关闭',
      wsGlobalSkillOff: '全局已禁用',
      wsGlobalSkillOffNote: '在总览里开启后所有工作区可用',
      wsDuplicateNote: '与全局根上的同名技能重复，可移除链接',
      wsHiddenShort: '已隐藏',
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
      updateBadge: '可更新',
      updateCurrent: '已是最新',
      updateTo: '更新到 {version}',
      updateConfirm: '更新会推进整份插件仓库并立即重新加载，确定继续？',
      updateRunning: '正在更新…',
      updateDone: '已更新',
      updateFailed: '更新失败',
      syncView: '同步',
      syncTitle: '跨机同步',
      syncSubtitle: '从清单仓库看差异，勾哪项装哪项。发布时只上传插件/MCP/skill 清单，密钥与本机路径会被脱掉。',
      syncNotConfigured: '还没配置清单仓库。填入 owner/repo 或仓库地址，保存后再刷新。',
      syncMode: '同步方式',
      syncModeGithub: 'GitHub（直连，海外稳定）',
      syncModeGitee: 'Gitee（国内直连）',
      syncModeHttp: '自建直连（http 直链）',
      syncModeHttpHint: '填一个可直连的 http(s) 文件地址：GET 读取清单，PUT 发布清单（Bearer token 鉴权）。',
      syncRepo: '清单仓库',
      syncRepoPlaceholder: 'owner/repo 或 https://github.com/owner/repo',
      syncRepoPlaceholderHttp: 'http://服务器地址/manifests/dsh-manifest.json',
      syncRepoUrl: '插件仓库地址（可选）',
      syncRepoUrlPlaceholder: 'https://gitee.com/you/DSH-plugins.git（新机器自动克隆用）',
      syncRef: '分支',
      syncPath: '清单文件路径',
      syncToken: 'GitHub token',
      syncTokenSet: '已保存（不会回显）',
      syncTokenPlaceholder: '粘贴一个有 contents:write 权限的 token',
      syncTokenHint: '只用来写清单仓库，存在 $DSH_HOME/plugin-sync.json，不会被发布。',
      syncSave: '保存配置',
      syncSaved: '配置已保存',
      syncSaveFailed: '保存配置失败',
      syncRefresh: '读取清单',
      syncLoading: '正在读取清单…',
      syncCanPublish: '可发布',
      syncCanPull: '可拉取',
      syncNo: '不可用',
      syncManifestMeta: '清单',
      syncGeneratedAt: '清单生成于',
      syncFleet: '舰队清单：{count} 台机器 · 本机 {machine}',
      syncFleetSelf: '本机清单（舰队格式升级将在下次发布时完成）',
      syncViaRaw: 'raw.githubusercontent',
      syncViaApi: 'GitHub API',
      syncViaGit: 'git clone',
      syncStatusMissing: '缺失',
      syncStatusOutdated: '版本不同',
      syncStatusBlocked: '本机不适用',
      syncStatusDisabled: '已停用',
      syncStatusCurrent: '已一致',
      syncStatusLocalOnly: '本机独有',
      syncStatusSkip: '跳过',
      syncSelectable: '可装',
      syncSelectAll: '全选可装项',
      syncClearAll: '清空',
      syncInstall: '安装选中',
      syncInstalling: '正在安装…',
      syncInstalled: '已安装 {count} 项',
      syncInstallFailed: '安装失败',
      syncPublish: '发布本机清单（合并入舰队）',
      syncPublishing: '正在发布…',
      syncPublished: '已发布',
      syncPublishUnchanged: '内容没变，未产生提交',
      syncPublishFailed: '发布失败',
      syncPreview: '预览清单',
      syncPreviewTitle: '将发布的内容',
      syncPreviewRedacted: '脱敏报告',
      syncPreviewSecrets: '密钥 {count} 处',
      syncPreviewPaths: '本机路径 {count} 处',
      syncKindPlugin: '插件',
      syncKindMcp: 'MCP',
      syncKindSkill: '技能',
      syncRequires: '需要',
      syncNothingSelected: '先勾选要装的项。',
      syncEmpty: '清单里没有可同步的项。',
      syncErrorTitle: '同步出错',
      // Live sections: web-search providers and the injected prompt text.
      providerHint: '余额按各家接口返回的单位显示，接口没有余额字段时给出中性提示。',
      providerPriorityHint: '顺序即调用优先级：排在最上面的提供方最先被调用，额度耗尽或报错时自动切到下一家。',
      providerSection: 'Web 搜索提供方',
      providerRank: '优先级',
      providerRefresh: '刷新余额',
      providerRefreshing: '正在刷新余额…',
      providerLoading: '正在读取提供方状态…',
      providerSaving: '正在保存顺序…',
      providerFailed: '操作失败',
      providerNoProviders: '还没有可用的提供方，请检查 providers.json 配置。',
      providerUnknownBalance: '未提供余额接口',
      providerEnable: '启用',
      providerDisable: '停用',
      providerCalls: '调用次数',
      providerSuccesses: '成功',
      providerFailures: '失败',
      providerLastUsed: '最近调用',
      providerNeverUsed: '从未调用',
      providerCooldown: '冷却中',
      providerKey: '密钥',
      providerKeyPresent: '已配置密钥',
      providerKeyMissing: '未配置密钥',
      providerBalance: '余额',
      providerStatusOk: '正常',
      providerStatusCooldown: '冷却',
      providerStatusUnknown: '未知',
      providerMoveUp: '上移，提高优先级',
      providerMoveDown: '下移，降低优先级',
      providerDragHint: '也可以拖动条目调整顺序',
      providerRefreshOne: '只刷新这一家',
      providerReset: '重置',
      providerResetMonthlyFirst: '每月 1 日重置',
      providerResetMonthlyAllowance: '每月免费额度恢复（付费额度不重置）',
      providerResetNone: '不按月重置',
      providerResetNext: '下次',
      providerResetUnknown: '未知，先刷新余额',
      providerResetInDays: '天',
      providerResetInHours: '小时',
      providerResetInMinutes: '分钟',
      providerUnitCredits: '额度',
      providerUnitUsd: '美元',
      providerUnitRequests: '次',
      providerUnitTokens: 'tokens',
      providerUnitPercent: '%',
      providerUnitUnknown: '单位未知',
      promptSection: '提示词注入',
      promptDescription: '这段文字会注入到所有 Agent 的系统提示词里。保存后，新的模型请求立即使用更新后的文本。',
      promptPlaceholder: '在此输入要注入系统提示词的内容…',
      promptConfirm: '保存提示词',
      promptSaving: '保存中…',
      promptSaved: '已保存，新的模型请求将使用更新后的提示词。',
      promptLoading: '正在读取当前注入文本…',
      promptErrorLoad: '读取当前注入文本失败，请稍后重试。',
      promptErrorSave: '保存失败，请稍后重试。',
      promptErrorEmpty: '注入文本不能为空，未提交。',
      // Credential vault (the `credential` tool's storage).
      credentialSection: '凭据保险库',
      credentialHint: '凭据以 AES-256-GCM 加密存放在 $DSH_HOME/credential-vault/，这里只显示掩码预览，明文永不回传。',
      credentialToolHint: 'AI 通过 credential 工具按名称读取凭据，每次读取明文都会记入使用日志。',
      credentialLoading: '正在读取凭据…',
      credentialSaving: '正在保存…',
      credentialError: '操作失败',
      credentialRefresh: '刷新',
      credentialNoEntries: '还没有保存的凭据。点「新增凭据」添加第一条。',
      credentialAdd: '新增凭据',
      credentialName: '名称',
      credentialNamePlaceholder: '例如 github-token、prod-server',
      credentialSlugPreview: '规范名',
      credentialService: '服务（可选）',
      credentialServicePlaceholder: 'github / openai / aliyun-ecs',
      credentialAliases: '别名（可选）',
      credentialAliasesPlaceholder: 'gh, github-token, git',
      credentialKind: '类型',
      credentialSecret: '凭据值',
      credentialSecretPlaceholder: '密码 / token / API key',
      credentialUsername: '用户名（可选）',
      credentialUrl: '地址（可选）',
      credentialNote: '备注（可选）',
      credentialSave: '保存',
      credentialCancel: '取消',
      credentialEdit: '编辑',
      credentialDelete: '删除',
      credentialConfirmDelete: '确认删除凭据',
      credentialExport: '导出',
      credentialImport: '导入',
      credentialExportTitle: '导出凭据',
      credentialExportHint: '导出文件用口令加密（至少 12 个字符），可安全放到网盘或 U 盘。它是密文，但请妥善保管。',
      credentialExportGo: '导出并下载',
      credentialExportDone: '已导出并开始下载。文件是密文，用完后建议删除。',
      credentialExportNoDownload: '导出成功，但浏览器未能触发下载，可在导出重试或联系面板维护者。',
      credentialImportTitle: '导入凭据',
      credentialImportHint: '粘贴另一台设备导出的 .dsvault 文件内容，并用导出时的口令解密。同名但内容不同的凭据会报告冲突，不会覆盖。',
      credentialImportGo: '导入',
      credentialImportContentPlaceholder: '粘贴 .dsvault 文件的 JSON 内容',
      credentialImportOverwrite: '覆盖本机同名凭据（仅限完全相同的凭据；冲突仍会报告）',
      credentialImportSummary: '导入完成：新增 {imported} 条，更新 {updated} 条，跳过 {skipped} 条，冲突 {conflicts} 条，本机较新 {stale} 条',
      credentialPassphrasePlaceholder: '口令（至少 12 个字符）',
      credentialPassphraseConfirm: '再输一遍口令',
      credentialPassphraseMismatch: '两次输入的口令不一致',
      credentialRotate: '轮换主密钥',
      credentialRotateConfirm: '确认轮换主密钥？所有凭据将重新加密，旧密钥备份为 master.key.bak。',
      credentialRotated: '已轮换主密钥，凭据已重新加密',
      credentialAudit: '使用日志',
      credentialAuditEmpty: '还没有读取记录。',
      credentialUpdatedAt: '更新于',
      credentialUpdated: '已更新',
      credentialCreated: '已创建',
      credentialDeleted: '已删除',
      credentialMasked: '掩码',
      credentialHasSecret: '已加密保存',
      credentialKindPassword: '服务器密码',
      credentialKindToken: 'Token',
      credentialKindApiKey: 'API Key',
      credentialKindSshKey: 'SSH 密钥',
      credentialKindDatabase: '数据库',
      credentialKindOther: '其他',
    }

    const en = {
      tab: 'Tools',
      panel: 'Tools',
      back: 'Back to chat',
      title: 'Tools',
      subtitle: 'Plugin packages, MCP servers and skills — plus what each workspace has switched on.',
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
      mcp: 'MCP servers',
      mcpHint: 'Rows served by @deepseek-ai/dsh-mcp-client',
      skills: 'Skills',
      skillsHint: 'Disk scan (including shadowed stubs) plus runtime registrations',
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
      noSkills: 'No skills found.',
      hiddenSkillsEmpty: 'Every skill is hidden. "Show hidden" in the toolbar brings them back.',
      noMcp: 'No MCP server configured.',
      noPackages: 'The profile declares no plugins.',
      showOfficial: 'Show official',
      hideOfficial: 'Hide official',
      officialHidden: 'Official entries are hidden.',
      officialHint: 'official = @deepseek-ai/* plugin packages',
      hideSkill: 'Hide this skill',
      unhideSkill: 'Unhide',
      showHiddenSkills: 'Show hidden',
      hiddenSkillsHint: 'Reveal hidden skills; click again to fold them away',
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
      wsGlobalDuplicate: 'mounted twice',
      wsGlobalShort: 'global',
      wsGlobalSkillsFold: 'Available everywhere',
      wsGlobalSkillsFoldHint: 'these skills load in every workspace; the switch lives on the overview page',
      wsGlobalNote: 'applies to every workspace',
      wsNotLinked: 'not linked by this page',
      wsNotLinkedNote: 'hand-copied, not created here',
      wsGlobalSkillOn: 'global',
      wsGlobalSkillOnNote: 'on for every workspace; turn it off in the overview',
      wsGlobalSkillOff: 'disabled globally',
      wsGlobalSkillOffNote: 'enable it in the overview; it then applies to every workspace',
      wsDuplicateNote: 'duplicates the global copy; remove the link',
      wsHiddenShort: 'hidden',
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
      updateBadge: 'update available',
      updateCurrent: 'Up to date',
      updateTo: 'Update to {version}',
      updateConfirm: 'This advances the whole plugin checkout and reloads it now. Continue?',
      updateRunning: 'Updating…',
      updateDone: 'Updated',
      updateFailed: 'Update failed',
      syncView: 'Sync',
      syncTitle: 'Cross-machine sync',
      syncSubtitle: 'Diff against the manifest repository and install only what you tick. Publishing uploads the plugin/MCP/skill list; secrets and host paths are stripped.',
      syncNotConfigured: 'No manifest repository configured yet. Enter owner/repo or a repository URL, save, then reload.',
      syncMode: 'Transport',
      syncModeGithub: 'GitHub (direct, stable abroad)',
      syncModeGitee: 'Gitee (mainland direct)',
      syncModeHttp: 'Self-hosted (http URL)',
      syncModeHttpHint: 'A directly reachable http(s) file URL: GET reads the manifest, PUT publishes it (Bearer token auth).',
      syncRepo: 'Manifest repository',
      syncRepoPlaceholder: 'owner/repo or https://github.com/owner/repo',
      syncRepoPlaceholderHttp: 'http://server/manifests/dsh-manifest.json',
      syncRepoUrl: 'Plugin repository URL (optional)',
      syncRepoUrlPlaceholder: 'https://gitee.com/you/DSH-plugins.git (auto-clone on new machines)',
      syncRef: 'Branch',
      syncPath: 'Manifest path',
      syncToken: 'GitHub token',
      syncTokenSet: 'Saved (never echoed back)',
      syncTokenPlaceholder: 'Paste a token with contents:write',
      syncTokenHint: 'Used only to write the manifest repository, stored in $DSH_HOME/plugin-sync.json, never published.',
      syncSave: 'Save configuration',
      syncSaved: 'Configuration saved',
      syncSaveFailed: 'Could not save configuration',
      syncRefresh: 'Read manifest',
      syncLoading: 'Reading the manifest…',
      syncCanPublish: 'Can publish',
      syncCanPull: 'Can pull',
      syncNo: 'unavailable',
      syncManifestMeta: 'Manifest',
      syncGeneratedAt: 'Manifest generated',
      syncFleet: 'Fleet manifest: {count} machines · this machine {machine}',
      syncFleetSelf: 'Local manifest (fleet format migrates on next publish)',
      syncViaRaw: 'raw.githubusercontent',
      syncViaApi: 'GitHub API',
      syncViaGit: 'git clone',
      syncStatusMissing: 'Missing',
      syncStatusOutdated: 'Version differs',
      syncStatusBlocked: 'Not usable here',
      syncStatusDisabled: 'Disabled',
      syncStatusCurrent: 'Up to date',
      syncStatusLocalOnly: 'Local only',
      syncStatusSkip: 'Skipped',
      syncSelectable: 'installable',
      syncSelectAll: 'Select all installable',
      syncClearAll: 'Clear',
      syncInstall: 'Install selected',
      syncInstalling: 'Installing…',
      syncInstalled: 'Installed {count}',
      syncInstallFailed: 'Install failed',
      syncPublish: 'Publish (merge into fleet)',
      syncPublishing: 'Publishing…',
      syncPublished: 'Published',
      syncPublishUnchanged: 'No change, no commit created',
      syncPublishFailed: 'Publish failed',
      syncPreview: 'Preview manifest',
      syncPreviewTitle: 'What would be published',
      syncPreviewRedacted: 'Redaction report',
      syncPreviewSecrets: '{count} secret(s)',
      syncPreviewPaths: '{count} host path(s)',
      syncKindPlugin: 'Plugin',
      syncKindMcp: 'MCP',
      syncKindSkill: 'Skill',
      syncRequires: 'needs',
      syncNothingSelected: 'Tick something first.',
      syncEmpty: 'The manifest has nothing to sync.',
      syncErrorTitle: 'Sync error',
      // Live sections: web-search providers and the injected prompt text.
      providerHint: 'Balances use the unit each provider API reports; APIs without a balance field get a neutral hint.',
      providerPriorityHint: 'Order is call priority: the top provider is called first, and exhausted quota or errors fail over to the next one.',
      providerSection: 'Web search providers',
      providerRank: 'Priority',
      providerRefresh: 'Refresh balances',
      providerRefreshing: 'Refreshing balances…',
      providerLoading: 'Loading provider state…',
      providerSaving: 'Saving order…',
      providerFailed: 'Operation failed',
      providerNoProviders: 'No providers available. Check the providers.json config.',
      providerUnknownBalance: 'No balance API',
      providerEnable: 'Enable',
      providerDisable: 'Disable',
      providerCalls: 'Calls',
      providerSuccesses: 'Successes',
      providerFailures: 'Failures',
      providerLastUsed: 'Last used',
      providerNeverUsed: 'Never called',
      providerCooldown: 'Cooling down',
      providerKey: 'API key',
      providerKeyPresent: 'Key configured',
      providerKeyMissing: 'No key configured',
      providerBalance: 'Balance',
      providerStatusOk: 'OK',
      providerStatusCooldown: 'Cooling down',
      providerStatusUnknown: 'Unknown',
      providerMoveUp: 'Move up (higher priority)',
      providerMoveDown: 'Move down (lower priority)',
      providerDragHint: 'You can also drag rows to reorder',
      providerRefreshOne: 'Refresh this provider only',
      providerReset: 'Resets',
      providerResetMonthlyFirst: 'Resets on the 1st of each month',
      providerResetMonthlyAllowance: 'Monthly free allowance renews (paid credits do not)',
      providerResetNone: 'Does not reset monthly',
      providerResetNext: 'next',
      providerResetUnknown: 'Unknown — refresh the balance first',
      providerResetInDays: 'd',
      providerResetInHours: 'h',
      providerResetInMinutes: 'm',
      providerUnitCredits: 'credits',
      providerUnitUsd: 'USD',
      providerUnitRequests: 'requests',
      providerUnitTokens: 'tokens',
      providerUnitPercent: '%',
      providerUnitUnknown: 'unknown unit',
      promptSection: 'Prompt injection',
      promptDescription: 'This text is injected into every agent system prompt. After saving, new model requests use the updated text.',
      promptPlaceholder: 'Enter the text to inject into the system prompt…',
      promptConfirm: 'Save prompt',
      promptSaving: 'Saving…',
      promptSaved: 'Saved. New model requests will use the updated prompt.',
      promptLoading: 'Loading the current injected text…',
      promptErrorLoad: 'Could not load the current injected text. Please retry.',
      promptErrorSave: 'Could not save. Please retry.',
      promptErrorEmpty: 'The injected text must not be empty; nothing was submitted.',
      // Credential vault (the `credential` tool's storage).
      credentialSection: 'Credential vault',
      credentialHint: 'Credentials are stored AES-256-GCM encrypted under $DSH_HOME/credential-vault/. Only masked previews are shown here; plaintext never comes back.',
      credentialToolHint: 'The model reads credentials by name through the `credential` tool; every plaintext reveal is written to the audit log.',
      credentialLoading: 'Loading credentials…',
      credentialSaving: 'Saving…',
      credentialError: 'Operation failed',
      credentialRefresh: 'Refresh',
      credentialNoEntries: 'No credentials yet. Click "Add credential" to create the first one.',
      credentialAdd: 'Add credential',
      credentialName: 'Name',
      credentialNamePlaceholder: 'e.g. github-token, prod-server',
      credentialSlugPreview: 'Normalized name',
      credentialService: 'Service (optional)',
      credentialServicePlaceholder: 'github / openai / aliyun-ecs',
      credentialAliases: 'Aliases (optional)',
      credentialAliasesPlaceholder: 'gh, github-token, git',
      credentialKind: 'Kind',
      credentialSecret: 'Secret',
      credentialSecretPlaceholder: 'password / token / API key',
      credentialUsername: 'Username (optional)',
      credentialUrl: 'URL (optional)',
      credentialNote: 'Note (optional)',
      credentialSave: 'Save',
      credentialCancel: 'Cancel',
      credentialEdit: 'Edit',
      credentialDelete: 'Delete',
      credentialConfirmDelete: 'Delete credential',
      credentialExport: 'Export',
      credentialImport: 'Import',
      credentialExportTitle: 'Export credentials',
      credentialExportHint: 'The export file is encrypted with a passphrase (at least 12 characters) and is safe for cloud drives or USB sticks. It is ciphertext — still keep it safe.',
      credentialExportGo: 'Export and download',
      credentialExportDone: 'Exported; the download has started. The file is ciphertext, but delete it once you are done.',
      credentialExportNoDownload: 'Export succeeded, but the browser could not trigger the download. Try exporting again.',
      credentialImportTitle: 'Import credentials',
      credentialImportHint: 'Paste the contents of a .dsvault file exported on another device and decrypt it with the export passphrase. Credentials that share a name but differ in content are reported as conflicts, never overwritten.',
      credentialImportGo: 'Import',
      credentialImportContentPlaceholder: 'Paste the JSON contents of a .dsvault file',
      credentialImportOverwrite: 'Overwrite local credentials with the same name (only exact matches; conflicts are still reported)',
      credentialImportSummary: 'Import finished: {imported} imported, {updated} updated, {skipped} skipped, {conflicts} conflicts, {stale} locally newer',
      credentialPassphrasePlaceholder: 'Passphrase (at least 12 characters)',
      credentialPassphraseConfirm: 'Repeat the passphrase',
      credentialPassphraseMismatch: 'The two passphrases do not match',
      credentialRotate: 'Rotate master key',
      credentialRotateConfirm: 'Rotate the master key? Every entry is re-encrypted; the old key is kept as master.key.bak.',
      credentialRotated: 'Master key rotated, entries re-encrypted',
      credentialAudit: 'Audit log',
      credentialAuditEmpty: 'No reads recorded yet.',
      credentialUpdatedAt: 'Updated',
      credentialUpdated: 'Updated',
      credentialCreated: 'Created',
      credentialDeleted: 'Deleted',
      credentialMasked: 'masked',
      credentialHasSecret: 'Encrypted',
      credentialKindPassword: 'Server password',
      credentialKindToken: 'Token',
      credentialKindApiKey: 'API key',
      credentialKindSshKey: 'SSH key',
      credentialKindDatabase: 'Database',
      credentialKindOther: 'Other',
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
      // Per-row icon button (hide a skill); swallows the row's own click.
      rowIconBtn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '26px',
        height: '26px',
        padding: 0,
        border: 'none',
        borderRadius: '7px',
        background: 'transparent',
        color: C.secondary,
        opacity: 0.7,
        cursor: 'pointer',
        flexShrink: 0,
      },
      // 26px control that sits inside a row (provider priority arrows). No fill
      // until hover, so two stacked arrows read as one control column.
      rowCtrlBtn: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '24px',
        height: '24px',
        padding: 0,
        border: `1px solid ${C.hairline}`,
        borderRadius: '7px',
        background: 'transparent',
        color: C.secondary,
        cursor: 'pointer',
        flexShrink: 0,
      },
      rowCtrlBtnDisabled: { opacity: 0.3, cursor: 'default' },
      providerRank: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: '22px',
        height: '22px',
        padding: '0 6px',
        borderRadius: '999px',
        background: C.fillStrong,
        color: C.secondary,
        ...T.badge,
        fontVariantNumeric: 'tabular-nums',
        flexShrink: 0,
      },
      providerTrack: {
        boxSizing: 'border-box',
        width: '100%',
        height: '4px',
        marginTop: '2px',
        overflow: 'hidden',
        borderRadius: '999px',
        background: C.fill,
        flexShrink: 0,
      },
      providerFill: { height: '100%', borderRadius: '999px', transition: `width 180ms ${EASE}` },
      feedback: { ...T.caption, color: C.secondary },
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
      rowHidden: { opacity: 0.55 },
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
      // Header that folds a block of rows away: a divider, not a box.
      foldHeader: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        width: '100%',
        padding: '10px 16px 6px',
        border: 'none',
        borderTop: `1px solid ${C.hairline}`,
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        userSelect: 'none',
        flexShrink: 0,
      },
      foldHeaderEmpty: { cursor: 'default', opacity: 0.6 },
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
      ['mcp', (item) => `${item.server} ${item.entryId} ${item.transport ?? ''} ${item.command ?? ''} ${item.status}`],
      ['skills', (item) => `${item.name} ${item.description ?? ''} ${item.source ?? ''} ${(item.edges ?? []).map((e) => e.id).join(' ')}`],
    ]
    const FILTER_QUERY = Object.fromEntries(FILTERS.map(([key, pick]) => [key, pick]))
    const filterFor = (key) => FILTER_QUERY[key]

    function matches(query, item, pick) {
      if (query.length === 0) return true
      return pick(item).toLowerCase().includes(query)
    }

    /**
     * First-party bundles shipped inside the DSH app: everything in the
     * `@deepseek-ai/` scope. The panel exists to answer "what did I install",
     * so these are hidden by default and the toolbar has one switch to bring
     * them back.
     */
    const FIRST_PARTY_SCOPE = '@deepseek-ai/'

    const isOfficialEntry = (item) => String(item?.name ?? '').startsWith(FIRST_PARTY_SCOPE)

    /** True when the item should be listed given the "show official" switch. */
    function listed(item, isOfficial, showOfficial) {
      return showOfficial === true || isOfficial(item) !== true
    }

    /**
     * Runtime-registered skills have no directory, no per-workspace switch and
     * nothing on disk: this panel reports what is installed, so they are never
     * listed and never counted.
     */
    const isRuntimeSkill = (skill) => skill?.source === 'runtime'

    /**
     * Skill set of one workspace: every installed skill union the workspace's
     * own project roots, keyed by name. The workspace entry wins because it
     * carries `linked` (the host's lstat verdict); the installed entry keeps the
     * skill's real origin. The workspace card and the detail page both use this,
     * so the two numbers can never disagree.
     */
    function workspaceSkillSet(installedSkills, workspace) {
      const byName = new Map()
      for (const skill of installedSkills) {
        if (typeof skill?.name === 'string' && skill.name.length > 0 && !isRuntimeSkill(skill)) byName.set(skill.name, { ...skill })
      }
      for (const group of workspace.skills ?? []) {
        for (const skill of group.skills ?? []) {
          if (typeof skill?.name !== 'string' || skill.name.length === 0) continue
          const known = byName.get(skill.name) ?? {}
          byName.set(skill.name, { ...known, ...skill, source: skill.source ?? known.source ?? group.source, assigned: true })
        }
      }
      return [...byName.values()]
    }

    /**
     * True when the model can reach this skill in a workspace: a project link, or
     * a machine-wide root that is not shadowed. The card and the detail rows use
     * this one rule, so "已开启 X/N" means the same thing in both places.
     */
    function workspaceSkillEnabled(skill) {
      if (skill.assigned === true) return true
      return skill.global === true && skill.vaulted !== true && skill.shadowed !== true && skill.disabled !== true
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
        chevronUp: [h('path', { key: 'p', d: 'M5 15l7-7 7 7', ...stroke })],
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
        eye: [
          h('path', { key: 'e', d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z', ...stroke }),
          h('circle', { key: 'c', cx: 12, cy: 12, r: 2.8, ...stroke }),
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

    function Section({ t, title, hint, count, open, onToggle, showCount = true, children }) {
      const body = children === undefined || children === null ? [] : Array.isArray(children) ? children : [children]
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', flexShrink: 0 } },
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
          showCount === false ? null : h('span', { style: S.sectionCount }, `${count} ${t('wsItemCount')}`),
          hint ? h('span', { style: S.sectionHint }, hint) : null,
        ),
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

    /**
     * Icon-only twin of RowButton: hides/unhides one skill row. `muted` is the
     * compact variant used inside a row that is itself a button (provider
     * priority arrows), and `disabled` dims it instead of removing it so the row
     * keeps its shape.
     */
    function RowIconButton({ label, icon, onClick, muted, disabled }) {
      const isDisabled = disabled === true
      return h(
        'button',
        {
          type: 'button',
          className: 'inv-btn inv-hide',
          'aria-label': label,
          title: label,
          disabled: isDisabled,
          style: muted ? { ...S.rowCtrlBtn, ...(isDisabled ? S.rowCtrlBtnDisabled : {}) } : { ...S.rowIconBtn, ...(isDisabled ? { opacity: 0.3, cursor: 'default' } : {}) },
          onClick: (event) => {
            if (event !== undefined && event !== null) event.stopPropagation()
            if (isDisabled) return
            onClick()
          },
          onKeyDown: (event) => {
            if (event !== undefined && event !== null) event.stopPropagation()
          },
        },
        h(Icon, { name: icon, size: muted ? 14 : 16 }),
      )
    }

    /** Workspace list: one grouped card, one row per workspace. */
    function WorkspaceList({ t, data, onEnter, query, hiddenSkills, showHiddenSkills }) {
      const all = Array.isArray(data?.workspaces) ? data.workspaces : []
      const installed = Array.isArray(data?.skills) ? data.skills : []
      const hidden = Array.isArray(hiddenSkills) ? hiddenSkills : []
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
            // Same set the detail page lists, so the card reads like the page's
            // "已开启 X/N": how many of this workspace's skills are on, out of all.
            const skillSet = workspaceSkillSet(installed, workspace).filter((skill) => showHiddenSkills === true || !hidden.includes(skill.name))
            const onCount = skillSet.filter(workspaceSkillEnabled).length
            const meta = [`MCP ${counts.declared ?? 0}`, `${t('skills')} ${onCount}/${skillSet.length}`].join(' · ')
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
      // Global-reachable skills are already on everywhere, so they sit behind
      // one collapsed header instead of padding the switchable rows.
      const [showGlobalSkills, setShowGlobalSkills] = React.useState(false)
      // Hidden skill names and the reveal switch are shared with the overview, so
      // a skill hidden once stays hidden on both pages.
      const hiddenSkills = Array.isArray(props.hiddenSkills) ? props.hiddenSkills : []
      const showHidden = props.showHiddenSkills === true
      const setSkillHidden = typeof props.onSetSkillHidden === 'function' ? props.onSetSkillHidden : () => {}
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
            // A globally mounted server already reaches every workspace, so the
            // workspace switch could not change the outcome — the global switch
            // (overview page) owns this row. Only a globally off server is
            // decided here.
            const locked = isGlobal
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
          row.locked && row.isDeclared ? h(Badge, { label: t('wsGlobalDuplicate'), tone: 'warning', dot: true }) : null,
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

      // Skill set of this workspace, shared with the workspace card so both
      // numbers are the same set. Runtime registrations never enter it.
      const allSkills = workspaceSkillSet(installedSkills, workspace)
      const skillRows = sortByEnabled(
        allSkills
          .map((skill) => {
            const assigned = skill.assigned === true
            const linked = skill.linked === true
            const shadowed = skill.shadowed === true || skill.disabled === true
            // A skill on a machine-wide root already reaches every workspace, and
            // linking it into the project root would only duplicate it (rank 100
            // shadows rank 400). A globally shadowed skill stays shadowed too: the
            // link points at the same SKILL.md. So only a vaulted skill — which no
            // root scans — needs a workspace switch. The host enforces the same
            // rule on POST /inventory/workspace.
            const globalReachable = skill.global === true && skill.vaulted !== true
            const enabled = workspaceSkillEnabled(skill)
            const locked = assigned ? !linked : globalReachable
            const reason = assigned
              ? linked
                ? null
                : t('wsNotLinked')
              : globalReachable
                ? shadowed
                  ? t('wsGlobalSkillOff')
                  : t('wsGlobalSkillOn')
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
                : null
            return {
              skill,
              assigned,
              enabled,
              shadowed,
              locked,
              // Which part of the page this row belongs to. 'global' rows are
              // already on everywhere and are collected behind one collapse
              // header, so the switchable rows stay near the top.
              group: assigned ? 'workspace' : globalReachable ? 'global' : 'workspace',
              reason,
              note,
              search: `${skill.name} ${skill.description ?? ''} ${skill.source ?? ''}`.toLowerCase(),
            }
          })
          .filter((row) => (showHidden || !hiddenSkills.includes(row.skill.name)) && (q.length === 0 || row.search.includes(q))),
        (row) => row.enabled,
        (row) => String(row.skill.name),
      )

      const skillRowNode = (row, last) => {
        const skill = row.skill
        const hidden = hiddenSkills.includes(skill.name)
        return h(
          'div',
          { key: `ws-skill-${workspace.id}-${skill.name}`, style: { ...S.row, ...(last ? S.rowLast : {}), ...(hidden ? S.rowHidden : {}) } },
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
          h(RowIconButton, {
            label: hidden ? `${t('unhideSkill')} ${skill.name}` : `${t('hideSkill')} ${skill.name}`,
            icon: hidden ? 'eye' : 'eyeOff',
            onClick: () => setSkillHidden(skill.name, !hidden),
          }),
        )
      }

      // Two blocks: what this workspace decides, then what the machine already
      // provides. The second block has no switches at all, so folding it away is
      // free — and it keeps the workspace's own switches in the first screenful.
      const localSkillRows = skillRows.filter((row) => row.group === 'workspace')
      const globalSkillRows = skillRows.filter((row) => row.group === 'global')
      const globalFold = h(
        'button',
        {
          key: `ws-skills-global-${workspace.id}`,
          type: 'button',
          className: 'inv-seg-btn',
          'aria-expanded': showGlobalSkills ? 'true' : 'false',
          title: t('wsGlobalSkillsFoldHint'),
          style: { ...S.foldHeader, ...(globalSkillRows.length === 0 ? S.foldHeaderEmpty : {}) },
          onClick: () => setShowGlobalSkills((prev) => !prev),
        },
        h('span', { style: { ...S.chev, transform: showGlobalSkills ? 'rotate(0deg)' : 'rotate(-90deg)' } }, h(Icon, { name: 'chevronDown', size: 15 })),
        h('span', { style: S.rowTitle }, t('wsGlobalSkillsFold')),
        h('span', { style: S.sectionCount }, `${globalSkillRows.length} ${t('wsItemCount')}`),
      )
      const skillNodes = [
        ...localSkillRows.map((row, index) => skillRowNode(row, globalSkillRows.length === 0 && index === localSkillRows.length - 1)),
        globalSkillRows.length === 0 ? null : globalFold,
        ...(showGlobalSkills ? globalSkillRows.map((row, index) => skillRowNode(row, index === globalSkillRows.length - 1)) : []),
      ].filter(Boolean)

      // "On" means on *because of this workspace*: a globally mounted server is
      // already on everywhere and is counted separately, so the two numbers
      // never describe the same row.
      const declaredOn = mcpRows.filter((row) => row.isOn && !row.locked).length
      const globalCount = mcpRows.filter((row) => row.locked).length
      // Counts come from the rows on screen: the header's "N 项" and the "X/Y"
      // hint must always describe the same list, hidden rows included — and the
      // same set the workspace card counts. "全局 K" is a subset marker, not a
      // second total.
      const skillsOn = skillRows.filter((row) => row.enabled).length
      const hiddenHere = allSkills.filter((skill) => hiddenSkills.includes(skill.name)).length
      const mcpStatus =
        workspace.mcp?.status === 'invalid'
          ? `${t('wsInvalidDeclaration')}: ${workspace.mcp.error ?? ''}`
          : workspace.mcp?.status === 'missing'
            ? t('wsNoDeclaration')
            : undefined
      const mcpHint = [`${t('wsSwitchOn')} ${declaredOn}`, globalCount > 0 ? `${t('wsGlobalShort')} ${globalCount}` : null, mcpStatus]
        .filter(Boolean)
        .join(' · ')
      const skillsHint = [
        `${t('wsSwitchOn')} ${skillsOn}/${skillRows.length}`,
        globalSkillRows.length > 0 ? `${t('wsGlobalShort')} ${globalSkillRows.length}` : null,
        hiddenHere > 0 ? `${t('wsHiddenShort')} ${hiddenHere}` : null,
      ]
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
            ? h('div', { key: 'sk-empty', style: S.empty }, q.length > 0 ? t('emptySearch') : hiddenSkills.length > 0 && !showHidden ? t('hiddenSkillsEmpty') : t('noSkills'))
            : skillNodes,
        ),
      )
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

    function syncStatusLabel(t, status) {
      if (status === 'missing') return t('syncStatusMissing')
      if (status === 'outdated') return t('syncStatusOutdated')
      if (status === 'blocked') return t('syncStatusBlocked')
      if (status === 'disabled') return t('syncStatusDisabled')
      if (status === 'current') return t('syncStatusCurrent')
      if (status === 'local-only') return t('syncStatusLocalOnly')
      return t('syncStatusSkip')
    }

    function syncKindLabel(t, kind) {
      if (kind === 'plugin') return t('syncKindPlugin')
      if (kind === 'mcp') return t('syncKindMcp')
      return t('syncKindSkill')
    }

    /** `blocked` is a warning about this host, not a failure to install. */
    function syncTone(status) {
      if (status === 'blocked') return 'danger'
      if (status === 'missing' || status === 'outdated') return 'warning'
      if (status === 'current') return 'success'
      return null
    }

    /**
     * Cross-machine sync panel.
     *
     * Configuration, the diff, and the two actions live in one column. The diff
     * comes from the host and is re-read after every write; the form is local
     * state so typing never triggers a refetch.
     *
     * A checkbox exists only for rows the host calls installable. `blocked`
     * rows show their reason instead — that distinction is the entire reason
     * blocked is not folded into missing.
     */
    function SyncPanel({ t, onReloadSnapshot }) {
      const [payload, setPayload] = React.useState(null)
      const [error, setError] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [selection, setSelection] = React.useState([])
      const [preview, setPreview] = React.useState(null)
      const [repo, setRepo] = React.useState('')
      const [repoUrl, setRepoUrl] = React.useState('')
      const [mode, setMode] = React.useState('github')
      const [ref, setRef] = React.useState('main')
      const [path, setPath] = React.useState('dsh-manifest.json')
      const [token, setToken] = React.useState('')
      // The form is seeded once from the host state, then belongs to the user.
      const seeded = React.useRef(false)

      const load = React.useCallback(async () => {
        setBusy('load')
        setError('')
        try {
          const response = await fetch(SYNC_ROUTE, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const data = await response.json()
          setPayload(data)
          if (seeded.current !== true && data !== null && typeof data.state === 'object') {
            setRepo(data.state.repo ?? '')
            setRepoUrl(data.state.repoUrl ?? '')
            setMode(['github', 'gitee', 'http'].includes(data.state.mode) ? data.state.mode : 'github')
            setRef(data.state.ref ?? 'main')
            setPath(data.state.path ?? 'dsh-manifest.json')
            seeded.current = true
          }
        } catch (e) {
          setError(e !== null && e !== undefined && e.message ? e.message : String(e))
        } finally {
          setBusy('')
        }
      }, [])

      React.useEffect(() => {
        load()
      }, [load])

      /** Read the JSON error detail the host put in the body, if any. */
      const detailOf = async (response) => {
        try {
          const body = await response.json()
          if (typeof body?.error === 'string' && body.error.length > 0) return body.error
          if (Array.isArray(body?.results)) {
            const failed = body.results.filter((item) => item.ok !== true)
            if (failed.length > 0) return failed.map((item) => `${item.key}: ${item.error}`).join('；')
          }
        } catch {
          // A non-JSON body still has a status worth showing.
        }
        return `HTTP ${response.status}`
      }

      const save = React.useCallback(async () => {
        setBusy('save')
        setError('')
        setNotice('')
        try {
          const body = { repo, mode, ref, path, repoUrl }
          // Only send the token when the user typed one: an empty field means
          // "leave the stored token alone", not "erase it".
          if (token.length > 0) body.token = token
          const response = await fetch(SYNC_CONFIG_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify(body),
          })
          if (!response.ok) throw new Error(await detailOf(response))
          setToken('')
          setNotice(t('syncSaved'))
          seeded.current = false
          await load()
        } catch (e) {
          setError(e !== null && e !== undefined && e.message ? e.message : String(e))
        } finally {
          setBusy('')
        }
      }, [repo, repoUrl, mode, ref, path, token, load, t])

      /** POST a body to the apply route and re-read both views afterwards. */
      const runApply = React.useCallback(
        async (body, tag) => {
          setBusy(tag)
          setError('')
          setNotice('')
          try {
            const response = await fetch(SYNC_APPLY_ROUTE, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify(body),
            })
            const result = await response.json()
            if (!response.ok || result?.ok !== true) throw new Error(await detailOf(response))
            if (tag === 'install') {
              setNotice(t('syncInstalled').replace('{count}', String(result.applied ?? 0)))
              setSelection([])
              if (typeof onReloadSnapshot === 'function') onReloadSnapshot()
            } else if (result.unchanged === true) {
              setNotice(t('syncPublishUnchanged'))
            } else {
              setNotice(t('syncPublished'))
            }
            await load()
          } catch (e) {
            setError(e !== null && e !== undefined && e.message ? e.message : String(e))
          } finally {
            setBusy('')
          }
        },
        [load, t, onReloadSnapshot],
      )

      const install = React.useCallback(async () => {
        if (selection.length === 0) {
          setError(t('syncNothingSelected'))
          return
        }
        await runApply({ selection }, 'install')
      }, [selection, runApply, t])

      const publish = React.useCallback(async () => {
        await runApply({ action: 'publish' }, 'publish')
      }, [runApply])

      const showPreview = React.useCallback(async () => {
        setBusy('preview')
        setError('')
        try {
          const response = await fetch(SYNC_PREVIEW_ROUTE, { headers: { accept: 'application/json' } })
          if (!response.ok) throw new Error(await detailOf(response))
          setPreview(await response.json())
        } catch (e) {
          setError(e !== null && e !== undefined && e.message ? e.message : String(e))
        } finally {
          setBusy('')
        }
      }, [t])

      const toggleRow = (key) =>
        setSelection((prev) => (prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]))

      const rows = Array.isArray(payload?.rows) ? payload.rows : []
      const installable = rows.filter((item) => item.status === 'missing' || item.status === 'outdated')
      const counts = payload?.counts ?? {}
      const state = payload?.state ?? {}
      const capabilities = payload?.capabilities ?? {}
      const configured = typeof state.repo === 'string' && state.repo.length > 0

      // One line about the fleet: how many machines share the manifest, which
      // one this panel is, and whether this machine has published at all.
      const manifestInfo = payload?.manifest ?? null
      const fleetCount = typeof manifestInfo?.fleetMachines === 'number' ? manifestInfo.fleetMachines : 0
      const selfPublished = manifestInfo?.publishedByThisMachine === true
      const fleetLine = fleetCount > 0
        ? t('syncFleet')
            .replace('{count}', String(fleetCount))
            .replace('{machine}', typeof state.machineId === 'string' && state.machineId.length > 0 ? state.machineId : '—')
            + (selfPublished ? '' : '')
        : manifestInfo !== null
          ? t('syncFleetSelf')
          : ''

      const field = (label, value, onChange, placeholder, isSecret) =>
        h(
          'label',
          { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 auto', minWidth: 0 } },
          h('span', { style: S.rowSub }, label),
          h('input', {
            style: { ...S.search, height: '34px', padding: '0 10px', borderRadius: '9px', background: C.fill, fontSize: '14px' },
            value,
            placeholder,
            type: isSecret === true ? 'password' : 'text',
            onChange: (event) => onChange(event.target.value),
          }),
        )

      const configCard = h(
        'div',
        { style: { ...S.card, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: '10px' } },
        configured
          ? null
          : h('div', { style: S.rowSub }, t('syncNotConfigured')),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          h(
            'label',
            { style: { display: 'flex', flexDirection: 'column', gap: '4px', flex: '1 1 auto', minWidth: 0 } },
            h('span', { style: S.rowSub }, t('syncMode')),
            h(
              'select',
              {
                style: { ...S.search, height: '34px', padding: '0 10px', borderRadius: '9px', background: C.fill, fontSize: '14px' },
                value: mode,
                onChange: (event) => setMode(event.target.value),
              },
              h('option', { value: 'github' }, t('syncModeGithub')),
              h('option', { value: 'gitee' }, t('syncModeGitee')),
              h('option', { value: 'http' }, t('syncModeHttp')),
            ),
          ),
        ),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          field(t('syncRepo'), repo, setRepo, mode === 'http' ? t('syncRepoPlaceholderHttp') : t('syncRepoPlaceholder')),
          mode === 'http'
            ? h('span', { style: { flex: '1 1 auto', minWidth: 0 } })
            : field(t('syncRef'), ref, setRef, 'main'),
        ),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          field(t('syncRepoUrl'), repoUrl, setRepoUrl, t('syncRepoUrlPlaceholder')),
        ),
        mode === 'http' ? h('div', { style: S.rowSub }, t('syncModeHttpHint')) : null,
        mode === 'http'
          ? null
          : h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
              field(t('syncPath'), path, setPath, 'dsh-manifest.json'),
              field(
                t('syncToken'),
                token,
                setToken,
                state.hasToken === true ? t('syncTokenSet') : t('syncTokenPlaceholder'),
                true,
              ),
            ),
        h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap' } },
          mode === 'http'
            ? field(
                t('syncToken'),
                token,
                setToken,
                state.hasToken === true ? t('syncTokenSet') : t('syncTokenPlaceholder'),
                true,
              )
            : h('span', { style: { display: 'none' } }),
        ),
        h('div', { style: S.rowSub }, t('syncTokenHint')),
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, ...S.chipOn, opacity: busy === 'save' ? 0.5 : 1 },
              disabled: busy === 'save',
              onClick: save,
            },
            t('syncSave'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, opacity: busy === 'load' ? 0.5 : 1 },
              disabled: busy === 'load',
              onClick: load,
            },
            t('syncRefresh'),
          ),
          h('span', { style: S.rowSub },
            `${t('syncCanPull')}: ${capabilities.canPull === true ? '✓' : t('syncNo')} · ${t('syncCanPublish')}: ${capabilities.canPublish === true ? '✓' : t('syncNo')}`),
        ),
        h('span', { style: S.rowSub }, fleetLine),
        error.length > 0 ? h('div', { style: S.rowSub, role: 'alert' }, `${t('syncErrorTitle')}: ${error}`) : null,
        notice.length > 0 ? h('div', { style: S.rowSub, role: 'status' }, notice) : null,
      )

      const diffCard = h(
        'div',
        { style: S.card },
        h(
          'div',
          { style: S.row },
          h('div', { style: S.rowMain },
            h('span', { style: S.rowTitle }, t('syncTitle')),
            h('span', { style: S.rowSub },
              rows.length === 0
                ? t('syncEmpty')
                : `${counts.missing ?? 0} ${t('syncStatusMissing')} · ${counts.outdated ?? 0} ${t('syncStatusOutdated')} · ${counts.blocked ?? 0} ${t('syncStatusBlocked')} · ${counts.current ?? 0} ${t('syncStatusCurrent')}`),
          ),
        ),
        ...rows.map((item, index) =>
          h(
            'div',
            { key: `${item.key}-${index}`, style: { ...S.row, ...(index === rows.length - 1 ? S.rowLast : {}) } },
            item.status === 'missing' || item.status === 'outdated'
              ? h('input', {
                  type: 'checkbox',
                  checked: selection.includes(item.key),
                  onChange: () => toggleRow(item.key),
                  'aria-label': `${syncKindLabel(t, item.kind)} ${item.name}`,
                  style: { width: '17px', height: '17px', flexShrink: 0, cursor: 'pointer' },
                })
              : h('span', { style: { width: '17px', flexShrink: 0 } }),
            h('div', { style: S.rowMain },
              h('span', { style: S.rowTitleMono }, item.name),
              h('span', { style: S.rowSub },
                `${syncKindLabel(t, item.kind)}${typeof item.version === 'string' ? ` · ${item.version}` : ''}${Array.isArray(item.requires) && item.requires.length > 0 ? ` · ${t('syncRequires')} ${item.requires.join(', ')}` : ''}`),
              item.reason !== null && item.reason !== undefined ? h('span', { style: S.rowSub }, item.reason) : null,
            ),
            h(Badge, { label: syncStatusLabel(t, item.status), tone: syncTone(item.status), dot: true }),
          ),
        ),
      )

      const actionsCard = h(
        'div',
        { style: { ...S.card, padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' } },
        h('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, ...S.chipOn, opacity: busy === 'install' || selection.length === 0 ? 0.45 : 1 },
              disabled: busy === 'install' || selection.length === 0,
              onClick: install,
            },
            busy === 'install' ? t('syncInstalling') : `${t('syncInstall')} (${selection.length})`,
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: S.chip,
              onClick: () => setSelection(selection.length === installable.length ? [] : installable.map((item) => item.key)),
            },
            selection.length === installable.length && installable.length > 0 ? t('syncClearAll') : t('syncSelectAll'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, opacity: busy === 'publish' ? 0.5 : 1 },
              disabled: busy === 'publish',
              onClick: publish,
            },
            busy === 'publish' ? t('syncPublishing') : t('syncPublish'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, opacity: busy === 'preview' ? 0.5 : 1 },
              disabled: busy === 'preview',
              onClick: showPreview,
            },
            t('syncPreview'),
          ),
        ),
        preview !== null
          ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
              h('span', { style: S.rowTitle }, t('syncPreviewTitle')),
              h('span', { style: S.rowSub },
                `${t('syncPreviewRedacted')}: ${t('syncPreviewSecrets').replace('{count}', String(preview.report?.secretCount ?? 0))} · ${t('syncPreviewPaths').replace('{count}', String(preview.report?.pathCount ?? 0))}`),
              h('pre', { style: { ...S.rowMono, maxHeight: '220px', overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap' } }, preview.text ?? ''),
            )
          : null,
      )

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '0 16px 24px' } },
        h('h3', { style: S.h1 }, t('syncTitle')),
        h('p', { style: S.subtitle }, t('syncSubtitle')),
        configCard,
        diffCard,
        actionsCard,
      )
    }

    /* ------------------------ credential vault (live) ---------------------- */

    // The credential manager was its own sidebar entry. It belongs on the same
    // page as the tools that consume those credentials: the `credential` tool
    // lives in the tool list, so its vault is edited right below it.
    const VAULT_BASE = '/credential-vault/api'
    const CREDENTIAL_ROUTES = {
      list: `${VAULT_BASE}/list`,
      audit: `${VAULT_BASE}/audit`,
      set: `${VAULT_BASE}/set`,
      remove: `${VAULT_BASE}/delete`,
      rotate: `${VAULT_BASE}/rotate`,
      export: `${VAULT_BASE}/export`,
      import: `${VAULT_BASE}/import`,
    }

    const CREDENTIAL_KINDS = ['password', 'token', 'api-key', 'ssh-key', 'database', 'other']

    const credentialKindLabel = (t, kind) => {
      if (kind === 'password') return t('credentialKindPassword')
      if (kind === 'token') return t('credentialKindToken')
      if (kind === 'api-key') return t('credentialKindApiKey')
      if (kind === 'ssh-key') return t('credentialKindSshKey')
      if (kind === 'database') return t('credentialKindDatabase')
      return t('credentialKindOther')
    }

    /**
     * The same normalization the host applies to a credential name: lower-case,
     * every run of non-alphanumeric characters folded to one dash. Shown live
     * under the name field so the user sees that "GitHub Token" and
     * "github-token" are the same credential.
     */
    const credentialSlug = (name) =>
      String(name ?? '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')

    /** Parse the comma-separated alias field into the array the host stores. */
    const credentialAliases = (text) =>
      String(text ?? '')
        .split(/[,，]/)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)

    async function credentialApi(path, options) {
      const response = await fetch(path, options ?? {})
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.message || payload.error || `HTTP ${response.status}`)
      }
      return payload
    }

    const credentialPost = (path, body) =>
      credentialApi(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
        cache: 'no-store',
      })

    const CREDENTIAL_INPUT = {
      boxSizing: 'border-box',
      width: '100%',
      padding: '8px 10px',
      fontSize: '14px',
      borderRadius: '9px',
      border: `1px solid ${C.hairline}`,
      background: C.base,
      color: C.text,
      font: 'inherit',
    }

    function CredentialField({ label, value }) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 } },
        h('span', { style: { ...T.caption, color: C.secondary, flex: '0 0 88px' } }, label),
        h('span', { style: { ...T.caption, color: C.text, flex: '1 1 auto', minWidth: 0, wordBreak: 'break-all' } }, value),
      )
    }

    /** Add/edit form. Editing an entry leaves the stored secret alone unless retyped. */
    function CredentialEditor({ t, initial, busy, onSave, onCancel }) {
      const isUpdate = Boolean(initial && initial.name && initial.updatedAt)
      const [form, setForm] = React.useState({
        name: initial.name ?? '',
        kind: CREDENTIAL_KINDS.includes(initial.kind) ? initial.kind : 'other',
        secret: '',
        service: initial.service ?? '',
        aliases: Array.isArray(initial.aliases) ? initial.aliases.join(', ') : '',
        username: initial.username ?? '',
        url: initial.url ?? '',
        note: initial.note ?? '',
      })
      const bind = (key) => ({
        value: form[key],
        onChange: (event) => setForm((current) => ({ ...current, [key]: event.target.value })),
      })
      const canSave = form.name.trim().length > 0 && (form.secret.length > 0 || isUpdate)
      return h(
        'form',
        {
          style: { display: 'flex', flexDirection: 'column', gap: '10px' },
          onSubmit: (event) => {
            event.preventDefault()
            if (canSave && !busy) {
              onSave({
                ...form,
                name: form.name.trim(),
                service: form.service.trim(),
                aliases: credentialAliases(form.aliases),
              })
            }
          },
        },
        [
          h('span', { key: 'caption', style: S.sectionTitle }, isUpdate ? t('credentialEdit') : t('credentialAdd')),
          h(
            'label',
            { key: 'name', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialName')),
            h('input', { style: CREDENTIAL_INPUT, placeholder: t('credentialNamePlaceholder'), ...bind('name') }),
            form.name.trim().length > 0
              ? h(
                  'span',
                  { style: { ...T.caption, color: C.secondary } },
                  `${t('credentialSlugPreview')}: ${credentialSlug(form.name) || '—'}`,
                )
              : null,
          ),
          h(
            'label',
            { key: 'kind', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialKind')),
            h(
              'select',
              { style: CREDENTIAL_INPUT, ...bind('kind') },
              ...CREDENTIAL_KINDS.map((kind) => h('option', { key: kind, value: kind }, credentialKindLabel(t, kind))),
            ),
          ),
          h(
            'label',
            { key: 'service', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialService')),
            h('input', { style: CREDENTIAL_INPUT, placeholder: t('credentialServicePlaceholder'), ...bind('service') }),
          ),
          h(
            'label',
            { key: 'aliases', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialAliases')),
            h('input', { style: CREDENTIAL_INPUT, placeholder: t('credentialAliasesPlaceholder'), ...bind('aliases') }),
          ),
          h(
            'label',
            { key: 'secret', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, isUpdate ? `${t('credentialSecret')} · ${t('credentialMasked')}` : t('credentialSecret')),
            h('input', {
              style: CREDENTIAL_INPUT,
              type: 'password',
              placeholder: isUpdate ? '\u2022\u2022\u2022\u2022' : t('credentialSecretPlaceholder'),
              autoComplete: 'off',
              ...bind('secret'),
            }),
          ),
          h(
            'label',
            { key: 'username', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialUsername')),
            h('input', { style: CREDENTIAL_INPUT, ...bind('username') }),
          ),
          h(
            'label',
            { key: 'url', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialUrl')),
            h('input', { style: CREDENTIAL_INPUT, ...bind('url') }),
          ),
          h(
            'label',
            { key: 'note', style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, t('credentialNote')),
            h('input', { style: CREDENTIAL_INPUT, ...bind('note') }),
          ),
          h(
            'div',
            { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h(
              'button',
              {
                type: 'submit',
                className: 'inv-btn',
                style: { ...S.primary, ...(canSave && !busy ? {} : { opacity: 0.5, cursor: 'default' }) },
                disabled: !canSave || busy,
              },
              busy ? t('credentialSaving') : t('credentialSave'),
            ),
            h(RowButton, { label: t('credentialCancel'), onClick: onCancel }),
          ),
        ],
      )
    }

    /** Inline form for the export action: passphrase + confirmation. */
    function CredentialExportForm({ t, busy, onSubmit, onCancel }) {
      const [passphrase, setPassphrase] = React.useState('')
      const [confirmPassphrase, setConfirmPassphrase] = React.useState('')
      const mismatch = confirmPassphrase.length > 0 && passphrase !== confirmPassphrase
      const canSave = passphrase.length >= 12 && passphrase === confirmPassphrase
      return h(
        'form',
        {
          style: { display: 'flex', flexDirection: 'column', gap: '10px' },
          onSubmit: (event) => {
            event.preventDefault()
            if (canSave && !busy) onSubmit({ passphrase })
          },
        },
        [
          h('span', { key: 'caption', style: S.sectionTitle }, t('credentialExportTitle')),
          h('span', { key: 'hint', style: { ...T.caption, color: C.secondary } }, t('credentialExportHint')),
          h('input', {
            key: 'passphrase', type: 'password', style: CREDENTIAL_INPUT,
            autoComplete: 'new-password', placeholder: t('credentialPassphrasePlaceholder'),
            value: passphrase, onChange: (event) => setPassphrase(event.target.value),
          }),
          h('input', {
            key: 'confirm', type: 'password', style: CREDENTIAL_INPUT,
            autoComplete: 'new-password', placeholder: t('credentialPassphraseConfirm'),
            value: confirmPassphrase, onChange: (event) => setConfirmPassphrase(event.target.value),
          }),
          mismatch ? h('span', { key: 'mismatch', style: { ...T.caption, color: C.danger } }, t('credentialPassphraseMismatch')) : null,
          h(
            'div',
            { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h(
              'button',
              { type: 'submit', className: 'inv-btn', style: { ...S.primary, ...(canSave && !busy ? {} : { opacity: 0.5, cursor: 'default' }) }, disabled: !canSave || busy },
              busy ? t('credentialSaving') : t('credentialExportGo'),
            ),
            h(RowButton, { label: t('credentialCancel'), onClick: onCancel }),
          ),
        ],
      )
    }

    /** Inline form for the import action: passphrase + pasted envelope + mode. */
    function CredentialImportForm({ t, busy, onSubmit, onCancel }) {
      const [passphrase, setPassphrase] = React.useState('')
      const [content, setContent] = React.useState('')
      const [overwrite, setOverwrite] = React.useState(false)
      const canSave = passphrase.length >= 12 && content.trim().length > 0
      return h(
        'form',
        {
          style: { display: 'flex', flexDirection: 'column', gap: '10px' },
          onSubmit: (event) => {
            event.preventDefault()
            if (canSave && !busy) onSubmit({ passphrase, content: content.trim(), overwrite })
          },
        },
        [
          h('span', { key: 'caption', style: S.sectionTitle }, t('credentialImportTitle')),
          h('span', { key: 'hint', style: { ...T.caption, color: C.secondary } }, t('credentialImportHint')),
          h('input', {
            key: 'passphrase', type: 'password', style: CREDENTIAL_INPUT,
            autoComplete: 'new-password', placeholder: t('credentialPassphrasePlaceholder'),
            value: passphrase, onChange: (event) => setPassphrase(event.target.value),
          }),
          h('textarea', {
            key: 'content',
            style: { ...CREDENTIAL_INPUT, minHeight: '120px', fontFamily: 'monospace', resize: 'vertical' },
            placeholder: t('credentialImportContentPlaceholder'),
            value: content,
            onChange: (event) => setContent(event.target.value),
          }),
          h(
            'label',
            { key: 'overwrite', style: { display: 'flex', alignItems: 'center', gap: '8px', ...T.caption } },
            h('input', { type: 'checkbox', checked: overwrite, onChange: (event) => setOverwrite(event.target.checked) }),
            t('credentialImportOverwrite'),
          ),
          h(
            'div',
            { key: 'actions', style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h(
              'button',
              { type: 'submit', className: 'inv-btn', style: { ...S.primary, ...(canSave && !busy ? {} : { opacity: 0.5, cursor: 'default' }) }, disabled: !canSave || busy },
              busy ? t('credentialSaving') : t('credentialImportGo'),
            ),
            h(RowButton, { label: t('credentialCancel'), onClick: onCancel }),
          ),
        ],
      )
    }

    /**
     * Trigger a browser download for an export file. Returns false when no DOM
     * is available (tests), so callers can distinguish "saved" from "skipped".
     * Follows the same pattern as @deepseek-ai/dsh-session-log-export's
     * `downloadUrl`: Blob URL + a temporary anchor with `download`.
     */
    function defaultSaveFile({ text, filename }) {
      if (typeof document === 'undefined') return false
      try {
        const blob = new Blob([text], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        anchor.remove()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        return true
      } catch {
        return false
      }
    }

    /**
     * Credential vault: masked list on top, detail + add/edit form + reveal audit
     * log below. No route ever returns a secret, so the panel only ever shows the
     * masked preview the host sent.
     */
    function CredentialVault(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => zh[key] ?? en[key] ?? key
      const confirm = typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm.bind(window) : () => true
      // Download/read are injectable so tests can drive them without a DOM
      // (the node test runtime has no `document`); production uses the defaults.
      const saveFile = typeof props.saveFile === 'function' ? props.saveFile : defaultSaveFile
      const readFile = typeof props.readFile === 'function' ? props.readFile : (file) => file.text()

      const [entries, setEntries] = React.useState([])
      const [audit, setAudit] = React.useState([])
      const [selectedName, setSelectedName] = React.useState('')
      const [editing, setEditing] = React.useState(null)
      const [phase, setPhase] = React.useState('loading')
      const [failure, setFailure] = React.useState('')
      const [notice, setNotice] = React.useState('')
      const [showAudit, setShowAudit] = React.useState(false)
      const [aux, setAux] = React.useState(null) // null | 'export' | 'import'

      const reload = React.useCallback(async () => {
        setPhase((current) => (current === 'loading' ? 'loading' : 'busy'))
        setFailure('')
        try {
          const [listResult, auditResult] = await Promise.all([credentialApi(CREDENTIAL_ROUTES.list), credentialApi(CREDENTIAL_ROUTES.audit)])
          setEntries(Array.isArray(listResult.entries) ? listResult.entries : [])
          setAudit(Array.isArray(auditResult.records) ? auditResult.records : [])
          setPhase('idle')
        } catch (error) {
          setFailure(error?.message ?? String(error))
          setPhase('error')
        }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        Promise.all([credentialApi(CREDENTIAL_ROUTES.list), credentialApi(CREDENTIAL_ROUTES.audit)])
          .then(([listResult, auditResult]) => {
            if (cancelled) return
            setEntries(Array.isArray(listResult.entries) ? listResult.entries : [])
            setAudit(Array.isArray(auditResult.records) ? auditResult.records : [])
            setPhase('idle')
          })
          .catch((error) => {
            if (cancelled) return
            setFailure(error?.message ?? String(error))
            setPhase('error')
          })
        return () => {
          cancelled = true
        }
      }, [])

      // A notice clears itself; the timer is dropped when the section unmounts.
      React.useEffect(() => {
        if (notice === '') return undefined
        const timer = setTimeout(() => setNotice(''), 3000)
        return () => clearTimeout(timer)
      }, [notice])

      const run = async (work) => {
        setPhase('busy')
        setFailure('')
        try {
          await work()
          await reload()
        } catch (error) {
          setFailure(error?.message ?? String(error))
          setPhase('error')
        }
      }

      const save = (form) =>
        run(async () => {
          const result = await credentialPost(CREDENTIAL_ROUTES.set, form)
          setNotice(result.updated ? t('credentialUpdated') : t('credentialCreated'))
          setEditing(null)
        })

      // The confirmation must happen BEFORE run(): run() flips the section to
      // "busy", clears the visible failure, and reloads when it returns — so a
      // cancelled action used to refresh the panel and wipe an error message the
      // user still needed to read.
      const remove = (name) => {
        if (!confirm(`${t('credentialConfirmDelete')}: ${name}?`)) return
        return run(async () => {
          await credentialPost(CREDENTIAL_ROUTES.remove, { name })
          if (selectedName === name) setSelectedName('')
          setNotice(t('credentialDeleted'))
        })
      }

      const rotate = () => {
        if (!confirm(t('credentialRotateConfirm'))) return
        return run(async () => {
          await credentialPost(CREDENTIAL_ROUTES.rotate, {})
          setNotice(t('credentialRotated'))
        })
      }

      // ---- export / import (issue #51) ----
      const [exportForm, setExportForm] = React.useState(null) // {passphrase, confirm}
      const [importForm, setImportForm] = React.useState(null) // {passphrase, content, overwrite}

      const startExport = async (form) => {
        setPhase('busy')
        setFailure('')
        try {
          const result = await credentialPost(CREDENTIAL_ROUTES.export, { passphrase: form.passphrase })
          const saved = saveFile({ text: result.content, filename: result.filename })
          setAux(null)
          setExportForm(null)
          setPhase('idle')
          setNotice(saved ? t('credentialExportDone') : t('credentialExportNoDownload'))
        } catch (error) {
          setFailure(error?.message ?? String(error))
          setPhase('error')
        }
      }

      const startImport = async (form) => {
        setPhase('busy')
        setFailure('')
        try {
          const result = await credentialPost(CREDENTIAL_ROUTES.import, {
            passphrase: form.passphrase,
            content: form.content,
            mode: form.overwrite ? 'overwrite' : 'skip',
          })
          await reload()
          setAux(null)
          setImportForm(null)
          setPhase('idle')
          setNotice(t('credentialImportSummary')
            .replace('{imported}', String(result.imported ?? 0))
            .replace('{updated}', String(result.updated ?? 0))
            .replace('{skipped}', String(result.skipped ?? 0))
            .replace('{conflicts}', String((result.conflicts ?? []).length))
            .replace('{stale}', String(result.stale ?? 0)))
        } catch (error) {
          setFailure(error?.message ?? String(error))
          setPhase('error')
        }
      }

      const selected = entries.find((entry) => entry.name === selectedName) ?? null
      const busy = phase === 'busy'

      let status = null
      if (phase === 'loading') status = h('span', { style: S.feedback }, t('credentialLoading'))
      else if (phase === 'error') status = h('span', { style: { ...S.feedback, color: C.danger } }, `${t('credentialError')}${failure ? ` (${failure})` : ''}`)
      else if (phase === 'busy') status = h('span', { style: S.feedback }, t('credentialSaving'))

      const list =
        entries.length === 0
          ? h('div', { style: S.card }, h('div', { style: S.empty }, phase === 'loading' ? t('credentialLoading') : t('credentialNoEntries')))
          : h(
              'div',
              { style: S.card, role: 'list' },
              ...entries.map((entry, index) =>
                h(
                  'div',
                  {
                    key: entry.name,
                    role: 'button',
                    tabIndex: 0,
                    'aria-pressed': entry.name === selectedName ? 'true' : 'false',
                    className: 'inv-row',
                    'data-interactive': 'true',
                    style: {
                      ...S.row,
                      ...(index === entries.length - 1 ? S.rowLast : {}),
                      cursor: 'pointer',
                      ...(entry.name === selectedName ? { background: C.fill } : {}),
                    },
                    onClick: () => {
                      setSelectedName(entry.name)
                      setEditing(null)
                    },
                    onKeyDown: activate(() => {
                      setSelectedName(entry.name)
                      setEditing(null)
                    }),
                  },
                  h(Icon, { name: 'lock', size: 16, style: { color: C.secondary } }),
                  h(
                    'div',
                    { style: S.rowMain },
                    h('span', { style: S.rowTitleMono }, entry.name),
                    h(
                      'span',
                      { style: S.rowSub },
                      [
                        credentialKindLabel(t, entry.kind),
                        entry.service,
                        Array.isArray(entry.aliases) && entry.aliases.length > 0 ? entry.aliases.join(', ') : null,
                      ]
                        .filter(Boolean)
                        .join(' · '),
                    ),
                  ),
                  h(Badge, { label: entry.preview || '***' }),
                  h(Icon, { name: 'chevronRight', size: 16, style: S.chevronMuted }),
                ),
              ),
            )

      const auxPanel =
        aux === 'export'
          ? h(CredentialExportForm, {
              key: 'export-form',
              t,
              busy,
              onSubmit: startExport,
              onCancel: () => setAux(null),
            })
          : aux === 'import'
            ? h(CredentialImportForm, {
                key: 'import-form',
                t,
                busy,
                onSubmit: startImport,
                onCancel: () => setAux(null),
              })
            : null

      const details =
        aux === null && editing !== null
          ? h(CredentialEditor, {
              key: `editor-${editing.name ?? 'new'}`,
              t,
              initial: editing,
              busy,
              onSave: save,
              onCancel: () => setEditing(null),
            })
          : selected !== null
            ? h(
                'div',
                { style: { ...S.card, display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px' } },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
                  h('span', { style: S.rowTitleMono }, selected.name),
                  h(Badge, { label: credentialKindLabel(t, selected.kind) }),
                  selected.hasSecret === true ? h(Badge, { label: t('credentialHasSecret'), tone: 'success', dot: true }) : null,
                ),
                CredentialField({ label: t('credentialMasked'), value: selected.preview || '***' }),
                selected.service ? CredentialField({ label: t('credentialService'), value: selected.service }) : null,
                Array.isArray(selected.aliases) && selected.aliases.length > 0
                  ? h(
                      'div',
                      { style: { display: 'flex', alignItems: 'baseline', gap: '10px', flexWrap: 'wrap' } },
                      h('span', { style: { ...T.caption, color: C.secondary, flex: '0 0 88px' } }, t('credentialAliases')),
                      h(
                        'div',
                        { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' } },
                        ...selected.aliases.map((alias) => h(Badge, { key: alias, label: alias })),
                      ),
                    )
                  : null,
                selected.username ? CredentialField({ label: t('credentialUsername'), value: selected.username }) : null,
                selected.url ? CredentialField({ label: t('credentialUrl'), value: selected.url }) : null,
                selected.note ? CredentialField({ label: t('credentialNote'), value: selected.note }) : null,
                CredentialField({ label: t('credentialUpdatedAt'), value: selected.updatedAt || '—' }),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '2px' } },
                  h(
                    'button',
                    {
                      type: 'button',
                      className: 'inv-btn',
                      style: S.chip,
                      onClick: () => setEditing({ ...selected, secret: '' }),
                    },
                    t('credentialEdit'),
                  ),
                  h(RowButton, { label: t('credentialDelete'), disabled: busy, onClick: () => remove(selected.name) }),
                ),
              )
            : null

      const auditPanel = showAudit
        ? h(
            'div',
            { style: { ...S.card, padding: '6px 16px 10px' } },
            h('div', { style: { ...S.sectionHead, cursor: 'default', padding: '8px 0 6px' } }, h('span', { style: S.sectionTitle }, t('credentialAudit'))),
            audit.length === 0
              ? h('div', { style: S.empty }, t('credentialAuditEmpty'))
              : h(
                  'div',
                  { style: { display: 'flex', flexDirection: 'column' } },
                  ...audit.slice(0, 40).map((record, index) =>
                    h(
                      'div',
                      {
                        key: `audit-${index}`,
                        style: { display: 'flex', alignItems: 'baseline', gap: '10px', padding: '6px 0', borderBottom: index === audit.length - 1 ? 'none' : `1px solid ${C.hairline}`, ...T.caption, flexWrap: 'wrap' },
                      },
                      h('span', { style: { color: C.secondary, fontVariantNumeric: 'tabular-nums' } }, record.at || '—'),
                      h('span', { style: { fontWeight: 600 } }, record.name || '—'),
                      h('span', { style: { color: C.secondary } }, `${record.outcome ?? ''}${record.source ? ` · ${record.source}` : ''}`),
                    ),
                  ),
                ),
          )
        : null

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h('span', { style: { ...T.caption, color: C.secondary, flex: '1 1 auto', minWidth: 0 } }, t('credentialToolHint')),
          status,
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: S.chip,
              onClick: () => setEditing({}),
            },
            t('credentialAdd'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              'aria-pressed': showAudit ? 'true' : 'false',
              style: { ...S.chip, ...(showAudit ? S.chipOn : {}) },
              onClick: () => setShowAudit((prev) => !prev),
            },
            t('credentialAudit'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: S.chip,
              disabled: busy,
              onClick: () => setAux((current) => (current === 'export' ? null : 'export')),
            },
            t('credentialExport'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: S.chip,
              disabled: busy,
              onClick: () => setAux((current) => (current === 'import' ? null : 'import')),
            },
            t('credentialImport'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: S.chip,
              disabled: busy,
              onClick: rotate,
            },
            t('credentialRotate'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: S.chip,
              disabled: busy,
              onClick: () => reload(),
            },
            t('credentialRefresh'),
          ),
        ),
        list,
        auxPanel,
        details,
        auditPanel,
        notice !== '' ? h('div', { style: S.notice, role: 'status' }, notice) : null,
      )
    }

    /* --------------------- web search providers (live) --------------------- */

    // The web-search provider manager lives here instead of in its own sidebar
    // panel: "Tools" is already the page that answers what the agent can reach,
    // so the provider order, balances and the injected prompt text are edited
    // next to the tool list they actually control.
    const WEBSEARCH_BASE = '/websearch-failover/api'
    const WEBSEARCH_ROUTES = {
      state: `${WEBSEARCH_BASE}/state`,
      order: `${WEBSEARCH_BASE}/order`,
      refresh: `${WEBSEARCH_BASE}/refresh`,
      enable: `${WEBSEARCH_BASE}/enable`,
    }
    const PROMPT_ROUTE = '/prompt-inject/state'

    const PROVIDER_UNIT_KEYS = {
      credits: 'providerUnitCredits',
      usd: 'providerUnitUsd',
      requests: 'providerUnitRequests',
      tokens: 'providerUnitTokens',
      percent: 'providerUnitPercent',
    }

    /**
     * Documented reset rules per provider kind, used only when the host bundle
     * predates `resetKind`; an explicit host value always wins.
     */
    const PROVIDER_FALLBACK_RESET = {
      tavily: 'monthly-first',
      parallel: 'monthly-allowance',
      firecrawl: 'period-end',
    }

    const providerNum = (value) => (typeof value === 'number' && isFinite(value) ? value : null)

    function providerAmount(value) {
      const number = providerNum(value)
      if (number === null) return ''
      if (Number.isInteger(number)) return String(number)
      return number.toFixed(2).replace(/\.?0+$/, '')
    }

    function providerUnitLabel(t, unit) {
      const key = PROVIDER_UNIT_KEYS[unit]
      return key ? t(key) : t('providerUnitUnknown')
    }

    /** Balance text for any billing unit; never renders NaN. */
    function providerBalanceText(t, balance) {
      if (!balance) return t('providerUnknownBalance')
      const amount = providerAmount(balance.remaining)
      if (amount === '') return t('providerUnknownBalance')
      let text = `${amount} ${providerUnitLabel(t, balance.unit)}`
      const total = providerNum(balance.total)
      if (total !== null && total > 0) text += ` / ${providerAmount(total)}`
      return text
    }

    /** Largest numeric `remaining`, used to normalise bars without a ratio. */
    function providerMaxRemaining(providers) {
      let max = 0
      for (const provider of providers) {
        const remaining = provider?.balance ? providerNum(provider.balance.remaining) : null
        if (remaining !== null && remaining > max) max = remaining
      }
      return max
    }

    /** 0..1 when the host gave a ratio, else a normalised remaining, else null. */
    function providerRatio(provider, maxRemaining) {
      if (!provider?.balance) return null
      const ratio = providerNum(provider.balance.ratio)
      if (ratio !== null) return Math.max(0, Math.min(1, ratio))
      const remaining = providerNum(provider.balance.remaining)
      if (remaining === null) return null
      return maxRemaining > 0 ? Math.max(0, Math.min(1, remaining / maxRemaining)) : 0
    }

    function providerStatus(provider) {
      if (!provider) return 'unknown'
      if (provider.cooldown?.active === true) return 'cooldown'
      if (provider.balance?.status === 'ok') return 'ok'
      if (provider.balance?.status === 'error') return 'cooldown'
      return 'unknown'
    }

    function providerTone(status) {
      if (status === 'ok') return 'success'
      if (status === 'cooldown') return 'warning'
      return undefined
    }

    function providerStatusText(t, status) {
      if (status === 'ok') return t('providerStatusOk')
      if (status === 'cooldown') return t('providerStatusCooldown')
      return t('providerStatusUnknown')
    }

    /** `YYYY-MM-DD HH:mm` in the browser's local zone. */
    function providerStamp(ms) {
      const date = new Date(ms)
      const pad = (value) => (value < 10 ? `0${value}` : String(value))
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    /** Coarse remaining duration for a reset: `24天 3小时` down to `12分钟`. */
    function providerCountdown(t, remainingMs) {
      const minutes = Math.floor(Math.max(0, remainingMs) / 60000)
      const days = Math.floor(minutes / 1440)
      const hours = Math.floor((minutes % 1440) / 60)
      const rest = minutes % 60
      if (days > 0) return `${days}${t('providerResetInDays')} ${hours}${t('providerResetInHours')}`
      if (hours > 0) return `${hours}${t('providerResetInHours')} ${rest}${t('providerResetInMinutes')}`
      return `${rest}${t('providerResetInMinutes')}`
    }

    /** Reset line: exact timestamp + countdown, or the documented monthly rule. */
    function providerResetText(t, balance, provider, nowMs) {
      const explicit = typeof balance?.resetKind === 'string' ? balance.resetKind : undefined
      const kind = explicit ?? PROVIDER_FALLBACK_RESET[provider?.kind]
      const resetsAt = balance ? providerNum(balance.resetsAt) : null
      if (kind === 'monthly-first') {
        return resetsAt === null ? t('providerResetMonthlyFirst') : `${t('providerResetMonthlyFirst')} · ${t('providerResetNext')} ${providerStamp(resetsAt)}`
      }
      if (kind === 'monthly-allowance') {
        return resetsAt === null ? t('providerResetMonthlyAllowance') : `${t('providerResetMonthlyAllowance')} · ${t('providerResetNext')} ${providerStamp(resetsAt)}`
      }
      if (kind === 'period-end') {
        if (resetsAt === null) return t('providerResetUnknown')
        return `${providerStamp(resetsAt)} · ${providerCountdown(t, resetsAt - nowMs)}`
      }
      return t('providerResetNone')
    }

    /** Live cooldown as `12s · reason`; empty when the provider is not cooling. */
    function providerCooldownText(cooldown, nowMs) {
      if (!cooldown || cooldown.active !== true) return ''
      const until = providerNum(cooldown.until)
      const seconds = Math.ceil(Math.max(0, until === null ? 0 : until - nowMs) / 1000)
      const minutes = Math.floor(seconds / 60)
      const rest = seconds % 60
      const clock = minutes > 0 ? `${minutes}m ${rest < 10 ? `0${rest}` : rest}s` : `${seconds}s`
      const reason = typeof cooldown.message === 'string' && cooldown.message ? cooldown.message : cooldown.reason
      return typeof reason === 'string' && reason ? `${clock} · ${reason}` : clock
    }

    /** Host payload -> `{ generatedAt, providers }` in call-priority order. */
    function normalizeProviders(payload) {
      if (!payload || payload.ok !== true || !Array.isArray(payload.providers)) throw new Error('bad-payload')
      const providers = payload.providers
        .filter((provider) => provider && typeof provider.id === 'string' && provider.id.length > 0)
        .sort((left, right) => {
          const leftRank = providerNum(left.rank)
          const rightRank = providerNum(right.rank)
          return (leftRank === null ? Number.MAX_SAFE_INTEGER : leftRank) - (rightRank === null ? Number.MAX_SAFE_INTEGER : rightRank)
        })
      const generatedAt = providerNum(payload.generatedAt)
      return { generatedAt: generatedAt === null ? Date.now() : generatedAt, providers }
    }

    /** Rebuild the provider list in the given id order (optimistic reorder). */
    function orderProviderList(providers, orderIds) {
      const byId = new Map(providers.map((provider) => [provider.id, provider]))
      const next = []
      for (const id of orderIds) {
        const provider = byId.get(id)
        if (provider === undefined) continue
        next.push(provider)
        byId.delete(id)
      }
      for (const provider of providers) if (byId.has(provider.id)) next.push(provider)
      return next.map((provider, index) => ({ ...provider, rank: index + 1 }))
    }

    async function providerFetch(url, init) {
      const response = await fetch(url, init ?? {})
      const data = await response.json().catch(() => null)
      if (!response.ok || !data || data.ok !== true) {
        throw new Error(data && typeof data.error === 'string' ? data.error : `http-${response.status}`)
      }
      return data
    }

    const providerPost = (url, body) =>
      providerFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body ?? {}),
        cache: 'no-store',
      })

    /** Proportional bar; an unknown ratio renders an empty track, never NaN%. */
    function ProviderBar({ ratio, tone }) {
      const known = typeof ratio === 'number' && isFinite(ratio)
      const color = tone === 'success' ? C.success : tone === 'warning' ? C.warning : C.fillStrong
      return h(
        'div',
        { style: S.providerTrack, role: 'presentation' },
        known ? h('div', { style: { ...S.providerFill, width: `${(ratio * 100).toFixed(2)}%`, background: color } }) : null,
      )
    }

    function ProviderField({ label, value }) {
      return h(
        'div',
        { style: { display: 'flex', alignItems: 'baseline', gap: '10px', minWidth: 0 } },
        h('span', { style: { ...T.caption, color: C.secondary, flex: '0 0 88px' } }, label),
        h('span', { style: { ...T.caption, color: C.text, flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word', fontVariantNumeric: 'tabular-nums' } }, value),
      )
    }

    /**
     * Web-search provider manager: call priority (drag or arrows), live balance
     * per billing unit, cooldown countdown, per-provider enable switch and the
     * local call statistics of the selected provider.
     *
     * Balances are never polled — every provider API call is billed — so only an
     * explicit refresh hits `/refresh`.
     */
    function WebSearchProviders(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => zh[key] ?? en[key] ?? key
      const [snapshot, setSnapshot] = React.useState(null)
      const [phase, setPhase] = React.useState('loading')
      const [failure, setFailure] = React.useState('')
      const [selectedId, setSelectedId] = React.useState('')
      const [dragId, setDragId] = React.useState('')
      const [overId, setOverId] = React.useState('')
      const [now, setNow] = React.useState(() => Date.now())

      const providers = Array.isArray(snapshot?.providers) ? snapshot.providers : []
      const busy = phase === 'loading' || phase === 'saving' || phase === 'refreshing'

      const reload = React.useCallback(async () => {
        setPhase('loading')
        setFailure('')
        try {
          setSnapshot(normalizeProviders(await providerFetch(WEBSEARCH_ROUTES.state, { headers: { accept: 'application/json' }, cache: 'no-store' })))
          setPhase('ready')
        } catch (error) {
          setFailure(error?.message ?? String(error))
          setPhase('error')
        }
      }, [])

      React.useEffect(() => {
        let cancelled = false
        providerFetch(WEBSEARCH_ROUTES.state, { headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((payload) => {
            if (cancelled) return
            setSnapshot(normalizeProviders(payload))
            setPhase('ready')
          })
          .catch((error) => {
            if (cancelled) return
            setFailure(error?.message ?? String(error))
            setPhase('error')
          })
        return () => {
          cancelled = true
        }
      }, [])

      // One-second tick only while something is cooling down (countdown text).
      const ticking = providers.some((provider) => provider?.cooldown?.active === true)
      React.useEffect(() => {
        if (!ticking) return undefined
        const timer = setInterval(() => setNow(Date.now()), 1000)
        return () => clearInterval(timer)
      }, [ticking])

      // Keep a valid selection whenever the payload changes.
      React.useEffect(() => {
        if (!snapshot) return
        if (providers.some((provider) => provider.id === selectedId)) return
        setSelectedId(providers.length > 0 ? providers[0].id : '')
      }, [snapshot, selectedId, providers])

      const accept = (payload) => {
        setSnapshot(normalizeProviders(payload))
        setFailure('')
        setPhase('ready')
      }
      const reject = (error) => {
        setFailure(error?.message ?? String(error))
        setPhase('error')
      }

      /** POST the full id array, after applying the new order optimistically. */
      const commitOrder = (nextIds) => {
        if (!snapshot || phase === 'saving') return
        const previous = snapshot
        setSnapshot({ generatedAt: previous.generatedAt, providers: orderProviderList(previous.providers, nextIds) })
        setFailure('')
        setPhase('saving')
        providerPost(WEBSEARCH_ROUTES.order, { order: nextIds })
          .then(accept)
          .catch((error) => {
            setSnapshot(previous)
            reject(error)
          })
      }

      const moveBy = (id, delta) => {
        const ids = providers.map((provider) => provider.id)
        const from = ids.indexOf(id)
        const to = from + delta
        if (from < 0 || to < 0 || to >= ids.length) return
        ids.splice(from, 1)
        ids.splice(to, 0, id)
        commitOrder(ids)
      }

      const refresh = (ids) => {
        if (busy) return
        setFailure('')
        setPhase('refreshing')
        providerPost(WEBSEARCH_ROUTES.refresh, ids ? { ids } : {})
          .then(accept)
          .catch(reject)
      }

      const toggleEnabled = (provider) => {
        if (!snapshot || !provider || phase === 'saving') return
        const previous = snapshot
        const enabled = provider.enabled !== true
        setSnapshot({
          generatedAt: previous.generatedAt,
          providers: previous.providers.map((row) => (row.id === provider.id ? { ...row, enabled } : row)),
        })
        setFailure('')
        setPhase('saving')
        providerPost(WEBSEARCH_ROUTES.enable, { id: provider.id, enabled })
          .then(accept)
          .catch((error) => {
            setSnapshot(previous)
            reject(error)
          })
      }

      const onDropRow = (event, id) => {
        event.preventDefault()
        let source = dragId
        if (!source) {
          try {
            source = event.dataTransfer.getData('text/plain')
          } catch {
            source = ''
          }
        }
        setDragId('')
        setOverId('')
        if (!source || source === id) return
        const ids = providers.map((provider) => provider.id).filter((candidate) => candidate !== source)
        const target = ids.indexOf(id)
        if (target < 0) return
        ids.splice(target, 0, source)
        commitOrder(ids)
      }

      const maxRemaining = providerMaxRemaining(providers)

      let status = null
      if (phase === 'loading' || (failure === '' && snapshot === null)) status = h('span', { style: S.feedback }, t('providerLoading'))
      else if (phase === 'refreshing') status = h('span', { style: S.feedback }, t('providerRefreshing'))
      else if (phase === 'saving') status = h('span', { style: S.feedback }, t('providerSaving'))
      else if (phase === 'error') status = h('span', { style: { ...S.feedback, color: C.danger } }, `${t('providerFailed')} (${failure})`)

      const card =
        providers.length === 0
          ? h('div', { style: S.card }, h('div', { style: S.empty }, phase === 'loading' ? t('providerLoading') : t('providerNoProviders')))
          : h(
              'div',
              { style: S.card },
              ...providers.map((provider, index) => {
                const tone = providerStatus(provider)
                const ratio = providerRatio(provider, maxRemaining)
                const active = provider.id === selectedId
                const isDragging = dragId === provider.id
                const isOver = overId === provider.id && dragId !== '' && dragId !== provider.id
                const upDisabled = index === 0 || phase === 'saving'
                const downDisabled = index === providers.length - 1 || phase === 'saving'
                const last = index === providers.length - 1
                return h(
                  'div',
                  {
                    key: provider.id,
                    draggable: true,
                    style: {
                      ...S.row,
                      ...(last ? S.rowLast : {}),
                      flexDirection: 'column',
                      alignItems: 'stretch',
                      gap: '6px',
                      cursor: 'grab',
                      ...(provider.enabled === false ? { opacity: 0.55 } : {}),
                      ...(isDragging ? { opacity: 0.45 } : {}),
                      ...(isOver ? { boxShadow: `inset 0 2px 0 ${C.accent}` } : {}),
                    },
                    'aria-label': `${provider.label ?? provider.id} · ${t('providerRank')} ${index + 1}`,
                    title: t('providerDragHint'),
                    onDragStart: (event) => {
                      setDragId(provider.id)
                      setOverId('')
                      try {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', provider.id)
                      } catch {
                        // Older engines refuse dataTransfer writes; the arrows still work.
                      }
                    },
                    onDragOver: (event) => {
                      event.preventDefault()
                      if (overId !== provider.id) setOverId(provider.id)
                    },
                    onDragLeave: () => setOverId((current) => (current === provider.id ? '' : current)),
                    onDrop: (event) => onDropRow(event, provider.id),
                    onDragEnd: () => {
                      setDragId('')
                      setOverId('')
                    },
                  },
                  h(
                    'div',
                    {
                      role: 'button',
                      tabIndex: 0,
                      'aria-pressed': active ? 'true' : 'false',
                      className: 'inv-row',
                      'data-interactive': 'true',
                      style: { display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, cursor: 'pointer' },
                      onClick: () => setSelectedId(provider.id),
                      onKeyDown: activate(() => setSelectedId(provider.id)),
                    },
                    h('span', { style: S.providerRank }, String(index + 1)),
                    h(
                      'div',
                      { style: S.rowMain },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } },
                        h('span', { style: { ...S.dot, background: tone === 'success' ? C.success : tone === 'warning' ? C.warning : C.secondary }, title: providerStatusText(t, tone) }),
                        h('span', { style: { ...S.rowTitle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, provider.label ?? provider.id),
                        provider.enabled === false ? h(Badge, { label: t('disabled') }) : null,
                      ),
                      h('span', { style: S.rowSub }, `${t('providerBalance')} ${providerBalanceText(t, provider.balance)}`),
                      h(ProviderBar, { ratio, tone }),
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', flexDirection: 'column', gap: '2px', flexShrink: 0 } },
                      h(RowIconButton, { label: t('providerMoveUp'), icon: 'chevronUp', onClick: () => moveBy(provider.id, -1), disabled: upDisabled }),
                      h(RowIconButton, { label: t('providerMoveDown'), icon: 'chevronDown', onClick: () => moveBy(provider.id, 1), disabled: downDisabled }),
                    ),
                  ),
                )
              }),
            )

      const selected = providers.find((provider) => provider.id === selectedId) ?? null
      let detail = null
      if (selected !== null) {
        const tone = providerStatus(selected)
        const ratio = providerRatio(selected, maxRemaining)
        const stats = selected.stats ?? {}
        const cooldown = selected.cooldown ?? { active: false }
        const rank = providerNum(selected.rank)
        const ratioText = typeof ratio === 'number' ? `${Math.round(ratio * 100)}%` : ''
        const balanceLabel = providerBalanceText(t, selected.balance)
        const lastUsed = typeof stats.lastUsedAt === 'string' && stats.lastUsedAt.length > 0 ? stats.lastUsedAt : t('providerNeverUsed')
        const statCell = (key, label, value) =>
          h(
            'div',
            { key, style: { display: 'flex', flexDirection: 'column', gap: '2px', padding: '10px 12px' } },
            h('span', { style: { ...T.caption, color: C.secondary } }, label),
            h('span', { style: { ...T.caption, color: C.text, fontWeight: 600, fontVariantNumeric: 'tabular-nums', wordBreak: 'break-word' } }, value),
          )
        detail = h(
          'div',
          { style: { ...S.card, display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
            h('span', { style: S.rowTitle }, selected.label ?? selected.id),
            h(Badge, { label: selected.kind ?? '—' }),
            h(Badge, { label: providerStatusText(t, tone), tone: providerTone(tone), dot: true }),
          ),
          ProviderField({ label: t('providerRank'), value: rank === null ? '—' : `#${rank}` }),
          ProviderField({ label: t('providerBalance'), value: ratioText ? `${balanceLabel} · ${ratioText}` : balanceLabel }),
          h(ProviderBar, { ratio, tone }),
          ProviderField({ label: t('providerReset'), value: providerResetText(t, selected.balance, selected, now) }),
          ProviderField({ label: t('providerCooldown'), value: cooldown.active === true ? providerCooldownText(cooldown, now) : '—' }),
          ProviderField({ label: t('providerKey'), value: selected.keyPresent === true ? t('providerKeyPresent') : t('providerKeyMissing') }),
          h(
            'div',
            { style: { ...S.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', background: C.fill, border: 'none', gap: '2px' } },
            statCell('calls', t('providerCalls'), String(providerNum(stats.calls) ?? 0)),
            statCell('successes', t('providerSuccesses'), String(providerNum(stats.successes) ?? 0)),
            statCell('failures', t('providerFailures'), String(providerNum(stats.failures) ?? 0)),
            statCell('lastUsed', t('providerLastUsed'), lastUsed),
          ),
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', paddingTop: '2px' } },
            h(
              'button',
              {
                type: 'button',
                className: 'inv-btn',
                style: { ...S.chip, ...(selected.enabled === false ? S.chipOn : {}) },
                disabled: phase === 'saving',
                onClick: () => toggleEnabled(selected),
              },
              selected.enabled === false ? t('providerEnable') : t('providerDisable'),
            ),
            h(RowButton, { label: t('providerRefreshOne'), disabled: busy, onClick: () => refresh([selected.id]) }),
          ),
        )
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h('span', { style: { ...T.caption, color: C.secondary, flex: '1 1 auto', minWidth: 0 } },
            `${t('providerPriorityHint')} ${t('providerHint')}`),
          status,
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.chip, ...(busy ? { opacity: 0.5, cursor: 'default' } : {}) },
              disabled: busy,
              onClick: () => refresh(),
            },
            phase === 'refreshing' ? t('providerRefreshing') : t('providerRefresh'),
          ),
          phase === 'error' && snapshot === null
            ? h(
                'button',
                {
                  type: 'button',
                  className: 'inv-btn',
                  style: S.chip,
                  onClick: () => {
                    reload()
                  },
                },
                t('retry'),
              )
            : null,
        ),
        card,
        detail,
      )
    }

    /** Prompt injection: the text every agent system prompt carries, edited live. */
    function PromptInjector(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => zh[key] ?? en[key] ?? key
      const [text, setText] = React.useState('')
      const [status, setStatus] = React.useState('loading')
      const [detail, setDetail] = React.useState('')

      React.useEffect(() => {
        let cancelled = false
        fetch(PROMPT_ROUTE, { method: 'GET', headers: { accept: 'application/json' }, cache: 'no-store' })
          .then((response) => {
            if (!response.ok) throw new Error(`http-${response.status}`)
            return response.json()
          })
          .then((data) => {
            if (cancelled) return
            setText(data && typeof data.text === 'string' ? data.text : '')
            setStatus('idle')
          })
          .catch(() => {
            if (!cancelled) setStatus('load-error')
          })
        return () => {
          cancelled = true
        }
      }, [])

      const disabled = status === 'loading' || status === 'saving'

      const onSave = () => {
        if (disabled) return
        const value = text
        if (value.trim().length === 0) {
          setStatus('empty')
          setDetail('')
          return
        }
        setStatus('saving')
        setDetail('')
        fetch(PROMPT_ROUTE, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: value }),
        })
          .then(async (response) => {
            const data = await response.json().catch(() => ({}))
            if (!response.ok) throw new Error(data && data.error ? data.error : `http-${response.status}`)
            setStatus('saved')
          })
          .catch((error) => {
            setDetail(error?.message ?? 'unknown')
            setStatus('error')
          })
      }

      let hint = null
      if (status === 'loading') hint = h('span', { style: S.feedback }, t('promptLoading'))
      else if (status === 'saving') hint = h('span', { style: S.feedback }, t('promptSaving'))
      else if (status === 'saved') hint = h('span', { style: { ...S.feedback, color: C.success } }, t('promptSaved'))
      else if (status === 'empty') hint = h('span', { style: { ...S.feedback, color: C.danger } }, t('promptErrorEmpty'))
      else if (status === 'load-error') hint = h('span', { style: { ...S.feedback, color: C.danger } }, t('promptErrorLoad'))
      else if (status === 'error') hint = h('span', { style: { ...S.feedback, color: C.danger } }, `${t('promptErrorSave')}${detail ? ` (${detail})` : ''}`)

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
        h('span', { style: { ...T.caption, color: C.secondary } }, t('promptDescription')),
        h(
          'div',
          { style: { ...S.card, padding: '10px 12px', background: C.fill, border: 'none' } },
          h('textarea', {
            className: 'inv-textarea',
            style: {
              boxSizing: 'border-box',
              width: '100%',
              minHeight: '180px',
              resize: 'vertical',
              margin: 0,
              padding: '10px 12px',
              color: C.text,
              background: C.base,
              border: `1px solid ${C.hairline}`,
              borderRadius: '10px',
              outline: 'none',
              fontFamily: FONT_MONO,
              fontSize: '12.5px',
              lineHeight: 1.6,
            },
            value: text,
            placeholder: t('promptPlaceholder'),
            disabled,
            spellCheck: false,
            'aria-label': t('promptSection'),
            onChange: (event) => {
              setText(event.target.value)
              if (status !== 'saving') {
                setStatus('idle')
                setDetail('')
              }
            },
          }),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              className: 'inv-btn',
              style: { ...S.primary, ...(disabled ? { opacity: 0.5, cursor: 'default' } : {}) },
              disabled,
              onClick: onSave,
            },
            status === 'saving' ? t('promptSaving') : t('promptConfirm'),
          ),
          hint,
        ),
      )
    }

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
            'aria-pressed': view === 'workspaces' || view === 'workspace' ? 'true' : 'false',
            style: { ...S.segBtn, ...(view === 'workspaces' || view === 'workspace' ? S.segBtnActive : {}) },
            className: 'inv-seg-btn',
            onClick: () => setView('workspaces'),
          },
          t('wsWorkspaces'),
        ),
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': view === 'sync' ? 'true' : 'false',
            style: { ...S.segBtn, ...(view === 'sync' ? S.segBtnActive : {}) },
            className: 'inv-seg-btn',
            onClick: () => setView('sync'),
          },
          t('syncView'),
        ),
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': view === 'providers' ? 'true' : 'false',
            style: { ...S.segBtn, ...(view === 'providers' ? S.segBtnActive : {}) },
            className: 'inv-seg-btn',
            onClick: () => setView('providers'),
          },
          t('providerSection'),
        ),
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': view === 'prompt' ? 'true' : 'false',
            style: { ...S.segBtn, ...(view === 'prompt' ? S.segBtnActive : {}) },
            className: 'inv-seg-btn',
            onClick: () => setView('prompt'),
          },
          t('promptSection'),
        ),
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': view === 'credentials' ? 'true' : 'false',
            style: { ...S.segBtn, ...(view === 'credentials' ? S.segBtnActive : {}) },
            className: 'inv-seg-btn',
            onClick: () => setView('credentials'),
          },
          t('credentialSection'),
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
        hiddenSkills.length === 0
          ? null
          : h(
              'button',
              {
                type: 'button',
                className: 'inv-seg-btn',
                'aria-pressed': showHiddenSkills ? 'true' : 'false',
                style: { ...S.chip, ...(showHiddenSkills ? S.chipOn : {}) },
                title: t('hiddenSkillsHint'),
                onClick: () => setShowHiddenSkills((prev) => !prev),
              },
              `${t('showHiddenSkills')} ${hiddenSkills.length}`,
            )

      const stats = h(
        'div',
        { style: { ...S.card, ...S.stats } },
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
                  { key, style: { ...S.row, ...(index === skills.length - 1 ? S.rowLast : {}), ...(hiddenSkills.includes(item.name) ? S.rowHidden : {}), flexDirection: 'column', alignItems: 'stretch', gap: '6px' } },
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
          h('div', { style: S.controls }, segmented, view === 'global' ? officialToggle : null, hiddenSkillsChip, isLiveView ? null : stamp),
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
                h(Icon, { name: 'alert', size: 18 }),
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

      // The Plugins page's own slots: a button at the head of a bundle's detail
      // page and a tag beside its version. Both filter on this checkout's bundle
      // list, so a foreign package renders nothing.
      ctx.slots.inject('plugins.detail.actions', () =>
        ctx.slots.register(
          { name: 'plugins.detail.actions', id: 'inventory-update', order: 10, locale: NS, inject: () => ({ t }) },
          PluginUpdateAction,
        ),
      )
      ctx.slots.inject('plugins.detail.badge', () =>
        ctx.slots.register(
          { name: 'plugins.detail.badge', id: 'inventory-update-badge', order: 10, locale: NS, inject: () => ({ t }) },
          PluginUpdateBadge,
        ),
      )
    }

    /**
     * The update affordances on the Plugins page (issue #45).
     *
     * Two slots, one source of truth: `plugins.detail.actions` draws the button,
     * `plugins.detail.badge` the tag beside the version. Both render `null` for
     * any package that is not in this checkout's bundle list, so every other
     * plugin page on the page looks exactly as it did before.
     *
     * A recomposition cannot be rolled back, so the click asks first and the
     * request itself is what decides whether an update may start — the browser
     * never decides that.
     */
    const UPDATE_ROUTE = '/inventory/plugin-update'
    const UPDATE_APPLY_ROUTE = '/inventory/plugin-update/apply'

    /**
     * One shared read of the update state.
     *
     * Both slots are mounted for the same bundle and this route runs a
     * `git fetch`, so a request per component would double every poll. The cache
     * also keeps "is this ours" from costing a network round trip per page.
     */
    const updateCache = { at: 0, state: null, inFlight: null }
    const UPDATE_CACHE_MS = 10_000

    function loadUpdateState(force = false) {
      const now = Date.now()
      if (!force && updateCache.state !== null && now - updateCache.at < UPDATE_CACHE_MS) {
        return Promise.resolve(updateCache.state)
      }
      if (updateCache.inFlight !== null) return updateCache.inFlight
      updateCache.inFlight = fetch(UPDATE_ROUTE, { headers: { accept: 'application/json' } })
        .then((response) => response.json())
        .catch((error) => ({ ok: false, error: String(error?.message ?? error) }))
        .then((state) => {
          updateCache.state = state
          updateCache.at = Date.now()
          updateCache.inFlight = null
          return state
        })
      return updateCache.inFlight
    }

    function useUpdateState() {
      const [state, setState] = React.useState(updateCache.state)
      React.useEffect(() => {
        let live = true
        loadUpdateState().then((next) => {
          if (live) setState(next)
        })
        return () => {
          live = false
        }
      }, [])
      return state
    }

    /**
     * Whether this subject could be one of ours, decided WITHOUT a request.
     *
     * Every other page on the Plugins page must stay free: an official bundle is
     * never ours, so opening it must not cause a `git fetch`.
     */
    function mayBeOurs(subject) {
      if (subject?.kind !== 'bundle') return false
      const name = subject.pkg?.name
      if (typeof name !== 'string' || name.length === 0) return false
      if (name.startsWith('@deepseek-ai/')) return false
      return subject.pkg?.installed === true
    }

    /** The row for one bundle in the status payload, or null when it is not ours. */
    function updateRowFor(state, subject) {
      if (state?.ok !== true || Array.isArray(state.bundles) !== true) return null
      if (mayBeOurs(subject) !== true) return null
      return state.bundles.find((row) => row.name === subject.pkg.name) ?? null
    }

    function PluginUpdateBadge({ subject, t }) {
      if (mayBeOurs(subject) !== true) return null
      return h(BadgeBody, { subject, t })
    }

    function BadgeBody({ subject, t }) {
      const state = useUpdateState()
      const row = updateRowFor(state, subject)
      if (row === null || row.updatable !== true) return null
      return h(
        'span',
        {
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            height: '20px',
            padding: '0 8px',
            borderRadius: '999px',
            background: C.fill,
            color: C.secondary,
            fontSize: '11px',
            fontWeight: 600,
          },
        },
        `${t('updateBadge')} ${row.version} → ${row.nextVersion}`,
      )
    }

    function PluginUpdateAction({ subject, t }) {
      if (mayBeOurs(subject) !== true) return null
      return h(ActionBody, { subject, t })
    }

    function ActionBody({ subject, t }) {
      const state = useUpdateState()
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const row = updateRowFor(state, subject)
      const outcome = state?.last ?? null

      if (row === null) return null

      const run = async () => {
        setBusy(true)
        setNote(t('updateRunning'))
        try {
          const response = await fetch(UPDATE_APPLY_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ name: row.name }),
          })
          const payload = await response.json()
          if (payload?.accepted !== true) setNote(payload?.detail ?? payload?.error ?? t('updateFailed'))
        } catch (error) {
          setNote(String(error?.message ?? error))
        } finally {
          setBusy(false)
          setTimeout(() => {
            loadUpdateState(true).then(() => setNote(null))
          }, 1500)
        }
      }

      const confirm =
        typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm.bind(window) : () => true
      const onClick = () => {
        if (!confirm(t('updateConfirm'))) return
        run()
      }

      // The host writes the outcome to disk because a self-update stops this
      // module; reading it back is how the page learns what actually happened.
      const restart = outcome?.restart
      const verdict =
        restart === undefined
          ? null
          : restart.application === 'applied'
            ? t('updateDone')
            : `${t('updateDone')} · ${restart.restartReason ?? restart.application}`

      if (row.updatable !== true) {
        return h('span', { style: { ...T.caption, color: C.secondary } }, verdict ?? t('updateCurrent'))
      }

      return h(
        'div',
        { style: { display: 'inline-flex', alignItems: 'center', gap: '8px' } },
        h(
          'button',
          {
            type: 'button',
            className: 'inv-seg-btn',
            style: { ...S.primary, ...(busy ? { opacity: 0.5, cursor: 'default' } : {}) },
            disabled: busy,
            onClick: busy ? undefined : onClick,
          },
          t('updateTo').replace('{version}', String(row.nextVersion ?? '')),
        ),
        note === null ? null : h('span', { style: { ...T.caption, color: C.secondary } }, note),
        verdict === null ? null : h('span', { style: { ...T.caption, color: C.secondary } }, verdict),
      )
    }

    return {
      name: 'dsh-inventory',
      inject: ['slots', 'locale', 'layout'],
      apply,
      // Named so the browser-half tests can mount one live section on its own
      // without re-expanding the whole panel and remounting it.
      __webSearchProviders: WebSearchProviders,
      __promptInjector: PromptInjector,
      __credentialVault: CredentialVault,
      __pluginUpdateAction: PluginUpdateAction,
      __pluginUpdateBadge: PluginUpdateBadge,
    }
  },
})
