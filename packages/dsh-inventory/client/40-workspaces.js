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
          { className: 'inv-card', style: S.card, role: 'list' },
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
          // The suffix decides what a same-name declaration means: with a
          // gate suffix both copies mount (tools double up); without one the
          // runtime rejects the second serverName, so nothing extra mounts.
          row.locked && row.isDeclared
            ? h(Badge, { label: t(data?.gateServerNameSuffix ? 'wsGlobalDuplicate' : 'wsSameNameConflict'), tone: 'warning', dot: true })
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
          { key: `ws-skill-${workspace.id}-${skill.name}`, style: { ...S.row, ...(last ? S.rowLast : {}) } },
          h(
            'div',
            { style: { ...S.rowMain, ...(hidden ? S.rowTextHidden : {}) } },
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
        h('span', { className: 'inv-chev', style: { ...S.chev, transform: showGlobalSkills ? 'rotate(0deg)' : 'rotate(-90deg)' } }, h(Icon, { name: 'chevronDown', size: 15 })),
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

