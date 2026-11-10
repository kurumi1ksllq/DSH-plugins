
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
        known ? h('div', { className: 'inv-provider-fill', style: { ...S.providerFill, width: `${(ratio * 100).toFixed(2)}%`, background: color } }) : null,
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
          ? h('div', { className: 'inv-card', style: S.card }, h('div', { style: S.empty }, phase === 'loading' ? t('providerLoading') : t('providerNoProviders')))
          : h(
              'div',
              { className: 'inv-card', style: S.card },
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
          { className: 'inv-card', style: { ...S.card, display: 'flex', flexDirection: 'column', gap: '10px', padding: '14px 16px' } },
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
            { className: 'inv-card', style: { ...S.card, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(96px, 1fr))', background: C.fill, border: 'none', gap: '2px' } },
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
                className: selected.enabled === false ? 'inv-btn inv-chip inv-chip-on' : 'inv-btn inv-chip',
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
              className: 'inv-btn inv-chip',
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
                  className: 'inv-btn inv-chip',
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
