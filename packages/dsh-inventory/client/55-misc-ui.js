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

