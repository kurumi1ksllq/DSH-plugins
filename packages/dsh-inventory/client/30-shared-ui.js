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

    /**
     * Left navigation rail (issue #91): the six views in two labelled groups.
     * `groups` is `[{ title, items: [{ key, label, count? }] }]` in render
     * order, `title`/`label` already translated; `active` is the current view
     * key and `onSelect(key)` routes it. Pure shell — the keys are the panel's
     * existing view ids, so no routing state lives here. Each item button
     * carries `aria-label: item.label` (name without the count) so callers and
     * tests can target rows by view name, independent of the count text.
     */
    function NavRail({ label, groups, active, onSelect }) {
      const items = groups.flatMap((group) =>
        group.items.map((item) => ({
          ...item,
          groupTitle: group.title,
          active: item.key === active,
          onSelect: () => onSelect(item.key),
        })),
      )
      let lastGroup = null
      return h(
        'nav',
        { style: S.rail, 'aria-label': label },
        items.map((item) => {
          const head =
            item.groupTitle === lastGroup
              ? null
              : h('div', { key: `g-${item.groupTitle}`, style: S.railGroup }, item.groupTitle)
          lastGroup = item.groupTitle
          return [
            head,
            h(
              'button',
              {
                key: `i-${item.key}`,
                type: 'button',
                style: { ...S.railItem, ...(item.active ? S.railItemActive : {}) },
                className: item.active ? 'inv-rail-item inv-rail-active' : 'inv-rail-item',
                'aria-label': item.label,
                'aria-current': item.active ? 'page' : 'false',
                onClick: item.onSelect,
              },
              h('span', { style: S.railItemLabel }, item.label),
              typeof item.count === 'number'
                ? h('span', { style: S.railItemCount }, String(item.count))
                : null,
            ),
          ]
        }),
      )
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

